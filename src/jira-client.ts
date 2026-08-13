import axios, { AxiosInstance, AxiosError, isAxiosError } from "axios";
import https from "node:https";
import type { AuthProvider } from "./auth.js";
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
} from "./types.js";

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

function extractJiraErrorMessage(error: AxiosError<JiraErrorResponse>): string {
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
    return parts.join("; ");
  }
  return error.message;
}

export interface CreateIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  labels?: string[];
}

export interface UpdateIssueInput {
  issueKey: string;
  fields?: Record<string, unknown>;
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

  constructor(config: AppConfig, authProvider: AuthProvider) {
    this.http = axios.create({
      baseURL: `${config.JIRA_BASE_URL}/rest/api/2`,
      timeout: config.JIRA_TIMEOUT_MS,
      headers: {
        Authorization: authProvider.getAuthHeader(),
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

    this.http.interceptors.request.use((req) => {
      logger.debug(`-> ${req.method?.toUpperCase()} ${req.url}`);
      return req;
    });
  }

  private async request<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try {
      const { data } = await fn();
      return data;
    } catch (err) {
      if (isAxiosError(err)) {
        const axiosErr = err as AxiosError<JiraErrorResponse>;
        const message = extractJiraErrorMessage(axiosErr);
        logger.error(`Jira API error: ${message}`, {
          status: axiosErr.response?.status,
          url: axiosErr.config?.url,
        });
        throw new JiraApiError(
          message,
          axiosErr.response?.status,
          axiosErr.response?.data,
        );
      }
      throw err;
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
    const labelUpdates = [
      ...(input.labelsToAdd ?? []).map((label) => ({ add: label })),
      ...(input.labelsToRemove ?? []).map((label) => ({ remove: label })),
    ];
    await this.request(() =>
      this.http.put<void>(`/issue/${encodeURIComponent(input.issueKey)}`, {
        ...(input.fields && Object.keys(input.fields).length > 0 ? { fields: input.fields } : {}),
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
}
