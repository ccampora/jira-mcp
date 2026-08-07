/**
 * Narrow, hand-picked TypeScript shapes for the subset of the Confluence Data
 * Center / Server REST API (`/rest/api`) responses this server consumes.
 * These are intentionally partial (Confluence's real payloads are much larger)
 * and use optional fields defensively since instances vary by version and
 * configuration.
 */

export interface ConfluenceUser {
  type?: string;
  username?: string;
  userKey?: string;
  accountId?: string;
  displayName?: string;
  email?: string;
}

export interface ConfluenceVersion {
  number?: number;
  when?: string;
  by?: ConfluenceUser;
  message?: string;
}

export interface ConfluenceBody {
  storage?: {
    value?: string;
    representation?: string;
  };
  view?: {
    value?: string;
    representation?: string;
  };
}

export interface ConfluenceSpaceRef {
  id?: number;
  key?: string;
  name?: string;
  type?: string;
}

export interface ConfluenceContent {
  id?: string;
  type?: string;
  status?: string;
  title?: string;
  space?: ConfluenceSpaceRef;
  version?: ConfluenceVersion;
  body?: ConfluenceBody;
  history?: {
    createdBy?: ConfluenceUser;
    createdDate?: string;
  };
  _links?: {
    webui?: string;
    self?: string;
    base?: string;
  };
}

export interface ConfluenceContentArray {
  results: ConfluenceContent[];
  start?: number;
  limit?: number;
  size?: number;
  _links?: {
    base?: string;
    next?: string;
  };
}

export interface ConfluenceSpace {
  id?: number;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
  _links?: {
    webui?: string;
    self?: string;
  };
}

export interface ConfluenceSpaceArray {
  results: ConfluenceSpace[];
  start?: number;
  limit?: number;
  size?: number;
}

/**
 * Confluence's error payloads differ from Jira's. They typically look like
 * `{ statusCode, message, reason }` or `{ message }`.
 */
export interface ConfluenceErrorResponse {
  statusCode?: number;
  message?: string;
  reason?: string;
  data?: {
    errors?: Array<{ message?: { translation?: string } }>;
  };
}
