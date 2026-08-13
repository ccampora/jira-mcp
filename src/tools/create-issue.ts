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
        "Creates a new Jira issue (POST /rest/api/2/issue) and returns the created issue key.",
      inputSchema: {
        projectKey: z.string().min(1).describe("Project key, e.g. 'ABC'"),
        issueType: z.string().min(1).describe("Issue type name, e.g. 'Story', 'Task', 'Bug'"),
        summary: z.string().min(1).describe("Issue summary/title"),
        description: z.string().optional().describe("Issue description"),
        labels: z
          .array(z.string().trim().min(1))
          .optional()
          .describe("Labels to set during creation, avoiding a separate update request"),
      },
    },
    async ({ projectKey, issueType, summary, description, labels }) => {
      try {
        const issue = await client.createIssue({
          projectKey,
          issueType,
          summary,
          description,
          labels: labels ? [...new Set(labels)] : undefined,
        });
        return jsonResult({ key: issue.key, id: issue.id, self: issue.self });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
