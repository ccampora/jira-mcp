import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerTransitionIssueTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "transition_issue",
    {
      title: "Transition Issue",
      description:
        "Moves an issue through its workflow (POST /rest/api/2/issue/{key}/transitions). Use get_transitions first to discover valid transitionId values.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        transitionId: z.string().min(1).describe("Transition ID (see get_transitions)"),
      },
    },
    async ({ issueKey, transitionId }) => {
      try {
        await client.transitionIssue(issueKey, transitionId);
        return jsonResult({ issueKey, transitionId, status: "transitioned" });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
