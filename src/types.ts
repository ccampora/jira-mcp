/**
 * Narrow, hand-picked TypeScript shapes for Jira Cloud (v3) responses this server consumes. These are
 * intentionally partial (Jira's real payloads are much larger) and use
 * optional fields defensively since payloads vary by endpoint and configuration.
 */

export interface JiraUser {
  accountId?: string;
  accountType?: string;
  emailAddress?: string | null;
  displayName?: string;
  active?: boolean;
  groups?: {
    items?: Array<{ name: string }>;
  };
}

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: AdfNode[];
}

export interface AdfDocument extends AdfNode {
  type: "doc";
  version: 1;
  content: AdfNode[];
}

export type JiraRichText = string | AdfDocument;

export interface JiraServerInfo {
  baseUrl?: string;
  version?: string;
  versionNumbers?: number[];
  deploymentType?: string;
  buildNumber?: number;
  buildDate?: string;
  serverTime?: string;
  scmInfo?: string;
  serverTitle?: string;
}

export interface JiraIssueFields {
  summary?: string;
  description?: JiraRichText | null;
  status?: { name?: string; id?: string };
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  created?: string;
  updated?: string;
  labels?: string[];
  comment?: {
    comments?: JiraComment[];
    total?: number;
  };
  issuetype?: { name?: string; id?: string };
  project?: { key?: string; id?: string; name?: string };
  [key: string]: unknown;
}

export interface JiraIssue {
  id: string;
  key: string;
  self?: string;
  fields: JiraIssueFields;
}

export interface JiraComment {
  id?: string;
  author?: JiraUser;
  body?: JiraRichText;
  created?: string;
  updated?: string;
}

export interface JiraAttachment {
  id?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: JiraUser;
}

export interface JiraAttachmentMeta {
  enabled?: boolean;
  uploadLimit?: number;
}

export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total?: number;
  nextPageToken?: string;
  isLast?: boolean;
  issues: JiraIssue[];
}

export interface JiraCloudSearchResult {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraPage<T> {
  startAt: number;
  maxResults: number;
  total?: number;
  isLast?: boolean;
  values: T[];
}

export interface JiraCommentsPage {
  startAt?: number;
  maxResults?: number;
  total: number;
  comments: JiraComment[];
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: { id?: string; name?: string };
}

export interface JiraTransitionsResult {
  transitions: JiraTransition[];
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  lead?: JiraUser;
}

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

export interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

/**
 * A "remote link" on an issue — used by the Jira/Confluence integration to
 * attach linked Confluence pages ("Wiki Page" links), plus generic web links.
 * GET /rest/api/3/issue/{key}/remotelink returns an array of these.
 */
export interface JiraRemoteLink {
  id?: number;
  self?: string;
  globalId?: string;
  relationship?: string;
  application?: {
    type?: string;
    name?: string;
  };
  object?: {
    url?: string;
    title?: string;
    summary?: string;
    icon?: { url16x16?: string; title?: string };
  };
}

/**
 * A single field's edit metadata, as returned by GET /rest/api/3/issue/{key}/editmeta,
 * keyed by its Jira field id (e.g. "customfield_12402") in the parent map. Custom field
 * apps (like Xray) expose their own `schema.custom` type strings here (e.g.
 * "com.xpandit.plugins.xray:test-repository-manual-test-steps") so an agent can identify
 * a project- or issue-type-specific field by name/type instead of guessing an id.
 */
export interface JiraEditMetaField {
  required?: boolean;
  name?: string;
  schema?: {
    type?: string;
    custom?: string;
    customId?: number;
    items?: string;
  };
  operations?: string[];
  allowedValues?: Array<{
    id?: string;
    value?: string;
    name?: string;
  }>;
}

export interface JiraEditMetaResponse {
  fields: Record<string, JiraEditMetaField>;
}