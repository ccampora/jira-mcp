import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerUpdateIssueTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "update_issue",
    {
      title: "Update Issue",
      description:
        "Updates one Jira issue (PUT /rest/api/2/issue/{key}). Supports arbitrary Jira fields, label additions/removals, and option-backed custom fields through customFieldOptions; provide each Jira field key and option ID at call time.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        fields: z
          .record(z.unknown())
          .optional()
          .describe("Jira field values to set, e.g. summary, description, priority, or assignee"),
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
          .describe("Option-backed custom fields to set during the update"),
        labelsToAdd: z.array(z.string().trim().min(1)).optional(),
        labelsToRemove: z.array(z.string().trim().min(1)).optional(),
      },
    },
    async ({ issueKey, fields, customFieldOptions, labelsToAdd, labelsToRemove }) => {
      try {
        const uniqueLabelsToAdd = labelsToAdd ? [...new Set(labelsToAdd)] : undefined;
        const uniqueLabelsToRemove = labelsToRemove ? [...new Set(labelsToRemove)] : undefined;
        const hasFields = fields && Object.keys(fields).length > 0;
        const hasCustomFieldOptions = customFieldOptions?.length;
        const hasLabels = uniqueLabelsToAdd?.length || uniqueLabelsToRemove?.length;

        if (!hasFields && !hasCustomFieldOptions && !hasLabels) {
          return errorResult(`No field or label changes supplied for ${issueKey}`);
        }

        const overlap = uniqueLabelsToAdd?.filter((label) =>
          uniqueLabelsToRemove?.includes(label),
        );
        if (overlap?.length) {
          return errorResult(
            `${issueKey} cannot add and remove the same labels: ${overlap.join(", ")}`,
          );
        }

        const normalizedIssueKey = issueKey.toUpperCase();
        await client.updateIssue({
          issueKey: normalizedIssueKey,
          fields,
          customFieldOptions,
          labelsToAdd: uniqueLabelsToAdd,
          labelsToRemove: uniqueLabelsToRemove,
        });
        return jsonResult({ issueKey: normalizedIssueKey, status: "updated" });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}