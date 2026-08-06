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
        "Runs a JQL query and returns matching issues (GET /rest/api/2/search) with key, summary, status, assignee, reporter, created, and updated.",
      inputSchema: {
        jql: z.string().min(1).describe("JQL query string, e.g. 'project = ABC AND status = Open'"),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Maximum number of issues to return (default 50)"),
      },
    },
    async ({ jql, maxResults }) => {
      try {
        const result = await client.searchIssues({ jql, maxResults });
        return jsonResult({
          total: result.total,
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
