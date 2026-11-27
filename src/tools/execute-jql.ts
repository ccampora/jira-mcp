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
        "Runs arbitrary JQL using Jira Cloud enhanced search and returns raw issue data for the requested fields. Rich-text fields are ADF; continue with nextPageToken when isLast is false.",
      inputSchema: {
        jql: z.string().min(1).describe("JQL query string"),
        maxResults: z.number().int().positive().max(1000).optional().describe("Default 50"),
        nextPageToken: z.string().min(1).optional().describe("Cloud only: continuation token from a previous search with the same JQL"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Jira field names to return, e.g. ['summary','status','priority']"),
      },
    },
    async ({ jql, maxResults, fields, nextPageToken }) => {
      try {
        const result = await client.searchIssues({ jql, maxResults, fields, nextPageToken });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
