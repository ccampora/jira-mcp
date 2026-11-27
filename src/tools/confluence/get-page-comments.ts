import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceGetPageCommentsTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_get_page_comments",
    {
      title: "Confluence: Get Page Comments",
      description:
        "Returns cursor-paginated Confluence Cloud v2 footer comments. Inline comments are not included; authors may be represented by accountId.",
      inputSchema: {
        pageId: z.string().min(1).describe("Numeric content/page ID, e.g. '123456'"),
      },
    },
    async ({ pageId }) => {
      try {
        const result = await client.getPageComments(pageId);
        const comments = result.results.map((c) => ({
          id: c.id,
          author: c.version?.by?.displayName ?? c.history?.createdBy?.displayName
            ?? c.version?.by?.accountId ?? c.history?.createdBy?.accountId ?? null,
          ...(c.version?.by?.accountId || c.history?.createdBy?.accountId
            ? { accountId: c.version?.by?.accountId ?? c.history?.createdBy?.accountId } : {}),
          created: c.version?.when ?? c.history?.createdDate ?? null,
          body: c.body?.storage?.value ?? null,
        }));
        return jsonResult({ total: result.size ?? comments.length, comments });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
