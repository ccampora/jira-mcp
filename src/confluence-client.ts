import axios, { AxiosInstance, AxiosError, isAxiosError } from "axios";
import https from "node:https";
import type { AuthProvider } from "./auth.js";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import type {
  ConfluenceUser,
  ConfluenceContent,
  ConfluenceContentArray,
  ConfluenceSpace,
  ConfluenceSpaceArray,
  ConfluenceErrorResponse,
} from "./confluence-types.js";

const CLOUD_ITEM_LIMIT = 10_000;
const CLOUD_PAGE_LIMIT = 1_000;
const CLOUD_PAGE_SIZE = 100;
const CLOUD_429_RETRIES = 3;
const CLOUD_MAX_RETRY_DELAY_MS = 5_000;

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
  if (typeof data?.message === "string") {
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

type JsonObject = Record<string, unknown>;
type V2Collection = {
  results: JsonObject[];
  hasMore: boolean;
  nextCursor?: string;
  nextLink?: string;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordOrUndefined(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined;
}

function apiError(message: string, statusCode = 200): ConfluenceApiError {
  return new ConfluenceApiError(message, statusCode);
}

function requireRecord(value: unknown, endpoint: string): JsonObject {
  if (!isRecord(value)) {
    throw apiError(`Invalid JSON object returned by Confluence Cloud ${endpoint}.`);
  }
  return value;
}

function requireResults(value: unknown, endpoint: string): JsonObject[] {
  const response = requireRecord(value, endpoint);
  if (!Array.isArray(response.results) || !response.results.every(isRecord)) {
    throw apiError(`Invalid results collection returned by Confluence Cloud ${endpoint}.`);
  }
  return response.results;
}

function rawLinks(value: unknown): ConfluenceContent["_links"] {
  const links = recordOrUndefined(value);
  if (!links) return undefined;
  return Object.fromEntries(
    Object.entries(links).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizedUser(value: unknown): ConfluenceUser | undefined {
  const user = recordOrUndefined(value);
  if (!user) return undefined;
  return {
    type: stringValue(user.type),
    accountId: stringValue(user.accountId),
    accountType: stringValue(user.accountType),
    displayName: stringValue(user.displayName),
    publicName: stringValue(user.publicName),
    email: stringValue(user.email),
  };
}

function normalizedSpace(value: unknown): ConfluenceSpace | undefined {
  const space = recordOrUndefined(value);
  if (!space) return undefined;
  return {
    id: typeof space.id === "string" || typeof space.id === "number" ? space.id : undefined,
    key: stringValue(space.key),
    name: stringValue(space.name),
    type: stringValue(space.type),
    status: stringValue(space.status),
    _links: rawLinks(space._links),
  };
}

function requireCloudSpace(value: unknown, endpoint: string): ConfluenceSpace {
  const space = normalizedSpace(value);
  if (!space || space.id === undefined || !space.key) {
    throw apiError(`Invalid space returned by Confluence Cloud ${endpoint}.`);
  }
  return space;
}

function requireCloudPage(value: JsonObject, endpoint: string): ConfluenceContent {
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  if (!id || !title) {
    throw apiError(`Invalid page returned by Confluence Cloud ${endpoint}.`);
  }
  return normalizedContent(value);
}

function normalizedBody(value: unknown, defaultFormat: "storage" | "view"): ConfluenceContent["body"] {
  const body = recordOrUndefined(value);
  if (!body) return undefined;

  const result: NonNullable<ConfluenceContent["body"]> = {};
  for (const representation of ["storage", "view"] as const) {
    const nested = recordOrUndefined(body[representation]);
    if (nested) {
      result[representation] = {
        value: stringValue(nested.value),
        representation: stringValue(nested.representation) ?? representation,
      };
    }
  }

  if (typeof body.value === "string") {
    result[defaultFormat] = {
      value: body.value,
      representation: stringValue(body.representation) ?? defaultFormat,
    };
  }
  return result;
}

function normalizedContent(
  value: JsonObject,
  defaultBodyFormat: "storage" | "view" = "storage",
  knownSpace?: ConfluenceSpace,
): ConfluenceContent {
  const version = recordOrUndefined(value.version);
  const history = recordOrUndefined(value.history);
  const versionAuthor = stringValue(version?.authorId);
  const contentAuthor = stringValue(value.authorId);
  const createdAt = stringValue(version?.createdAt) ?? stringValue(value.createdAt);
  const versionBy = normalizedUser(version?.by)
    ?? ((versionAuthor ?? contentAuthor) ? { accountId: versionAuthor ?? contentAuthor } : undefined);
  const historyAuthor = normalizedUser(history?.createdBy)
    ?? (contentAuthor ? { accountId: contentAuthor } : undefined);
  const rawSpace = normalizedSpace(value.space);
  const spaceId = value.spaceId;
  const space = rawSpace ?? knownSpace ?? (
    typeof spaceId === "string" || typeof spaceId === "number" ? { id: spaceId } : undefined
  );
  const rawVersionNumber = version?.number;
  const normalizedVersion = version || versionAuthor || contentAuthor || createdAt ? {
    number: numberValue(rawVersionNumber),
    when: stringValue(version?.when) ?? createdAt,
    createdAt,
    authorId: versionAuthor,
    by: versionBy,
    message: stringValue(version?.message),
  } : undefined;

  return {
    id: stringValue(value.id),
    type: stringValue(value.type) ?? (value.spaceId !== undefined ? "page" : undefined),
    status: stringValue(value.status),
    title: stringValue(value.title),
    space,
    version: normalizedVersion,
    body: normalizedBody(value.body, defaultBodyFormat),
    history: history || contentAuthor || createdAt ? {
      createdBy: historyAuthor,
      createdDate: stringValue(history?.createdDate) ?? createdAt,
    } : undefined,
    _links: rawLinks(value._links),
  };
}

function normalizedCollection(
  results: JsonObject[],
  response: JsonObject,
): ConfluenceContentArray {
  if (results.some((result) => !stringValue(result.id) || !stringValue(result.title))) {
    throw apiError("Invalid content result returned by Confluence Cloud content/search.");
  }
  const links = rawLinks(response._links);
  return {
    results: results.map((result) => normalizedContent(result)),
    start: numberValue(response.start),
    limit: numberValue(response.limit),
    size: results.length,
    _links: links ? { base: links.base, next: links.next } : undefined,
  };
}

function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const raw = String(value).trim();
  const seconds = Number(raw);
  if (raw && Number.isFinite(seconds)) {
    return Math.max(0, Math.min(CLOUD_MAX_RETRY_DELAY_MS, seconds * 1_000));
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.min(CLOUD_MAX_RETRY_DELAY_MS, timestamp - Date.now()));
}

/**
 * Thin, typed wrapper around the Confluence Cloud REST API used by the MCP tools.
 * Cloud v2 serves pages, spaces and footer comments; v1 serves the current user
 * and CQL search.
 */
export class ConfluenceClient {
  private readonly cloudV1: AxiosInstance;
  private readonly cloudV2: AxiosInstance;
  private readonly sensitiveValues: readonly string[];

  constructor(config: AppConfig, authProvider: AuthProvider) {
    if (!config.CONFLUENCE_BASE_URL) {
      throw new Error("ConfluenceClient requires CONFLUENCE_BASE_URL to be set");
    }

    this.sensitiveValues = [...authProvider.getSensitiveValues()].filter(Boolean);

    const commonOptions = {
      timeout: config.JIRA_TIMEOUT_MS,
      headers: {
        Authorization: authProvider.getAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.JIRA_TLS_REJECT_UNAUTHORIZED,
      }),
      validateStatus: (status: number) => status >= 200 && status < 300,
    };
    const baseUrl = config.CONFLUENCE_BASE_URL.replace(/\/+$/, "");

    this.cloudV1 = axios.create({
      ...commonOptions,
      baseURL: `${baseUrl}/rest/api`,
    });
    this.cloudV2 = axios.create({
      ...commonOptions,
      baseURL: `${baseUrl}/api/v2`,
    });
    for (const client of [this.cloudV1, this.cloudV2]) {
      client.interceptors.request.use((req) => {
        logger.debug(`-> ${req.method?.toUpperCase()} ${this.redact(req.url ?? "")}`);
        return req;
      });
    }
  }

  private redact(text: string): string {
    return [...this.sensitiveValues]
      .sort((left, right) => right.length - left.length)
      .reduce((redacted, value) => redacted.split(value).join("[REDACTED]"), text);
  }

  private async cloudRequest<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await fn();
        return data;
      } catch (err) {
        if (!isAxiosError(err)) throw err;
        const axiosErr = err as AxiosError<ConfluenceErrorResponse>;
        const message = this.redact(extractConfluenceErrorMessage(axiosErr));
        const responseData = axiosErr.response?.data;
        const safeData = this.redactUnknown(responseData) as ConfluenceErrorResponse | undefined;
        logger.error(`Confluence Cloud API error: ${message}`, {
          status: axiosErr.response?.status,
          url: this.redact(axiosErr.config?.url ?? ""),
        });

        if (axiosErr.response?.status === 429 && attempt < CLOUD_429_RETRIES) {
          const retryAfter = parseRetryAfter(axiosErr.response.headers?.["retry-after"]);
          const fallback = Math.random() * Math.min(1_000, 100 * 2 ** attempt);
          await new Promise((resolve) => setTimeout(resolve, retryAfter ?? fallback));
          continue;
        }

        throw new ConfluenceApiError(message, axiosErr.response?.status, safeData);
      }
    }
  }

  private redactUnknown(value: unknown): unknown {
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value)) return value.map((entry) => this.redactUnknown(entry));
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, this.redactUnknown(entry)]),
    );
  }

  private getV1(): AxiosInstance {
    return this.cloudV1;
  }

  private getV2(): AxiosInstance {
    return this.cloudV2;
  }

  private async getV2Collection(
    endpoint: string,
    params: Record<string, string | number>,
    maximumItems: number,
    stopAtMaximum: boolean,
  ): Promise<JsonObject[]> {
    const client = this.getV2();
    const results: JsonObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < CLOUD_PAGE_LIMIT; page++) {
      const pageSize = Math.min(CLOUD_PAGE_SIZE, maximumItems - results.length);
      if (pageSize <= 0) {
        throw apiError(`Confluence Cloud ${endpoint} exceeded the ${CLOUD_ITEM_LIMIT}-item safety limit.`);
      }
      const responseValue = await this.cloudRequest(() =>
        client.get<unknown>(endpoint, {
          params: { ...params, limit: pageSize, ...(cursor ? { cursor } : {}) },
        }),
      );
      const response = requireRecord(responseValue, endpoint);
      const pageResults = requireResults(responseValue, endpoint);
      if (results.length + pageResults.length > maximumItems) {
        if (!stopAtMaximum) {
          throw apiError(`Confluence Cloud ${endpoint} exceeded the ${CLOUD_ITEM_LIMIT}-item safety limit.`);
        }
      }
      results.push(...pageResults.slice(0, maximumItems - results.length));
      const meta = recordOrUndefined(response.meta);
      const nextLink = stringValue(recordOrUndefined(response._links)?.next);
      const hasMore = typeof meta?.hasMore === "boolean"
        ? meta.hasMore
        : Boolean(stringValue(meta?.cursor) || nextLink);
      if (stopAtMaximum && results.length >= maximumItems) return results;
      if (!hasMore) return results;
      if (results.length >= maximumItems) {
        throw apiError(`Confluence Cloud ${endpoint} exceeded the ${CLOUD_ITEM_LIMIT}-item safety limit.`);
      }

      const nextCursor = stringValue(meta?.cursor)
        ?? (nextLink ? this.extractV2Cursor(endpoint, nextLink) : undefined);
      if (!nextCursor) {
        throw apiError(`Confluence Cloud ${endpoint} indicated more results without a cursor.`);
      }
      if (seenCursors.has(nextCursor)) {
        throw apiError(`Confluence Cloud ${endpoint} returned a repeated cursor.`);
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw apiError(`Confluence Cloud ${endpoint} exceeded the ${CLOUD_PAGE_LIMIT}-page safety limit.`);
  }

  private extractV2Cursor(endpoint: string, nextLink: string): string | undefined {
    const expected = new URL(`${this.getV2().defaults.baseURL}/${endpoint.replace(/^\/+/, "")}`);
    let candidate: URL;
    try {
      candidate = new URL(nextLink, expected);
    } catch {
      throw apiError(`Confluence Cloud ${endpoint} returned an invalid pagination link.`);
    }
    if (
      candidate.origin !== expected.origin
      || candidate.pathname !== expected.pathname
      || candidate.username
      || candidate.password
      || candidate.hash
    ) {
      throw apiError(`Confluence Cloud ${endpoint} returned an unsafe pagination link.`);
    }
    return candidate.searchParams.get("cursor") ?? undefined;
  }

  private extractV1Start(endpoint: string, nextLink: string): number | undefined {
    const expected = new URL(`${this.getV1().defaults.baseURL}/${endpoint.replace(/^\/+/, "")}`);
    let candidate: URL;
    try {
      candidate = new URL(nextLink, expected);
    } catch {
      throw apiError(`Confluence Cloud ${endpoint} returned an invalid pagination link.`);
    }
    if (
      candidate.origin !== expected.origin
      || candidate.pathname !== expected.pathname
      || candidate.username
      || candidate.password
      || candidate.hash
    ) {
      throw apiError(`Confluence Cloud ${endpoint} returned an unsafe pagination link.`);
    }
    const start = candidate.searchParams.get("start");
    if (start === null || !/^\d+$/.test(start)) {
      throw apiError(`Confluence Cloud ${endpoint} returned an invalid pagination offset.`);
    }
    return Number(start);
  }

  private async getCloudSpaceById(spaceId: string | number): Promise<ConfluenceSpace | undefined> {
    const endpoint = `spaces/${encodeURIComponent(String(spaceId))}`;
    const value = await this.cloudRequest(() => this.getV2().get<unknown>(endpoint));
    const response = requireRecord(value, endpoint);
    return requireCloudSpace(response, endpoint);
  }

  private async getCloudSpacesByKey(spaceKey: string): Promise<ConfluenceSpace[]> {
    const spaces = await this.getV2Collection("spaces", { keys: spaceKey }, CLOUD_ITEM_LIMIT, false);
    return spaces
      .map((space) => requireCloudSpace(space, "spaces"))
      .filter((space) => space.key?.toLocaleLowerCase() === spaceKey.toLocaleLowerCase());
  }

  private async createCloudPage(input: CreatePageInput): Promise<ConfluenceContent> {
    const spaces = await this.getCloudSpacesByKey(input.spaceKey);
    const space = spaces.find((entry) => entry.id !== undefined);
    if (space?.id === undefined || space.id === "") {
      throw new ConfluenceApiError(
        `Confluence Cloud space "${input.spaceKey}" was not found; the page was not created.`,
        404,
      );
    }
    const body = {
      spaceId: String(space.id),
      status: "current",
      title: input.title,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      body: { representation: "storage", value: input.bodyStorage },
    };
    const responseValue = await this.cloudRequest(() =>
      this.getV2().post<unknown>("pages", body),
    );
    const response = requireRecord(responseValue, "pages");
    const page = requireCloudPage(response, "pages");
    page.space = space;
    return page;
  }

  async getCurrentUser(): Promise<ConfluenceUser> {
    const value = await this.cloudRequest(() =>
      this.getV1().get<unknown>("/user/current"),
    );
    const user = normalizedUser(requireRecord(value, "/user/current"));
    if (!user?.accountId) {
      throw apiError("Invalid current-user response returned by Confluence Cloud /user/current.");
    }
    return user;
  }

  async getPage(input: GetPageInput): Promise<ConfluenceContent> {
    const bodyFormat = input.expand?.some((part) => part === "body.view") ? "view" : "storage";
    const endpoint = `pages/${encodeURIComponent(input.pageId)}`;
    const value = await this.cloudRequest(() =>
      this.getV2().get<unknown>(endpoint, { params: { "body-format": bodyFormat } }),
    );
    const raw = requireRecord(value, endpoint);
    const content = requireCloudPage(raw, endpoint);
    content.body = normalizedBody(raw.body, bodyFormat);
    if (!content.space?.key && content.space?.id !== undefined) {
      content.space = await this.getCloudSpaceById(content.space.id);
    }
    return content;
  }

  async getPageByTitle(input: GetPageByTitleInput): Promise<ConfluenceContentArray> {
    const spaces = await this.getCloudSpacesByKey(input.spaceKey);
    const space = spaces.find((entry) => entry.id !== undefined);
    if (space?.id === undefined || space.id === "") return { results: [], size: 0 };
    const rawPages = await this.getV2Collection(
      "pages",
      { "space-id": String(space.id), title: input.title, "body-format": "storage" },
      CLOUD_ITEM_LIMIT,
      false,
    );
    return {
      results: rawPages.map((page) => {
        const normalized = requireCloudPage(page, "pages");
        normalized.body = normalizedBody(page.body, "storage");
        normalized.space = space;
        return normalized;
      }),
      size: rawPages.length,
    };
  }

  async createPage(input: CreatePageInput): Promise<ConfluenceContent> {
    return this.createCloudPage(input);
  }

  async updatePage(input: UpdatePageInput): Promise<ConfluenceContent> {
    const endpoint = `pages/${encodeURIComponent(input.pageId)}`;
    const responseValue = await this.cloudRequest(() =>
      this.getV2().put<unknown>(endpoint, {
        id: input.pageId,
        status: "current",
        title: input.title,
        body: { representation: "storage", value: input.bodyStorage },
        version: {
          number: input.versionNumber,
          ...(input.versionMessage ? { message: input.versionMessage } : {}),
        },
      }),
    );
    return requireCloudPage(requireRecord(responseValue, endpoint), endpoint);
  }

  async search(input: ConfluenceSearchInput): Promise<ConfluenceContentArray> {
    const requestedLimit = input.limit ?? 25;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new Error("Confluence search limit must be a positive integer.");
    }
    const expand = input.expand ?? ["space", "version"];
    const endpoint = "content/search";
    const collected: JsonObject[] = [];
    let start = 0;
    let firstResponse: JsonObject | undefined;
    const visitedStarts = new Set<number>([start]);

    for (let page = 0; page < CLOUD_PAGE_LIMIT && collected.length < requestedLimit; page++) {
      const pageLimit = Math.min(CLOUD_PAGE_SIZE, requestedLimit - collected.length);
      const value = await this.cloudRequest(() =>
        this.getV1().get<unknown>(endpoint, {
          params: { cql: input.cql, limit: pageLimit, start, expand: expand.join(",") },
        }),
      );
      const response = requireRecord(value, endpoint);
      const results = requireResults(value, endpoint);
      firstResponse ??= response;
      collected.push(...results.slice(0, requestedLimit - collected.length));
      const nextLink = stringValue(recordOrUndefined(response._links)?.next);
      if (collected.length >= requestedLimit || (!nextLink && results.length < pageLimit)) break;
      const nextStart = nextLink
        ? this.extractV1Start(endpoint, nextLink)
        : start + results.length;
      if (nextStart === undefined || visitedStarts.has(nextStart)) {
        throw apiError(`Confluence Cloud ${endpoint} returned a repeated or missing pagination offset.`);
      }
      visitedStarts.add(nextStart);
      start = nextStart;
    }
    if (collected.length < requestedLimit && visitedStarts.size >= CLOUD_PAGE_LIMIT) {
      throw apiError(`Confluence Cloud ${endpoint} exceeded the ${CLOUD_PAGE_LIMIT}-page safety limit.`);
    }
    return normalizedCollection(collected, firstResponse ?? { results: [] });
  }

  async getSpaces(limit = 25): Promise<ConfluenceSpaceArray> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Confluence spaces limit must be a positive integer.");
    }
    const results = await this.getV2Collection("spaces", {}, limit, true);
    const spaces = results.map((space) => requireCloudSpace(space, "spaces"));
    return { results: spaces, size: spaces.length };
  }

  async getPageComments(pageId: string): Promise<ConfluenceContentArray> {
    const endpoint = `pages/${encodeURIComponent(pageId)}/footer-comments`;
    const comments = await this.getV2Collection(
      endpoint,
      { "body-format": "storage" },
      CLOUD_ITEM_LIMIT,
      false,
    );
    return {
      results: comments.map((comment) => {
        if (!stringValue(comment.id)) {
          throw apiError(`Invalid comment returned by Confluence Cloud ${endpoint}.`);
        }
        return normalizedContent(comment);
      }),
      size: comments.length,
    };
  }
}
