import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerAddCommentTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "add_comment",
    {
      title: "Add Comment",
      description: "Adds a comment to an issue (POST /rest/api/2/issue/{key}/comment).",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        comment: z.string().min(1).describe("Comment body text"),
      },
    },
    async ({ issueKey, comment }) => {
      try {
        const created = await client.addComment(issueKey, comment);
        return jsonResult({ id: created.id, created: created.created });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
