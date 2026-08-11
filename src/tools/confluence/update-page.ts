import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceUpdatePageTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_update_page",
    {
      title: "Update Confluence Page",
      description:
        "Updates an existing Confluence page (PUT /rest/api/content/{id}). You MUST fetch the page first (confluence_get_page) to read its current version.number, then pass versionNumber = current + 1. bodyStorage must be full storage-format XHTML (Confluence replaces the whole body).",
      inputSchema: {
        pageId: z.string().min(1),
        title: z.string().min(1),
        bodyStorage: z.string().min(1),
        versionNumber: z
          .number()
          .int()
          .positive()
          .describe("current version.number + 1"),
        versionMessage: z.string().optional(),
      },
    },
    async ({ pageId, title, bodyStorage, versionNumber, versionMessage }) => {
      try {
        const content = await client.updatePage({
          pageId,
          title,
          bodyStorage,
          versionNumber,
          versionMessage,
        });
        return jsonResult({
          id: content.id,
          title: content.title,
          version: content.version?.number,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}