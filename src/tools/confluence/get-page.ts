import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceGetPageTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_get_page",
    {
      title: "Confluence: Get Page",
      description:
        "Fetches a Confluence Cloud page by ID, body, space and version using v2 pages. Use format 'view' for rendered HTML or 'storage' for raw storage-format XHTML.",
      inputSchema: {
        pageId: z.string().min(1).describe("Numeric content/page ID, e.g. '123456'"),
        format: z
          .enum(["storage", "view"])
          .optional()
          .describe(
            "Body representation to return: 'storage' (raw XHTML source, default) or 'view' (server-rendered HTML with macros resolved)",
          ),
      },
    },
    async ({ pageId, format }) => {
      try {
        const rep = format ?? "storage";
        const expand = [`body.${rep}`, "version", "space", "history"];
        const page = await client.getPage({ pageId, expand });
        const body =
          rep === "view"
            ? page.body?.view?.value ?? null
            : page.body?.storage?.value ?? null;
        return jsonResult({
          id: page.id,
          type: page.type,
          title: page.title,
          space: page.space?.key,
          version: page.version?.number,
          updated: page.version?.when,
          format: rep,
          body,
          webui: page._links?.webui ?? null,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
