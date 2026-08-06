import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetIssueTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue",
    {
      title: "Get Issue",
      description:
        "Fetches full details for a single issue (GET /rest/api/2/issue/{key}): summary, description, status, comments, labels, and assignee.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
      },
    },
    async ({ issueKey }) => {
      try {
        const issue = await client.getIssue(issueKey);
        return jsonResult({
          key: issue.key,
          summary: issue.fields.summary,
          description: issue.fields.description ?? null,
          status: issue.fields.status?.name,
          comments:
            issue.fields.comment?.comments?.map((c) => ({
              author: c.author?.displayName,
              body: c.body,
              created: c.created,
            })) ?? [],
          labels: issue.fields.labels ?? [],
          assignee: issue.fields.assignee?.displayName ?? null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
