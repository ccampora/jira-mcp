import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../../confluence-client.js";
import { jsonResult, errorResult } from "../tool-helpers.js";

export function registerConfluenceGetSpacesTool(
  server: McpServer,
  client: ConfluenceClient,
): void {
  server.registerTool(
    "confluence_get_spaces",
    {
      title: "Confluence: Get Spaces",
      description:
        "Lists Confluence spaces the current user can see (GET /rest/api/space).",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Max spaces to return (default 25)"),
      },
    },
    async ({ limit }) => {
      try {
        const result = await client.getSpaces(limit ?? 25);
        const spaces = result.results.map((s) => ({
          key: s.key,
          name: s.name,
          type: s.type,
          webui: s._links?.webui ?? null,
        }));
        return jsonResult({ total: result.size ?? spaces.length, spaces });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
