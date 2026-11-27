import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const serverEntry = path.resolve("src", "server.ts");

function serverEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(JIRA_|CONFLUENCE_|MCP_|PORT$|DOTENV_CONFIG_)/i.test(key)) {
      env[key] = value;
    }
  }
  return {
    ...env,
    DOTENV_CONFIG_PATH: path.resolve("test", "nonexistent-test-env"),
    LOG_LEVEL: "error",
    ...overrides,
  };
}

test("stdio starts with default and explicit Cloud configurations", async () => {
  for (const env of [
    { JIRA_BASE_URL: "https://example.atlassian.net",
      JIRA_CLOUD_EMAIL: "stdio@example.com", JIRA_CLOUD_API_TOKEN: "placeholder-stdio-cloud-token" },
    { JIRA_DEPLOYMENT: "cloud", JIRA_BASE_URL: "https://example.atlassian.net",
      JIRA_CLOUD_EMAIL: "stdio@example.com", JIRA_CLOUD_API_TOKEN: "placeholder-stdio-cloud-token" },
    { JIRA_BASE_URL: "https://example.atlassian.net",
      JIRA_CLOUD_EMAIL: "stdio@example.com", JIRA_CLOUD_API_TOKEN: "placeholder-stdio-cloud-token",
      CONFLUENCE_DEPLOYMENT: "cloud", CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
      CONFLUENCE_CLOUD_EMAIL: "wiki@example.com", CONFLUENCE_CLOUD_API_TOKEN: "placeholder-wiki" },
  ]) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", serverEntry],
      env: serverEnv(env),
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-config-test", version: "1" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === "get_current_user"));
      assert.ok(tools.some((tool) => tool.name === "search_issues"));
      assert.ok(!tools.some((tool) => tool.name === "import_test_execution"));
      assert.ok(tools.every((tool) => !tool.description?.includes("Data Center")));
      assert.equal(tools.filter((tool) => tool.name.startsWith("confluence_")).length,
        env.CONFLUENCE_BASE_URL ? 8 : 0);
    } finally {
      await client.close();
    }
  }
});

test("HTTP health and MCP discovery work with request-scoped Cloud configurations", async () => {
  const portServer = createServer();
  await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const { port } = portServer.address() as AddressInfo;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));

  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    env: serverEnv({ MCP_TRANSPORT: "http", PORT: String(port),
      JIRA_BASE_URL: "https://example.atlassian.net",
      CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
      CONFLUENCE_CLOUD_EMAIL: "wiki@example.com", CONFLUENCE_CLOUD_API_TOKEN: "placeholder-wiki" }),
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    let responsive = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`${baseUrl}/healthz`);
        if (response.ok) {
          assert.deepEqual(await response.json(), { status: "ok" });
          responsive = true;
          break;
        }
      } catch (error) {
        if (!(error instanceof TypeError && error.message === "fetch failed")) throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(responsive, `HTTP server did not become responsive: ${stderr}`);
    for (const headers of [
      { "X-Atlassian-Credentials": "http@example.com,placeholder-http-cloud-token",
        "X-Confluence-Credentials": "wiki@example.com,placeholder-wiki" },
      { "X-Jira-Base-Url": "https://example.atlassian.net",
        "X-Jira-Cloud-Email": "http@example.com", "X-Jira-Cloud-Api-Token": "placeholder-http-cloud-token" },
      { "X-Jira-Deployment": "cloud", "X-Jira-Base-Url": "https://example.atlassian.net",
        "X-Jira-Cloud-Email": "http@example.com", "X-Jira-Cloud-Api-Token": "placeholder-http-cloud-token",
        "X-Confluence-Deployment": "cloud", "X-Confluence-Base-Url": "https://example.atlassian.net/wiki",
        "X-Confluence-Cloud-Email": "wiki@example.com", "X-Confluence-Cloud-Api-Token": "placeholder-wiki" },
    ]) {
      const client = new Client({ name: "http-config-test", version: "1" });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
          requestInit: { headers },
        }));
        const { tools } = await client.listTools();
        assert.ok(tools.some((tool) => tool.name === "create_issue"));
        assert.equal(tools.filter((tool) => tool.name.startsWith("confluence_")).length, 8);
      } finally {
        await client.close();
      }
    }
    const rejected = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Jira-Deployment": "cloud",
        "X-Jira-Base-Url": "https://example.atlassian.net", "X-Jira-Pat": "invalid-cloud-secret" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(rejected.status, 400);
    const rejection = await rejected.text();
    assert.match(rejection, /no longer supported/);
    assert.ok(!rejection.includes("invalid-cloud-secret"));
    const malformed = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Atlassian-Credentials": "invalid-combined-secret" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes("invalid-combined-secret"));
    assert.ok(!stderr.includes("invalid-combined-secret"));
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
});
