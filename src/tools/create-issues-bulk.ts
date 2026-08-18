import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

const createIssueSchema = z.object({
  projectKey: z.string().min(1).describe("Project key, e.g. 'ABC'"),
  issueType: z.string().min(1).describe("Issue type name, e.g. 'Story', 'Task', 'Bug'"),
  summary: z.string().min(1).describe("Issue summary/title"),
  description: z.string().optional().describe("Issue description"),
  labels: z.array(z.string().trim().min(1)).optional().describe("Labels set during creation"),
  customFieldOptions: z
    .array(
      z.object({
        fieldKey: z
          .string()
          .regex(/^customfield_\d+$/, "Must be a Jira custom field key, e.g. 'customfield_12402'"),
        optionId: z.string().min(1).describe("Jira option ID, e.g. '22300'"),
      }),
    )
    .min(1)
    .optional()
    .describe("Option-backed custom fields to set during creation"),
});

export function registerCreateIssuesBulkTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "create_issues_bulk",
    {
      title: "Create Issues in Bulk",
      description:
        "Creates issues through Jira's native POST /rest/api/2/issue/bulk endpoint, batching at most 50 issues per Jira request. Each issue supports option-backed custom fields through customFieldOptions; provide each Jira field key and option ID at call time.",
      inputSchema: {
        issues: z.array(createIssueSchema).min(1).max(1000).describe("Issues to create"),
      },
    },
    async ({ issues }) => {
      try {
        const results = await client.createIssuesBulk(issues);
        const created = results
          .filter((result) => result.issue)
          .map((result) => ({
            index: result.index,
            key: result.issue?.key,
            id: result.issue?.id,
            summary: result.input.summary,
          }));
        const failed = results
          .filter((result) => result.error)
          .map((result) => ({
            index: result.index,
            summary: result.input.summary,
            error: result.error,
          }));

        return jsonResult({
          totalRequested: issues.length,
          jiraRequestCount: Math.ceil(issues.length / 50),
          createdCount: created.length,
          failedCount: failed.length,
          created,
          failed,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}