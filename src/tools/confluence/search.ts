import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceSearchTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_search",
    {
      title: "Confluence: Search (CQL)",
      description:
        "Searches Confluence content using CQL, e.g. \"space = ENG AND title ~ 'release'\" or \"text ~ 'onboarding'\" (GET /rest/api/content/search).",
      inputSchema: {
        cql: z
          .string()
          .min(1)
          .describe(
            "Confluence Query Language (CQL) expression, e.g. \"space = ENG AND type = page ORDER BY lastmodified DESC\"",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Max results to return (default 25)"),
      },
    },
    async ({ cql, limit }) => {
      try {
        const result = await client.search({ cql, limit });
        const items = result.results.map((c) => ({
          id: c.id,
          type: c.type,
          title: c.title,
          space: c.space?.key,
          version: c.version?.number,
          updated: c.version?.when,
          webui: c._links?.webui ?? null,
        }));
        return jsonResult({ total: result.size ?? items.length, results: items });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
