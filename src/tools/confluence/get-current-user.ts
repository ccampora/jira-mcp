import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceCurrentUserTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_get_current_user",
    {
      title: "Confluence: Get Current User",
      description:
        "Returns the Confluence user for the configured credentials (GET /rest/api/user/current).",
      inputSchema: {},
    },
    async () => {
      try {
        const user = await client.getCurrentUser();
        return jsonResult({
          username: user.username,
          userKey: user.userKey,
          displayName: user.displayName,
          email: user.email,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
