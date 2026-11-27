/**
 * Narrow, hand-picked shapes for the Confluence Cloud REST API responses
 * consumed by this server.
 */

export interface ConfluenceUser {
  type?: string;
  accountId?: string;
  accountType?: string;
  displayName?: string;
  publicName?: string;
  email?: string;
}

export interface ConfluenceVersion {
  number?: number;
  when?: string;
  createdAt?: string;
  authorId?: string;
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
  id?: number | string;
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
    [name: string]: string | undefined;
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
  id?: number | string;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
  _links?: {
    webui?: string;
    self?: string;
    base?: string;
    [name: string]: string | undefined;
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
