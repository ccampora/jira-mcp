import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetIssueLinkTypesTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue_link_types",
    {
      title: "Get Issue Link Types",
      description: "Lists available issue link types using Jira Cloud v3, including inward/outward wording. Call before create_issue_link to discover a valid name.",
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