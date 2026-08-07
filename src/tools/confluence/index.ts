import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";

import { registerConfluenceCurrentUserTool } from "./get-current-user.js";
import { registerConfluenceGetPageTool } from "./get-page.js";
import { registerConfluenceGetPageByTitleTool } from "./get-page-by-title.js";
import { registerConfluenceSearchTool } from "./search.js";
import { registerConfluenceGetSpacesTool } from "./get-spaces.js";
import { registerConfluenceGetPageCommentsTool } from "./get-page-comments.js";

/**
 * Registers every Confluence MCP tool. Only called when Confluence support is
 * enabled (CONFLUENCE_BASE_URL configured).
 */
export function registerConfluenceTools(
  server: McpServer,
  client: ConfluenceClient,
): void {
  registerConfluenceCurrentUserTool(server, client);
  registerConfluenceGetSpacesTool(server, client);
  registerConfluenceSearchTool(server, client);
  registerConfluenceGetPageTool(server, client);
  registerConfluenceGetPageByTitleTool(server, client);
  registerConfluenceGetPageCommentsTool(server, client);
}
