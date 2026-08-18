#!/usr/bin/env node
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig, isConfluenceEnabled, type AppConfig } from "./config.js";
import { createAuthProvider, createConfluenceAuthProvider } from "./auth.js";
import { JiraClient } from "./jira-client.js";
import { ConfluenceClient } from "./confluence-client.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "./logger.js";
import {
  requestClients,
  requestScopedConfluenceClient,
  requestScopedJiraClient,
  type RequestClients,
} from "./request-context.js";

function createClients(config: AppConfig): RequestClients {
  const authProvider = createAuthProvider(config);
  const jira = new JiraClient(config, authProvider);

  let confluence: ConfluenceClient | undefined;
  if (isConfluenceEnabled(config)) {
    const confluenceAuth = createConfluenceAuthProvider(config);
    confluence = new ConfluenceClient(config, confluenceAuth);
  }

  return { jira, confluence };
}

function createMcpServer(
  jiraClient: JiraClient,
  confluenceClient?: ConfluenceClient,
): McpServer {
  const server = new McpServer({
    name: "jira-datacenter-mcp-server",
    version: "1.0.0",
  });

  registerAllTools(server, jiraClient, confluenceClient);
  return server;
}

async function startStdioServer(): Promise<void> {
  const config = loadConfig();
  const clients = createClients(config);
  const authProvider = createAuthProvider(config);

  logger.info(
    `Starting Jira Data Center MCP server (base URL: ${config.JIRA_BASE_URL}, auth: ${authProvider.scheme})`,
  );
  if (clients.confluence) {
    logger.info(`Confluence tools enabled (base URL: ${config.CONFLUENCE_BASE_URL})`);
  }

  const server = createMcpServer(clients.jira, clients.confluence);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Jira Data Center MCP server is running on stdio.");
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function loadRequestConfig(req: IncomingMessage): AppConfig {
  return loadConfig({
    ...process.env,
    JIRA_BASE_URL: headerValue(req, "x-jira-base-url") ?? process.env.JIRA_BASE_URL,
    JIRA_PAT: headerValue(req, "x-jira-pat") ?? process.env.JIRA_PAT,
  });
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startHttpServer(): Promise<void> {
  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535 (received ${process.env.PORT})`);
  }

  const confluenceEnabled = !!process.env.CONFLUENCE_BASE_URL;
  const server = createMcpServer(
    requestScopedJiraClient,
    confluenceEnabled ? requestScopedConfluenceClient : undefined,
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  let postRequestQueue = Promise.resolve();
  const handleMcpRequest = (req: IncomingMessage, res: ServerResponse) => {
    const handle = () => {
      const config = loadRequestConfig(req);
      const clients = createClients(config);
      return requestClients.run(clients, () => transport.handleRequest(req, res));
    };

    if (req.method !== "POST") {
      return handle();
    }

    const result = postRequestQueue.then(handle, handle);
    postRequestQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const httpServer = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/healthz") {
      writeJson(res, 200, { status: "ok" });
      return;
    }
    if (path !== "/mcp") {
      writeJson(res, 404, { error: "Not found" });
      return;
    }

    try {
      await handleMcpRequest(req, res);
    } catch (err) {
      logger.warn("Rejected HTTP MCP request", err);
      if (!res.headersSent) {
        writeJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: err instanceof Error ? err.message : "Invalid request" },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", resolve);
  });
  logger.info(`Jira Data Center MCP server is running at http://0.0.0.0:${port}/mcp.`);
}

async function main(): Promise<void> {
  if (process.env.MCP_TRANSPORT?.toLowerCase() === "http") {
    await startHttpServer();
    return;
  }
  await startStdioServer();
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
