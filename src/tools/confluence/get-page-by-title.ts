import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceGetPageByTitleTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_get_page_by_title",
    {
      title: "Confluence: Get Page by Title",
      description:
        "Finds a page by exact title within a space and returns its storage-format body. Cloud resolves spaceKey to a Cloud space ID and uses v2 pages.",
      inputSchema: {
        spaceKey: z.string().min(1).describe("Space key, e.g. 'ENG'"),
        title: z.string().min(1).describe("Exact page title"),
      },
    },
    async ({ spaceKey, title }) => {
      try {
        const result = await client.getPageByTitle({ spaceKey, title });
        const pages = result.results.map((page) => ({
          id: page.id,
          title: page.title,
          space: page.space?.key ?? spaceKey,
          version: page.version?.number,
          updated: page.version?.when,
          body: page.body?.storage?.value ?? null,
          webui: page._links?.webui ?? null,
        }));
        return jsonResult({ total: pages.length, pages });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
