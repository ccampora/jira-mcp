import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

const updateIssueSchema = z.object({
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
});

export function registerUpdateIssuesBulkTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "update_issues_bulk",
    {
      title: "Update Issues in Bulk",
      description:
        "Updates many issues with bounded concurrency. Supports option-backed custom fields through customFieldOptions; provide each Jira field key and option ID at call time. Jira Data Center has no public bulk-update REST endpoint, so this sends one PUT per issue while combining all changes for that issue into a single request.",
      inputSchema: {
        updates: z
          .array(updateIssueSchema)
          .min(1)
          .max(500)
          .describe("One combined update per issue; duplicate issue keys are rejected"),
      },
    },
    async ({ updates }) => {
      try {
        const normalized = updates.map((update) => ({
          ...update,
          issueKey: update.issueKey.toUpperCase(),
          labelsToAdd: update.labelsToAdd ? [...new Set(update.labelsToAdd)] : undefined,
          labelsToRemove: update.labelsToRemove
            ? [...new Set(update.labelsToRemove)]
            : undefined,
        }));
        const duplicateKeys = normalized
          .map((update) => update.issueKey)
          .filter((key, index, keys) => keys.indexOf(key) !== index);
        if (duplicateKeys.length > 0) {
          return errorResult(`Duplicate issue keys: ${[...new Set(duplicateKeys)].join(", ")}`);
        }

        for (const update of normalized) {
          const hasFields = update.fields && Object.keys(update.fields).length > 0;
          const hasCustomFieldOptions = update.customFieldOptions?.length;
          const hasLabels = update.labelsToAdd?.length || update.labelsToRemove?.length;
          if (!hasFields && !hasCustomFieldOptions && !hasLabels) {
            return errorResult(`No field or label changes supplied for ${update.issueKey}`);
          }
          const overlap = update.labelsToAdd?.filter((label) =>
            update.labelsToRemove?.includes(label),
          );
          if (overlap?.length) {
            return errorResult(
              `${update.issueKey} cannot add and remove the same labels: ${overlap.join(", ")}`,
            );
          }
        }

        const results = await client.updateIssues(normalized);
        const updated = results
          .filter((result) => !result.error)
          .map((result) => result.input.issueKey);
        const failed = results
          .filter((result) => result.error)
          .map((result) => ({ issueKey: result.input.issueKey, error: result.error }));

        return jsonResult({
          totalRequested: normalized.length,
          jiraRequestCount: normalized.length,
          concurrency: Math.min(5, normalized.length),
          updatedCount: updated.length,
          failedCount: failed.length,
          updated,
          failed,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}