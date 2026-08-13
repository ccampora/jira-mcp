import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerAddIssueLabelsTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "add_issue_labels",
    {
      title: "Add Issue Labels",
      description:
        "Adds one or more labels to an issue without removing its existing labels (PUT /rest/api/2/issue/{key}).",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        labels: z
          .array(z.string().trim().min(1))
          .min(1)
          .describe("Labels to add to the issue"),
      },
    },
    async ({ issueKey, labels }) => {
      try {
        const uniqueLabels = [...new Set(labels)];
        await client.addIssueLabels(issueKey, uniqueLabels);
        return jsonResult({ issueKey, labels: uniqueLabels, status: "updated" });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}