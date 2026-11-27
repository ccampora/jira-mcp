import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";
import { richTextToString } from "../jira-rich-text.js";

export function registerGetIssueTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_issue",
    {
      title: "Get Issue",
      description:
        "Fetches details for a single issue using Jira Cloud v3: summary, description, status, comments, labels, and assignee. Descriptions/comments include readable text and raw ADF.\n\n" +
        "Confluence access: linked pages are NOT issue fields. Use REMOTE LINKS to discover them. Optional Confluence Cloud tools use independently configured credentials; page IDs may occur in /wiki/spaces/<key>/pages/<ID>/... URLs. To read linked content, an agent should:\n" +
        "  1. Call `get_issue_remote_links` with the same issueKey to list linked Confluence pages (each entry has a `url` like .../pages/viewpage.action?pageId=<ID>).\n" +
        "  2. Extract the numeric `pageId` from the query parameter or Cloud /pages/<ID>/ URL segment.\n" +
        "  3. Call `confluence_get_page` with that pageId and `format: \"view\"` to get readable, server-rendered content (use `format: \"storage\"` for the raw source). These Confluence tools are available when CONFLUENCE_BASE_URL is configured.\n" +
        "Alternatively, use `confluence_search` with a CQL query such as `text ~ \"<ISSUE-KEY>\"` to find pages that mention the issue.",
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
          description: richTextToString(issue.fields.description),
          ...(typeof issue.fields.description === "object" && issue.fields.description
            ? { descriptionAdf: issue.fields.description } : {}),
          status: issue.fields.status?.name,
          comments:
            issue.fields.comment?.comments?.map((c) => ({
              author: c.author?.displayName,
              body: c.body === undefined ? undefined : richTextToString(c.body),
              ...(typeof c.body === "object" ? { bodyAdf: c.body } : {}),
              created: c.created,
            })) ?? [],
          labels: issue.fields.labels ?? [],
          assignee: issue.fields.assignee?.displayName ?? null,
          // Guidance for agents: Confluence pages are not issue fields. Use the
          // remote-links tool to discover them, then fetch with confluence_get_page.
          confluenceAccess: {
            hint:
              "Linked Confluence pages are stored as remote links, not fields. Call get_issue_remote_links to list them, then confluence_get_page (format='view') using the pageId query parameter or /pages/<ID>/ URL segment. Or confluence_search with CQL text ~ \"" +
              issueKey +
              "\".",
            nextTool: "get_issue_remote_links",
          },
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
