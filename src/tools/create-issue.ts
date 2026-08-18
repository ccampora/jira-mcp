import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerCreateIssueTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "create_issue",
    {
      title: "Create Issue",
      description:
        "Creates a new Jira issue (POST /rest/api/2/issue) and returns the created issue key. Supports option-backed custom fields through customFieldOptions; provide each Jira field key and option ID at call time.",
      inputSchema: {
        projectKey: z.string().min(1).describe("Project key, e.g. 'ABC'"),
        issueType: z.string().min(1).describe("Issue type name, e.g. 'Story', 'Task', 'Bug'"),
        summary: z.string().min(1).describe("Issue summary/title"),
        description: z.string().optional().describe("Issue description"),
        labels: z
          .array(z.string().trim().min(1))
          .optional()
          .describe("Labels to set during creation, avoiding a separate update request"),
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
      },
    },
    async ({ projectKey, issueType, summary, description, labels, customFieldOptions }) => {
      try {
        const issue = await client.createIssue({
          projectKey,
          issueType,
          summary,
          description,
          labels: labels ? [...new Set(labels)] : undefined,
          customFieldOptions,
        });
        return jsonResult({ key: issue.key, id: issue.id, self: issue.self });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
