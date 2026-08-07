import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetIssueRemoteLinksTool(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "get_issue_remote_links",
    {
      title: "Get Issue Remote Links",
      description:
        "Lists an issue's remote links (GET /rest/api/2/issue/{key}/remotelink), including linked Confluence pages ('Wiki Page' links) and generic web links.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
      },
    },
    async ({ issueKey }) => {
      try {
        const links = await client.getIssueRemoteLinks(issueKey);
        return jsonResult({
          total: links.length,
          links: links.map((l) => ({
            relationship: l.relationship,
            application: l.application?.name ?? l.application?.type,
            title: l.object?.title,
            url: l.object?.url,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
