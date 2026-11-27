import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceCreatePageTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_create_page",
    {
      title: "Create Confluence Page",
      description:
        "Creates a Confluence Cloud page using v2 pages. bodyStorage must be storage-format XHTML. The space key is resolved to a space ID. Provide parentId to nest under a page.",
      inputSchema: {
        spaceKey: z.string().min(1),
        title: z.string().min(1),
        bodyStorage: z
          .string()
          .min(1)
          .describe("Confluence storage-format XHTML"),
        parentId: z.string().optional(),
      },
    },
    async ({ spaceKey, title, bodyStorage, parentId }) => {
      try {
        const content = await client.createPage({
          spaceKey,
          title,
          bodyStorage,
          parentId,
        });
        return jsonResult({
          id: content.id,
          title: content.title,
          version: content.version?.number,
          url: content._links?.webui ?? content._links?.self,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}