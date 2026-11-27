import axios, {
  AxiosInstance,
  AxiosError,
  isAxiosError,
  type InternalAxiosRequestConfig,
} from "axios";
import FormData from "form-data";
import https from "node:https";
import type { AuthLease, AuthProvider } from "./auth.js";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import { textToAdf } from "./jira-rich-text.js";
import type {
  JiraUser,
  JiraServerInfo,
  JiraIssue,
  JiraSearchResult,
  JiraTransitionsResult,
  JiraProject,
  JiraComment,
  JiraAttachment,
  JiraAttachmentMeta,
  JiraIssueLinkType,
  JiraRemoteLink,
  JiraErrorResponse,
  JiraEditMetaResponse,
  JiraCloudSearchResult,
  JiraPage,
  JiraCommentsPage,
} from "./types.js";

const AUTH_LEASE = Symbol("jiraAuthLease");
const MAX_RATE_LIMIT_RETRIES = 5;
const DEFAULT_RETRY_AFTER_MS = 1000;
const DEFAULT_MAX_ATTACHMENT_BYTES = 250 * 1024 * 1024;
const MAX_CLOUD_COLLECTION_ITEMS = 10000;
const MAX_CLOUD_PAGES = 1000;

type AuthenticatedRequestConfig = InternalAxiosRequestConfig & {
  [AUTH_LEASE]?: AuthLease;
};

/**
 * Error raised for any non-2xx response (or network failure) from the Jira
 * REST API. Carries the HTTP status code and Jira's own error details (when
 * available) so callers/tools can surface actionable messages instead of a
 * raw stack trace.
 */
export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly jiraErrors?: unknown,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (redacted, secret) => secret ? redacted.replaceAll(secret, "[REDACTED]") : redacted,
    value,
  );
}

function redactValue<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === "string") return redactString(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]),
    ) as T;
  }
  return value;
}

export function parseRetryAfter(value: unknown, now = Date.now()): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const timestamp = Date.parse(String(raw));
  return Number.isNaN(timestamp) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, timestamp - now);
}

function extractJiraErrorMessage(
  error: AxiosError<unknown>,
  secrets: readonly string[],
): string {
  const data = error.response?.data;
  const parts: string[] = [];
  if (data && typeof data === "object") {
    const jiraError = data as JiraErrorResponse;
    if (jiraError.errorMessages?.length) {
      parts.push(...jiraError.errorMessages);
    }
    if (jiraError.errors) {
      for (const [field, msg] of Object.entries(jiraError.errors)) {
        parts.push(`${field}: ${msg}`);
      }
    }
  }
  if (parts.length > 0) {
    const message = parts.join("; ");
    return redactString(appendNumericIdFieldHint(message), secrets);
  }
  if (typeof data === "string" && data.length > 0) {
    return redactString(data, secrets);
  }
  if (data !== undefined) {
    return redactString(JSON.stringify(data), secrets);
  }
  return redactString(error.message, secrets);
}

// Jira's "Number value expected as the X id" errors (seen for Sprint and similar
// system-managed fields) mean the caller sent a name/string instead of the
// numeric ID Jira actually stores. This is easy to trip on since most other
// custom fields accept plain text, so surface an actionable hint instead of
// letting callers guess (watchdog issue #515: NFS-6884 400'd on the Sprint
// field for exactly this reason).
function appendNumericIdFieldHint(message: string): string {
  if (!/number value expected as the .+ id/i.test(message)) return message;
  return `${message} (hint: this field requires the numeric Jira ID, not its name - `
    + "look up the correct ID first, e.g. via get_issue_edit_meta or a board/sprint search, "
    + "then pass that numeric value)";
}

export interface CustomFieldOption {
  fieldKey: string;
  optionId: string;
}

export interface CreateIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  labels?: string[];
  customFieldOptions?: CustomFieldOption[];
}

function customFieldOptionFields(
  options?: CustomFieldOption[],
): Record<string, { id: string }> {
  return Object.fromEntries(
    (options ?? []).map(({ fieldKey, optionId }) => [fieldKey, { id: optionId }]),
  );
}

export interface UpdateIssueInput {
  issueKey: string;
  fields?: Record<string, unknown>;
  customFieldOptions?: CustomFieldOption[];
  labelsToAdd?: string[];
  labelsToRemove?: string[];
}

export interface BulkOperationResult<T> {
  index: number;
  input: T;
  issue?: JiraIssue;
  error?: string;
}

