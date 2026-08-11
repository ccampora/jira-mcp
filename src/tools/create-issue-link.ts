import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerCreateIssueLinkTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "create_issue_link",
    {
      title: "Create Issue Link",
      description: "Creates a link between two existing Jira issues (POST /rest/api/2/issueLink). Use get_issue_link_types to discover valid link type names (e.g. 'Relates', 'Blocks', 'Cloners'). For 'Relates' the direction is symmetric. For directional types such as 'Blocks' or 'Cloners', inwardIssue is the blocked or cloned issue and outwardIssue is the blocker or original; follow the inward/outward wording returned by get_issue_link_types.",
      inputSchema: {
        linkType: z.string().min(1).describe("Link type name, e.g. 'Relates', 'Blocks'"),
        inwardIssueKey: z.string().min(1).describe("Inward issue key, e.g. 'ABC-123'"),
        outwardIssueKey: z.string().min(1).describe("Outward issue key, e.g. 'ABC-456'"),
        comment: z.string().optional().describe("Optional comment to add with the link"),
      },
    },
    async ({ linkType, inwardIssueKey, outwardIssueKey, comment }) => {
      try {
        await client.linkIssues({
          linkType,
          inwardIssueKey,
          outwardIssueKey,
          comment,
        });
        return jsonResult({ linked: true, linkType, inwardIssueKey, outwardIssueKey });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}