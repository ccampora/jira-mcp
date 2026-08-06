import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerExecuteJqlTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "execute_jql",
    {
      title: "Execute Arbitrary JQL",
      description:
        "Runs an arbitrary JQL query (GET /rest/api/2/search) and returns raw issue data for the requested fields. Use this for ad-hoc reporting when search_issues' fixed field set isn't enough.",
      inputSchema: {
        jql: z.string().min(1).describe("JQL query string"),
        maxResults: z.number().int().positive().max(1000).optional().describe("Default 50"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Jira field names to return, e.g. ['summary','status','priority']"),
      },
    },
    async ({ jql, maxResults, fields }) => {
      try {
        const result = await client.searchIssues({ jql, maxResults, fields });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