interface BulkCreateIssuesResponse {
  issues?: JiraIssue[];
  errors?: Array<{
    status?: number;
    elementErrors?: JiraErrorResponse;
    failedElementNumber?: number;
  }>;
}

export interface SearchIssuesInput {
  jql: string;
  maxResults?: number;
  fields?: string[];
  nextPageToken?: string;
}

export interface LinkIssuesInput {
  linkType: string;
  inwardIssueKey: string;
  outwardIssueKey: string;
  comment?: string;
}

export interface AddAttachmentInput {
  issueKey: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
}

/**
 * Thin, typed wrapper around Jira Cloud (v3) used by all
 * MCP tools. Centralizes auth header injection, timeouts, and error
 * normalization so individual tools stay simple.
 */
export class JiraClient {
  private readonly http: AxiosInstance;
  private readonly sensitiveValues: readonly string[];
  private readonly jiraV3BaseUrl: string;
  private cloudCooldownUntil = 0;

  constructor(config: AppConfig, authProvider: AuthProvider) {
    this.sensitiveValues = authProvider.getSensitiveValues();
    this.jiraV3BaseUrl = `${config.JIRA_BASE_URL}/rest/api/3`;
    const createHttp = (basePath: string): AxiosInstance => {
      const instance = axios.create({
        baseURL: `${config.JIRA_BASE_URL}${basePath}`,
        timeout: config.JIRA_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: config.JIRA_TLS_REJECT_UNAUTHORIZED,
        }),
        // Never let axios throw on the default "reasonable" range only; we
        // handle all non-2xx explicitly below for consistent error shaping.
        validateStatus: (status) => status >= 200 && status < 300,
      });

