import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetIssueCommentsTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue_comments",
    {
      title: "Get Issue Comments",
      description: "Lists all comments on an issue (GET /rest/api/2/issue/{key}/comment).",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
      },
    },
    async ({ issueKey }) => {
      try {
        const result = await client.getIssueComments(issueKey);
        return jsonResult({
          total: result.total,
          comments: result.comments.map((c) => ({
            id: c.id,
            author: c.author?.displayName,
            body: c.body,
            created: c.created,
            updated: c.updated,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
