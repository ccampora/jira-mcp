import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerSearchIssuesTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "search_issues",
    {
      title: "Search Issues",
      description:
        "Runs JQL using Jira Cloud enhanced search, returning key, summary, status, assignee, reporter, created, and updated. Returns isLast/nextPageToken instead of an exact total.",
      inputSchema: {
        jql: z.string().min(1).describe("JQL query string, e.g. 'project = ABC AND status = Open'"),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Maximum number of issues to return (default 50)"),
        nextPageToken: z.string().min(1).optional().describe("Cloud only: continuation token from a previous search with the same JQL"),
      },
    },
    async ({ jql, maxResults, nextPageToken }) => {
      try {
        const result = await client.searchIssues({ jql, maxResults, nextPageToken });
        return jsonResult({
          total: result.total,
          ...(result.isLast !== undefined ? { isLast: result.isLast } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
          issues: result.issues.map((issue) => ({
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name,
            assignee: issue.fields.assignee?.displayName ?? null,
            reporter: issue.fields.reporter?.displayName ?? null,
            created: issue.fields.created,
            updated: issue.fields.updated,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
