import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import type { ConfluenceClient } from "../confluence-client.js";

import { registerGetCurrentUserTool } from "./get-current-user.js";
import { registerServerInfoTool } from "./server-info.js";
import { registerSearchIssuesTool } from "./search-issues.js";
import { registerGetIssueTool } from "./get-issue.js";
import { registerCreateIssueTool } from "./create-issue.js";
import { registerAddCommentTool } from "./add-comment.js";
import { registerTransitionIssueTool } from "./transition-issue.js";
import { registerGetProjectsTool } from "./get-projects.js";
import { registerGetTransitionsTool } from "./get-transitions.js";
import { registerGetIssueCommentsTool } from "./get-issue-comments.js";
import { registerGetIssueRemoteLinksTool } from "./get-issue-remote-links.js";
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
  registerCreateIssueTool(server, client);
  registerAddCommentTool(server, client);
  registerTransitionIssueTool(server, client);
  registerGetProjectsTool(server, client);

  // Bonus tools
  registerGetTransitionsTool(server, client);
  registerGetIssueCommentsTool(server, client);
  registerGetIssueRemoteLinksTool(server, client);
  registerExecuteJqlTool(server, client);
  registerCreateJiraStoryFromRequirementsTool(server, client);

  // Confluence tools (optional)
  if (confluenceClient) {
    registerConfluenceTools(server, confluenceClient);
  }
}
