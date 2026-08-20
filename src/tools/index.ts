import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import type { ConfluenceClient } from "../confluence-client.js";

import { registerGetCurrentUserTool } from "./get-current-user.js";
import { registerServerInfoTool } from "./server-info.js";
import { registerSearchIssuesTool } from "./search-issues.js";
import { registerGetIssueTool } from "./get-issue.js";
import { registerGetIssuesBulkTool } from "./get-issues-bulk.js";
import { registerCreateIssueTool } from "./create-issue.js";
import { registerCreateIssuesBulkTool } from "./create-issues-bulk.js";
import { registerAddCommentTool } from "./add-comment.js";
import { registerAddIssueLabelsTool } from "./add-issue-labels.js";
import { registerUpdateIssueTool } from "./update-issue.js";
import { registerUpdateIssuesBulkTool } from "./update-issues-bulk.js";
import { registerTransitionIssueTool } from "./transition-issue.js";
import { registerGetProjectsTool } from "./get-projects.js";
import { registerGetTransitionsTool } from "./get-transitions.js";
import { registerGetIssueCommentsTool } from "./get-issue-comments.js";
import { registerGetIssueRemoteLinksTool } from "./get-issue-remote-links.js";
import { registerGetIssueLinkTypesTool } from "./get-issue-link-types.js";
import { registerGetIssueEditMetaTool } from "./get-issue-edit-meta.js";
import { registerCreateIssueLinkTool } from "./create-issue-link.js";
import { registerExecuteJqlTool } from "./execute-jql.js";
import { registerCreateJiraStoryFromRequirementsTool } from "./create-story-from-requirements.js";
import { registerConfluenceTools } from "./confluence/index.js";

/**
 * Registers every MCP tool exposed by this server. Confluence tools are only
 * registered when a ConfluenceClient is provided (CONFLUENCE_BASE_URL set).
 */
export function registerAllTools(
  server: McpServer,
  client: JiraClient,
  confluenceClient?: ConfluenceClient,
): void {
  // Core tools
  registerGetCurrentUserTool(server, client);
  registerServerInfoTool(server, client);
  registerSearchIssuesTool(server, client);
  registerGetIssueTool(server, client);
  registerGetIssuesBulkTool(server, client);
  registerCreateIssueTool(server, client);
  registerCreateIssuesBulkTool(server, client);
  registerAddCommentTool(server, client);
  registerAddIssueLabelsTool(server, client);
  registerUpdateIssueTool(server, client);
  registerUpdateIssuesBulkTool(server, client);
  registerTransitionIssueTool(server, client);
  registerGetProjectsTool(server, client);

  // Bonus tools
  registerGetTransitionsTool(server, client);
  registerGetIssueCommentsTool(server, client);
  registerGetIssueRemoteLinksTool(server, client);
  registerGetIssueLinkTypesTool(server, client);
  registerGetIssueEditMetaTool(server, client);
  registerCreateIssueLinkTool(server, client);
  registerExecuteJqlTool(server, client);
  registerCreateJiraStoryFromRequirementsTool(server, client);

  // Confluence tools (optional)
  if (confluenceClient) {
    registerConfluenceTools(server, confluenceClient);
  }
}
