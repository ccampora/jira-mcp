#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createAuthProvider } from "./auth.js";
import { JiraClient } from "./jira-client.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const authProvider = createAuthProvider(config);
  const client = new JiraClient(config, authProvider);

  logger.info(
    `Starting Jira Data Center MCP server (base URL: ${config.JIRA_BASE_URL}, auth: ${authProvider.scheme})`,
  );

  const server = new McpServer({
    name: "jira-datacenter-mcp-server",
    version: "1.0.0",
  });

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Jira Data Center MCP server is running on stdio.");
}

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", reason);
  process.exit(1);
});

main().catch((err) => {
  logger.error("Fatal error during startup", err);
  process.exit(1);
});
