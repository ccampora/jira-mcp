import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

const issueKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, "Must be a Jira issue key, e.g. 'ABC-123'");

export function registerGetIssuesBulkTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issues_bulk",
    {
      title: "Get Issues in Bulk",
      description:
        "Fetches many issues in one Jira request using POST /rest/api/2/search and a key-in JQL query.",
      inputSchema: {
        issueKeys: z
          .array(issueKeySchema)
          .min(1)
          .max(1000)
          .describe("Issue keys to retrieve in one request"),
        fields: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe("Optional Jira fields to return; defaults to common issue fields"),
      },
    },
    async ({ issueKeys, fields }) => {
      try {
        const uniqueKeys = [...new Set(issueKeys.map((key) => key.toUpperCase()))];
        const result = await client.getIssuesBulk(uniqueKeys, fields);
        const issuesByKey = new Map(result.issues.map((issue) => [issue.key.toUpperCase(), issue]));
        const issues = uniqueKeys.flatMap((key) => {
          const issue = issuesByKey.get(key);
          return issue ? [issue] : [];
        });
        const missingIssueKeys = uniqueKeys.filter((key) => !issuesByKey.has(key));

        return jsonResult({
          requestedCount: uniqueKeys.length,
          foundCount: issues.length,
          missingIssueKeys,
          issues,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}