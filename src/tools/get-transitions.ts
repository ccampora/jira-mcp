import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetTransitionsTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_transitions",
    {
      title: "Get Available Transitions",
      description:
        "Lists the workflow transitions currently available for an issue (GET /rest/api/2/issue/{key}/transitions).",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
      },
    },
    async ({ issueKey }) => {
      try {
        const result = await client.getTransitions(issueKey);
        return jsonResult(
          result.transitions.map((t) => ({
            id: t.id,
            name: t.name,
            to: t.to?.name,
          })),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
