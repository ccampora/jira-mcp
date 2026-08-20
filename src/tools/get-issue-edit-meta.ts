import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetIssueEditMetaTool(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "get_issue_edit_meta",
    {
      title: "Get Issue Edit Metadata",
      description:
        "Fetches every field editable on an issue (GET /rest/api/2/issue/{key}/editmeta), keyed by its real Jira field id " +
        "(e.g. 'customfield_12402'), including each field's display name, schema type, and (for option-backed fields) its " +
        "allowed values with option ids. Use this BEFORE guessing a customfield_NNNNN id for an app-specific field such as " +
        "Xray's Manual Test Steps repository (schema.custom will contain a string like " +
        "'com.xpandit.plugins.xray:test-repository-manual-test-steps') or Test Type. Once the real field id and schema are " +
        "known, `update_issue`'s `fields` parameter can set it directly through the same standard PUT /rest/api/2/issue/{key} " +
        "endpoint used for every other field -- there is no separate 'Xray API' required for fields exposed this way. " +
        "Never assume a field is unreachable without first calling this tool to check.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
      },
    },
    async ({ issueKey }) => {
      try {
        const editMeta = await client.getIssueEditMeta(issueKey);
        const fields = Object.fromEntries(
          Object.entries(editMeta.fields ?? {}).map(([fieldId, field]) => [
            fieldId,
            {
              name: field.name,
              required: field.required,
              type: field.schema?.type,
              customType: field.schema?.custom,
              itemsType: field.schema?.items,
              allowedValues: field.allowedValues?.map((v) => ({
                id: v.id,
                value: v.value ?? v.name,
              })),
            },
          ]),
        );
        return jsonResult({ issueKey: issueKey.toUpperCase(), fields });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
