import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

export function registerServerInfoTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "server_info",
    {
      title: "Jira Server Info",
      description:
        "Returns Jira Cloud site information using REST v3. Available fields such as deploymentType and version depend on the site.",
      inputSchema: {},
    },
    async () => {
      try {
        const info = await client.getServerInfo();
        return jsonResult({
          version: info.version,
          deploymentType: info.deploymentType,
          buildNumber: info.buildNumber,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
