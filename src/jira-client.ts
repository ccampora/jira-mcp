import axios, {
  AxiosInstance,
  AxiosError,
  isAxiosError,
  type InternalAxiosRequestConfig,
} from "axios";
import https from "node:https";
import type { AuthLease, AuthProvider } from "./auth.js";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import type {
  JiraUser,
  JiraServerInfo,
  JiraIssue,
  JiraSearchResult,
  JiraTransitionsResult,
  JiraProject,
  JiraComment,
  JiraIssueLinkType,
  JiraRemoteLink,
  JiraErrorResponse,
  JiraEditMetaResponse,
} from "./types.js";

const AUTH_LEASE = Symbol("jiraAuthLease");
const MAX_RATE_LIMIT_RETRIES = 5;
const DEFAULT_RETRY_AFTER_MS = 1000;

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
    public readonly jiraErrors?: JiraErrorResponse,
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
  error: AxiosError<JiraErrorResponse>,
  secrets: readonly string[],
): string {
  const data = error.response?.data;
  const parts: string[] = [];
  if (data?.errorMessages?.length) {
    parts.push(...data.errorMessages);
  }
  if (data?.errors) {
    for (const [field, msg] of Object.entries(data.errors)) {
      parts.push(`${field}: ${msg}`);
    }
  }
  if (parts.length > 0) {
    return redactString(parts.join("; "), secrets);
  }
  return redactString(error.message, secrets);
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
}

export interface LinkIssuesInput {
  linkType: string;
  inwardIssueKey: string;
  outwardIssueKey: string;
  comment?: string;
}

/**
 * Thin, typed wrapper around the Jira Data Center REST API (v2) used by all
 * MCP tools. Centralizes auth header injection, timeouts, and error
 * normalization so individual tools stay simple.
 */
export class JiraClient {
  private readonly http: AxiosInstance;
  private readonly sensitiveValues: readonly string[];

  constructor(config: AppConfig, authProvider: AuthProvider) {
    this.sensitiveValues = authProvider.getSensitiveValues();
    this.http = axios.create({
      baseURL: `${config.JIRA_BASE_URL}/rest/api/2`,
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

    this.http.interceptors.request.use(async (req) => {
      const lease = await authProvider.acquireAuth();
      req.headers.Authorization = lease.header;
      (req as AuthenticatedRequestConfig)[AUTH_LEASE] = lease;
      logger.debug(`-> ${req.method?.toUpperCase()} ${req.url}`);
      return req;
    });
  }

  private async request<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    let rateLimitRetries = 0;
    while (true) {
      try {
        const { data } = await fn();
        return data;
      } catch (err) {
        if (isAxiosError(err)) {
          const axiosErr = err as AxiosError<JiraErrorResponse>;
          if (axiosErr.response?.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            const retryAfterMs = parseRetryAfter(axiosErr.response.headers["retry-after"]);
            (axiosErr.config as AuthenticatedRequestConfig | undefined)?.[AUTH_LEASE]
              ?.markRateLimited(retryAfterMs);
            rateLimitRetries++;
            logger.warn("Jira rate limit reached; retrying with an available credential", {
              status: 429,
              url: axiosErr.config?.url,
              retryAfterMs,
              retry: rateLimitRetries,
            });
            continue;
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
    return this.request(() =>
      this.http.get<JiraSearchResult>("/search", {
        params: {
          jql: input.jql,
          maxResults: input.maxResults ?? 50,
          fields: fields.join(","),
        },
      }),
    );
  }

  async getIssuesBulk(issueKeys: string[], fields?: string[]): Promise<JiraSearchResult> {
    const escapedKeys = issueKeys.map((key) => `"${key.replaceAll('"', '\\"')}"`);
    return this.request(() =>
      this.http.post<JiraSearchResult>("/search", {
        jql: `key in (${escapedKeys.join(",")})`,
        maxResults: issueKeys.length,
        fields: fields ?? [
          "summary",
          "description",
          "status",
          "labels",
          "assignee",
          "reporter",
          "created",
          "updated",
          "issuetype",
          "project",
        ],
      }),
    );
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
        fields: {
          project: { key: input.projectKey },
          issuetype: { name: input.issueType },
          summary: input.summary,
          ...(input.description ? { description: input.description } : {}),
          ...(input.labels?.length ? { labels: input.labels } : {}),
          ...customFieldOptionFields(input.customFieldOptions),
        },
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
              fields: {
                project: { key: input.projectKey },
                issuetype: { name: input.issueType },
                summary: input.summary,
                ...(input.description ? { description: input.description } : {}),
                ...(input.labels?.length ? { labels: input.labels } : {}),
                ...customFieldOptionFields(input.customFieldOptions),
              },
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
        { body: comment },
      ),
    );
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
    return this.request(() =>
      this.http.get<{ comments: JiraComment[]; total: number }>(
        `/issue/${encodeURIComponent(issueKey)}/comment`,
      ),
    );
  }

  async getProjects(): Promise<JiraProject[]> {
    return this.request(() => this.http.get<JiraProject[]>("/project"));
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
        ...(input.comment ? { comment: { body: input.comment } } : {}),
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
   * Fetches the edit metadata for an issue (GET /rest/api/2/issue/{key}/editmeta): every
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
