import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createConfluenceAuthProvider } from "../src/auth.js";
import { ConfluenceClient } from "../src/confluence-client.js";
import { registerConfluenceTools } from "../src/tools/confluence/index.js";

test("all eight Confluence MCP tools work in Cloud mode with normalized outputs", async () => {
  const paths: string[] = [];
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    paths.push(`${req.method} ${url.pathname}`);
    let data: unknown;
    const space = { id: "42", key: "ENG", name: "Engineering", type: "global" };
    const page = {
      id: "123", spaceId: "42", status: "current", title: "Cloud page",
      version: { number: req.method === "PUT" ? 2 : 1, createdAt: "2026-10-06T09:00:00Z", authorId: "author-id" },
      body: { storage: { value: "<p>Storage</p>", representation: "storage" },
        view: { value: "<p>Rendered</p>", representation: "view" } },
      _links: { webui: "/spaces/ENG/pages/123/Cloud+page" },
    };
    if (url.pathname.endsWith("/user/current")) {
      data = { accountId: "cloud-user", displayName: "Cloud Wiki User" };
    } else if (url.pathname.endsWith("/content/search")) {
      data = { results: [{ id: "123", type: "page", title: "Cloud page", space,
        version: { number: 1, when: "2026-10-06T09:00:00Z" } }], size: 1 };
    } else if (url.pathname.endsWith("/spaces/42")) {
      data = space;
    } else if (url.pathname.endsWith("/spaces")) {
      data = { results: [space] };
    } else if (url.pathname.endsWith("/footer-comments")) {
      data = { results: [{ id: "c1", body: { storage: { value: "<p>Comment</p>" } },
        version: { number: 1, createdAt: "2026-10-06T09:00:00Z", authorId: "author-id" } }] };
    } else if (url.pathname.endsWith("/pages") && req.method === "GET") {
      data = { results: [page] };
    } else if (url.pathname.endsWith("/pages") || url.pathname.endsWith("/pages/123")) {
      data = page;
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Unexpected path" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  const config = loadConfig({
    JIRA_BASE_URL: "https://jira.internal",
    JIRA_CLOUD_EMAIL: "jira@example.com", JIRA_CLOUD_API_TOKEN: "placeholder-jira",
    CONFLUENCE_CLOUD_EMAIL: "wiki@example.com", CONFLUENCE_CLOUD_API_TOKEN: "placeholder-wiki",
    CONFLUENCE_DEPLOYMENT: "cloud", CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
  });
  const confluence = new ConfluenceClient({ ...config, CONFLUENCE_BASE_URL: `http://127.0.0.1:${port}/wiki` },
    createConfluenceAuthProvider(config));
  const server = new McpServer({ name: "confluence-cloud-test", version: "1" });
  registerConfluenceTools(server, confluence);
  const client = new Client({ name: "wiki-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    assert.equal((await client.listTools()).tools.length, 8);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.ok(Array.isArray(result.content));
      const block = result.content[0];
      return JSON.parse(String(block.text)) as Record<string, unknown>;
    }
    assert.equal((await call("confluence_get_current_user")).accountId, "cloud-user");
    assert.equal((await call("confluence_get_spaces")).total, 1);
    assert.equal((await call("confluence_search", { cql: "space = ENG" })).total, 1);
    const page = await call("confluence_get_page", { pageId: "123" });
    assert.equal(page.body, "<p>Storage</p>");
    assert.equal(page.space, "ENG");
    assert.equal(page.version, 1);
    assert.equal((await call("confluence_get_page", { pageId: "123", format: "view" })).body, "<p>Rendered</p>");
    assert.equal((await call("confluence_get_page_by_title", { spaceKey: "ENG", title: "Cloud page" })).total, 1);
    const comments = await call("confluence_get_page_comments", { pageId: "123" });
    assert.equal(comments.total, 1);
    assert.deepEqual(comments.comments, [{
      id: "c1", author: "author-id", accountId: "author-id",
      created: "2026-10-06T09:00:00Z", body: "<p>Comment</p>",
    }]);
    assert.equal((await call("confluence_create_page", { spaceKey: "ENG", title: "Cloud page", bodyStorage: "<p>Storage</p>" })).id, "123");
    assert.equal((await call("confluence_update_page", { pageId: "123", title: "Cloud page", bodyStorage: "<p>Storage</p>", versionNumber: 2 })).version, 2);
    assert.ok(paths.includes("POST /wiki/api/v2/pages"));
    assert.ok(paths.includes("PUT /wiki/api/v2/pages/123"));
  } finally {
    await client.close();
    await server.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
