import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerGetProjectsTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "get_projects",
    {
      title: "Get Projects",
      description: "Lists visible projects using paginated Jira Cloud v3 project search (safety limit: 10000 projects).",
      inputSchema: {},
    },
    async () => {
      try {
        const projects = await client.getProjects();
        return jsonResult(
          projects.map((p) => ({
            key: p.key,
            id: p.id,
            name: p.name,
            projectTypeKey: p.projectTypeKey,
          })),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
