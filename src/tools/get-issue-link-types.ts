import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetIssueLinkTypesTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue_link_types",
    {
      title: "Get Issue Link Types",
      description: "Lists the issue link types available in this Jira instance (GET /rest/api/2/issueLinkType), including their inward/outward wording. Call this before create_issue_link to use a valid link type name.",
      inputSchema: {},
    },
    async () => {
      try {
        const issueLinkTypes = await client.getIssueLinkTypes();
        return jsonResult(issueLinkTypes);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}