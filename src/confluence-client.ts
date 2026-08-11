import axios, { AxiosInstance, AxiosError, isAxiosError } from "axios";
import https from "node:https";
import type { AuthProvider } from "./auth.js";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import type {
  ConfluenceUser,
  ConfluenceContent,
  ConfluenceContentArray,
  ConfluenceSpaceArray,
  ConfluenceErrorResponse,
} from "./confluence-types.js";

/**
 * Error raised for any non-2xx response (or network failure) from the
 * Confluence REST API. Carries the HTTP status code and Confluence's own
 * error details (when available) so tools can surface actionable messages.
 */
export class ConfluenceApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly confluenceError?: ConfluenceErrorResponse,
  ) {
    super(message);
    this.name = "ConfluenceApiError";
  }
}

function extractConfluenceErrorMessage(
  error: AxiosError<ConfluenceErrorResponse>,
): string {
  const data = error.response?.data;
  const parts: string[] = [];
  if (data?.message) {
    parts.push(data.message);
  }
  const nested = data?.data?.errors;
  if (nested?.length) {
    for (const e of nested) {
      const t = e.message?.translation;
      if (t) parts.push(t);
    }
  }
  if (parts.length > 0) {
    return parts.join("; ");
  }
  return error.message;
}

export interface ConfluenceSearchInput {
  cql: string;
  limit?: number;
  expand?: string[];
}

export interface GetPageInput {
  pageId: string;
  expand?: string[];
}

export interface GetPageByTitleInput {
  spaceKey: string;
  title: string;
  expand?: string[];
}

export interface CreatePageInput {
  spaceKey: string;
  title: string;
  bodyStorage: string;
  parentId?: string;
}

export interface UpdatePageInput {
  pageId: string;
  title: string;
  bodyStorage: string;
  versionNumber: number;
  versionMessage?: string;
}

/**
 * Thin, typed wrapper around the Confluence Data Center / Server REST API
 * (`/rest/api`) used by the Confluence MCP tools. Mirrors JiraClient:
 * centralizes auth header injection, timeouts, and error normalization.
 */
export class ConfluenceClient {
  private readonly http: AxiosInstance;

  constructor(config: AppConfig, authProvider: AuthProvider) {
    if (!config.CONFLUENCE_BASE_URL) {
      throw new Error("ConfluenceClient requires CONFLUENCE_BASE_URL to be set");
    }
    this.http = axios.create({
      baseURL: `${config.CONFLUENCE_BASE_URL}/rest/api`,
      timeout: config.JIRA_TIMEOUT_MS,
      headers: {
        Authorization: authProvider.getAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.JIRA_TLS_REJECT_UNAUTHORIZED,
      }),
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
        const axiosErr = err as AxiosError<ConfluenceErrorResponse>;
        const message = extractConfluenceErrorMessage(axiosErr);
        logger.error(`Confluence API error: ${message}`, {
          status: axiosErr.response?.status,
          url: axiosErr.config?.url,
        });
        throw new ConfluenceApiError(
          message,
          axiosErr.response?.status,
          axiosErr.response?.data,
        );
      }
      throw err;
    }
  }

  async getCurrentUser(): Promise<ConfluenceUser> {
    return this.request(() =>
      this.http.get<ConfluenceUser>("/user/current"),
    );
  }

  async getPage(input: GetPageInput): Promise<ConfluenceContent> {
    const expand = input.expand ?? ["body.storage", "version", "space", "history"];
    return this.request(() =>
      this.http.get<ConfluenceContent>(
        `/content/${encodeURIComponent(input.pageId)}`,
        { params: { expand: expand.join(",") } },
      ),
    );
  }

  async getPageByTitle(input: GetPageByTitleInput): Promise<ConfluenceContentArray> {
    const expand = input.expand ?? ["body.storage", "version", "space"];
    return this.request(() =>
      this.http.get<ConfluenceContentArray>("/content", {
        params: {
          spaceKey: input.spaceKey,
          title: input.title,
          expand: expand.join(","),
        },
      }),
    );
  }

  async createPage(input: CreatePageInput): Promise<ConfluenceContent> {
    return this.request(() =>
      this.http.post<ConfluenceContent>("/content", {
        type: "page",
        title: input.title,
        space: { key: input.spaceKey },
        ...(input.parentId ? { ancestors: [{ id: input.parentId }] } : {}),
        body: {
          storage: {
            value: input.bodyStorage,
            representation: "storage",
          },
        },
      }),
    );
  }

  async updatePage(input: UpdatePageInput): Promise<ConfluenceContent> {
    return this.request(() =>
      this.http.put<ConfluenceContent>(
        `/content/${encodeURIComponent(input.pageId)}`,
        {
          type: "page",
          title: input.title,
          version: {
            number: input.versionNumber,
            ...(input.versionMessage ? { message: input.versionMessage } : {}),
          },
          body: {
            storage: {
              value: input.bodyStorage,
              representation: "storage",
            },
          },
        },
      ),
    );
  }

  async search(input: ConfluenceSearchInput): Promise<ConfluenceContentArray> {
    const expand = input.expand ?? ["space", "version"];
    return this.request(() =>
      this.http.get<ConfluenceContentArray>("/content/search", {
        params: {
          cql: input.cql,
          limit: input.limit ?? 25,
          expand: expand.join(","),
        },
      }),
    );
  }

  async getSpaces(limit = 25): Promise<ConfluenceSpaceArray> {
    return this.request(() =>
      this.http.get<ConfluenceSpaceArray>("/space", {
        params: { limit },
      }),
    );
  }

  async getPageComments(pageId: string): Promise<ConfluenceContentArray> {
    return this.request(() =>
      this.http.get<ConfluenceContentArray>(
        `/content/${encodeURIComponent(pageId)}/child/comment`,
        { params: { expand: "body.storage,version" } },
      ),
    );
  }
}
