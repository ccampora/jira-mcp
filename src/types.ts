/**
 * Narrow, hand-picked TypeScript shapes for the subset of the Jira Data
 * Center REST API (v2) responses this server consumes. These are
 * intentionally partial (Jira's real payloads are much larger) and use
 * optional fields defensively since Data Center instances vary by version
 * and configuration.
 */

export interface JiraUser {
  name?: string;
  key?: string;
  emailAddress?: string;
  displayName?: string;
  active?: boolean;
  groups?: {
    items?: Array<{ name: string }>;
  };
}

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
  description?: string;
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
  body?: string;
  created?: string;
  updated?: string;
}

export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
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

export interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}
