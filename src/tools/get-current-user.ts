import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetCurrentUserTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_current_user",
    {
      title: "Get Current User",
      description:
        "Returns the Jira Cloud user identity associated with the configured credentials. Users are identified by accountId; email may be private.",
      inputSchema: {},
    },
    async () => {
      try {
        const me = await client.getMyself();
        return jsonResult({
          ...(me.accountId ? { accountId: me.accountId } : {}),
          displayName: me.displayName,
          email: me.emailAddress,
          groups: me.groups?.items?.map((g) => g.name) ?? [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