      instance.interceptors.request.use(async (req) => {
        while (this.cloudCooldownUntil > Date.now()) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(this.cloudCooldownUntil - Date.now(), 2147483647)),
          );
        }
        const lease = await authProvider.acquireAuth();
        req.headers.Authorization = lease.header;
        (req as AuthenticatedRequestConfig)[AUTH_LEASE] = lease;
        logger.debug(`-> ${req.method?.toUpperCase()} ${req.url}`);
        return req;
      });

      return instance;
    };

    this.http = createHttp("/rest/api/3");
  }

  private async request<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    let rateLimitRetries = 0;
    while (true) {
      try {
        const { data } = await fn();
        return data;
      } catch (err) {
        if (isAxiosError(err)) {
          const axiosErr = err as AxiosError<unknown>;
          if (axiosErr.response?.status === 429) {
            const retryAfter = axiosErr.response.headers["retry-after"];
            const retryAfterMs = retryAfter === undefined
              ? Math.ceil(1000 * 2 ** rateLimitRetries * (1 + Math.random()))
              : parseRetryAfter(retryAfter);
            this.cloudCooldownUntil = Math.max(
              this.cloudCooldownUntil,
              Date.now() + retryAfterMs,
            );
            (axiosErr.config as AuthenticatedRequestConfig | undefined)?.[AUTH_LEASE]
              ?.markRateLimited(retryAfterMs);
            if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
              rateLimitRetries++;
              logger.warn("Jira rate limit reached; retrying after credential cooldown", {
                status: 429,
                url: axiosErr.config?.url,
                retryAfterMs,
                retry: rateLimitRetries,
              });
              continue;
            }
          }

          const message = extractJiraErrorMessage(axiosErr, this.sensitiveValues);
          logger.error(`Jira API error: ${message}`, {
            status: axiosErr.response?.status,
            url: axiosErr.config?.url,
          });
          throw new JiraApiError(
            message,
            axiosErr.response?.status,
            redactValue(axiosErr.response?.data, this.sensitiveValues),
          );
        }
        throw err;
      }
    }
  }

  async getMyself(): Promise<JiraUser> {
    return this.request(() =>
      this.http.get<JiraUser>("/myself", {
        params: { expand: "groups" },
      }),
    );
  }

  async getServerInfo(): Promise<JiraServerInfo> {
    return this.request(() => this.http.get<JiraServerInfo>("/serverInfo"));
  }

  async searchIssues(input: SearchIssuesInput): Promise<JiraSearchResult> {
    const fields =
      input.fields ??
      ["summary", "status", "assignee", "reporter", "created", "updated"];
    return this.searchCloudIssues({ ...input, fields });
  }

  async getIssuesBulk(issueKeys: string[], fields?: string[]): Promise<JiraSearchResult> {
    const escapedKeys = issueKeys.map((key) => `"${key.replaceAll('"', '\\"')}"`);
    const requestedFields = fields ?? [
      "summary", "description", "status", "labels", "assignee", "reporter",
      "created", "updated", "issuetype", "project",
    ];
    return this.searchCloudIssues({
      jql: `key in (${escapedKeys.join(",")})`,
      maxResults: issueKeys.length,
      fields: requestedFields,
    });
  }

  private async searchCloudIssues(input: SearchIssuesInput): Promise<JiraSearchResult> {
    const limit = input.maxResults ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new JiraApiError("Cloud search maxResults must be an integer between 1 and 1000");
    }
    const issues: JiraIssue[] = [];
    let nextPageToken = input.nextPageToken;
    const seenTokens = new Set<string>();
    if (nextPageToken) seenTokens.add(nextPageToken);
    for (let pageNumber = 0; pageNumber < MAX_CLOUD_PAGES; pageNumber++) {
      const page = await this.request(() =>
        this.http.post<JiraCloudSearchResult>("/search/jql", {
          jql: input.jql,
          maxResults: limit - issues.length,
          fields: input.fields,
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      );
      issues.push(...page.issues);
      if (issues.length > limit) {
        throw new JiraApiError("Jira Cloud search returned more issues than the requested limit");
      }
      nextPageToken = page.nextPageToken;
      const isLast = page.isLast ?? !nextPageToken;
      if (!isLast && (!nextPageToken || seenTokens.has(nextPageToken))) {
        throw new JiraApiError("Jira Cloud search returned an invalid or repeated continuation token");
      }
      if (isLast || issues.length === limit) {
        return {
          startAt: 0,
          maxResults: limit,
          issues,
          isLast,
          ...(!isLast ? { nextPageToken } : {}),
        };
      }
      if (nextPageToken) seenTokens.add(nextPageToken);
    }
    throw new JiraApiError(`Jira Cloud search exceeded the ${MAX_CLOUD_PAGES}-page safety limit`);
  }

  private issueCreateFields(input: CreateIssueInput): Record<string, unknown> {
    return {
      project: { key: input.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
      ...(input.description ? { description: this.richText(input.description) } : {}),
      ...(input.labels?.length ? { labels: input.labels } : {}),
      ...customFieldOptionFields(input.customFieldOptions),
    };
  }

  private richText(text: string) {
    return textToAdf(text);
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request(() =>
      this.http.get<JiraIssue>(`/issue/${encodeURIComponent(issueKey)}`, {
        params: {
          fields: "summary,description,status,comment,labels,assignee,reporter,created,updated,issuetype,project",
        },
      }),
    );
  }

  async createIssue(input: CreateIssueInput): Promise<JiraIssue> {
    return this.request(() =>
      this.http.post<JiraIssue>("/issue", {
        fields: this.issueCreateFields(input),
      }),
    );
  }

  async createIssuesBulk(
    inputs: CreateIssueInput[],
  ): Promise<Array<BulkOperationResult<CreateIssueInput>>> {
    const results: Array<BulkOperationResult<CreateIssueInput>> = [];

    for (let offset = 0; offset < inputs.length; offset += 50) {
      const batch = inputs.slice(offset, offset + 50);
      try {
        const response = await this.request(() =>
          this.http.post<BulkCreateIssuesResponse>("/issue/bulk", {
            issueUpdates: batch.map((input) => ({
              fields: this.issueCreateFields(input),
            })),
          }),
        );

        const failures = new Map(
          (response.errors ?? []).map((error) => [error.failedElementNumber, error]),
        );
        let createdIndex = 0;
        batch.forEach((input, batchIndex) => {
          const failure = failures.get(batchIndex);
          if (failure) {
            const details = failure.elementErrors;
            const messages = [
              ...(details?.errorMessages ?? []),
              ...Object.entries(details?.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
            ];
            results.push({
              index: offset + batchIndex,
              input,
              error: messages.join("; ") || `Jira returned status ${failure.status ?? "unknown"}`,
            });
          } else {
            const issue = response.issues?.[createdIndex++];
            results.push(
              issue
                ? { index: offset + batchIndex, input, issue }
                : {
                    index: offset + batchIndex,
                    input,
                    error: "Jira did not return a created issue or an error for this item",
                  },
            );
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        batch.forEach((input, batchIndex) => {
          results.push({ index: offset + batchIndex, input, error: message });
        });
      }
    }

    return results.sort((left, right) => left.index - right.index);
  }

  async addComment(issueKey: string, comment: string): Promise<JiraComment> {
    return this.request(() =>
      this.http.post<JiraComment>(
        `/issue/${encodeURIComponent(issueKey)}/comment`,
        { body: this.richText(comment) },
      ),
    );
  }

  async addAttachment(input: AddAttachmentInput): Promise<JiraAttachment[]> {
    let meta: JiraAttachmentMeta = {};
    try {
      meta = await this.request(() =>
        this.http.get<JiraAttachmentMeta>("/attachment/meta"),
      );
    } catch (err) {
      logger.warn("Could not read Jira attachment metadata; using the 250 MB safety limit", {
        issueKey: input.issueKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (meta.enabled === false) {
      throw new JiraApiError("Jira attachments are disabled on this instance");
    }

    const configuredLimit = meta.uploadLimit;
    const maxBytes = typeof configuredLimit === "number"
      && Number.isFinite(configuredLimit)
      && configuredLimit > 0
      ? configuredLimit
      : DEFAULT_MAX_ATTACHMENT_BYTES;
    const padding = input.contentBase64.endsWith("==")
      ? 2
      : input.contentBase64.endsWith("=") ? 1 : 0;
    const size = Math.floor(input.contentBase64.length * 3 / 4) - padding;
    if (size > maxBytes) {
      throw new JiraApiError(
        `Attachment '${input.filename}' is ${size} bytes; Jira's upload limit is ${maxBytes} bytes`,
        413,
      );
    }

    const content = Buffer.from(input.contentBase64, "base64");
    logger.info("Uploading Jira attachment", {
      issueKey: input.issueKey,
      filename: input.filename,
      size: content.length,
      mimeType: input.mimeType,
    });

    return this.request(() => {
      // Construct a fresh form for each attempt because multipart streams cannot
      // be replayed after a 429 response.
      const form = new FormData();
      form.append("file", content, {
        filename: input.filename,
        contentType: input.mimeType,
        knownLength: content.length,
      });
      return this.http.post<JiraAttachment[]>(
        `/issue/${encodeURIComponent(input.issueKey)}/attachments`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            "X-Atlassian-Token": "no-check",
          },
          maxBodyLength: maxBytes,
        },
      );
    });
  }

  async addIssueLabels(issueKey: string, labels: string[]): Promise<void> {
    await this.request(() =>
      this.http.put<void>(`/issue/${encodeURIComponent(issueKey)}`, {
        update: {
          labels: labels.map((label) => ({ add: label })),
        },
      }),
    );
  }

  async updateIssue(input: UpdateIssueInput): Promise<void> {
    const fields = {
      ...input.fields,
      ...customFieldOptionFields(input.customFieldOptions),
    };
    for (const field of ["description", "environment"]) {
      if (typeof fields[field] === "string") fields[field] = textToAdf(fields[field]);
    }
    const customStrings = Object.keys(fields).filter(
      (key) => key.startsWith("customfield_") && typeof fields[key] === "string",
    );
    if (customStrings.length) {
      const metadata = await this.getIssueEditMeta(input.issueKey);
      for (const key of customStrings) {
        if (metadata.fields[key]?.schema?.custom ===
          "com.atlassian.jira.plugin.system.customfieldtypes:textarea"
          && typeof fields[key] === "string") {
          fields[key] = textToAdf(fields[key]);
        }
      }
    }
    const labelUpdates = [
      ...(input.labelsToAdd ?? []).map((label) => ({ add: label })),
      ...(input.labelsToRemove ?? []).map((label) => ({ remove: label })),
    ];
    await this.request(() =>
      this.http.put<void>(`/issue/${encodeURIComponent(input.issueKey)}`, {
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        ...(labelUpdates.length > 0 ? { update: { labels: labelUpdates } } : {}),
      }),
    );
  }

  async updateIssues(
    inputs: UpdateIssueInput[],
    concurrency = 5,
  ): Promise<Array<BulkOperationResult<UpdateIssueInput>>> {
    const results: Array<BulkOperationResult<UpdateIssueInput>> = new Array(inputs.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < inputs.length) {
        const index = nextIndex++;
        const input = inputs[index];
        try {
          await this.updateIssue(input);
          results[index] = { index, input };
        } catch (err) {
          results[index] = {
            index,
            input,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
    );
    return results;
  }

  async getTransitions(issueKey: string): Promise<JiraTransitionsResult> {
    return this.request(() =>
      this.http.get<JiraTransitionsResult>(
        `/issue/${encodeURIComponent(issueKey)}/transitions`,
      ),
    );
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request(() =>
      this.http.post<void>(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
        transition: { id: transitionId },
      }),
    );
  }

  async getIssueComments(issueKey: string): Promise<{ comments: JiraComment[]; total: number }> {
    const comments: JiraComment[] = [];
    let startAt = 0;
    for (let pageNumber = 0; pageNumber < MAX_CLOUD_PAGES; pageNumber++) {
      const page = await this.request(() =>
        this.http.get<JiraCommentsPage>(
          `/issue/${encodeURIComponent(issueKey)}/comment`,
          { params: { startAt, maxResults: 100 } },
        ),
      );
      if (page.startAt !== undefined && page.startAt !== startAt) {
        throw new JiraApiError("Jira Cloud returned an unexpected comment page offset");
      }
      comments.push(...page.comments);
      if (comments.length > MAX_CLOUD_COLLECTION_ITEMS) {
        throw new JiraApiError(`Cloud comments exceeded the ${MAX_CLOUD_COLLECTION_ITEMS}-item safety limit`);
      }
      if (comments.length >= page.total) return { comments, total: page.total };
      if (!page.comments.length) {
        throw new JiraApiError("Jira Cloud returned an empty comment page before the reported total");
      }
      startAt += page.comments.length;
    }
    throw new JiraApiError(`Cloud comments exceeded the ${MAX_CLOUD_PAGES}-page safety limit`);
  }

  async getProjects(): Promise<JiraProject[]> {
    const projects: JiraProject[] = [];
    let startAt = 0;
    for (let pageNumber = 0; pageNumber < MAX_CLOUD_PAGES; pageNumber++) {
      const page = await this.request(() =>
        this.http.get<JiraPage<JiraProject>>("/project/search", {
          params: { startAt, maxResults: 100 },
        }),
      );
      if (page.startAt !== startAt) {
        throw new JiraApiError("Jira Cloud returned an unexpected project page offset");
      }
      projects.push(...page.values);
      if (projects.length > MAX_CLOUD_COLLECTION_ITEMS) {
        throw new JiraApiError(`Cloud projects exceeded the ${MAX_CLOUD_COLLECTION_ITEMS}-item safety limit`);
      }
      if (page.isLast === true || (page.isLast === undefined
        && page.total !== undefined && projects.length >= page.total)) {
        return projects;
      }
      if (!page.values.length) {
        if (page.isLast === false || (page.total !== undefined && projects.length < page.total)) {
          throw new JiraApiError("Jira Cloud returned an empty project page before the end");
        }
        return projects;
      }
      startAt += page.values.length;
    }
    throw new JiraApiError(`Cloud projects exceeded the ${MAX_CLOUD_PAGES}-page safety limit`);
  }

  async getIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
    const response = await this.request(() =>
      this.http.get<{ issueLinkTypes: JiraIssueLinkType[] }>("/issueLinkType"),
    );
    return response.issueLinkTypes;
  }

  async linkIssues(input: LinkIssuesInput): Promise<void> {
    await this.request(() =>
      this.http.post<void>("/issueLink", {
        type: { name: input.linkType },
        inwardIssue: { key: input.inwardIssueKey },
        outwardIssue: { key: input.outwardIssueKey },
        ...(input.comment ? { comment: { body: this.richText(input.comment) } } : {}),
      }),
    );
  }

  async getIssueRemoteLinks(issueKey: string): Promise<JiraRemoteLink[]> {
    return this.request(() =>
      this.http.get<JiraRemoteLink[]>(
        `/issue/${encodeURIComponent(issueKey)}/remotelink`,
      ),
    );
  }

  /**
   * Fetches the edit metadata for an issue (GET /rest/api/3/issue/{key}/editmeta): every
   * field editable on that issue, keyed by its Jira field id (e.g. "customfield_12402"),
   * including each field's display name, schema/type (including Xray's custom field types
   * such as its Manual Test Steps repository), and, for option-backed fields, the list of
   * allowed values with their option ids. This is how an agent discovers the real
   * customfield_NNNNN id and shape for a project- or issue-type-specific field (like an
   * Xray "Test Steps" field) instead of guessing one.
   */
  async getIssueEditMeta(issueKey: string): Promise<JiraEditMetaResponse> {
    return this.request(() =>
      this.http.get<JiraEditMetaResponse>(
        `/issue/${encodeURIComponent(issueKey)}/editmeta`,
      ),
    );
  }

}
