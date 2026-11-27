import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { BasicAuthProvider } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { ConfluenceApiError, ConfluenceClient } from "../src/confluence-client.js";

const EMAIL = "confluence-cloud-test@example.com";
const TOKEN = "placeholder-confluence-cloud-token";
const AUTHORIZATION = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(
  res: ServerResponse,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

async function withCloudApi(
  basePath: string,
  handler: (req: IncomingMessage, res: ServerResponse, baseUrl: string) => Promise<void> | void,
  run: (client: ConfluenceClient, baseUrl: string) => Promise<void>,
): Promise<void> {
  const initialConfig = loadConfig({
    JIRA_BASE_URL: "https://jira.example.com",
    JIRA_CLOUD_EMAIL: "jira@example.com",
    JIRA_CLOUD_API_TOKEN: "placeholder-jira-token",
    CONFLUENCE_BASE_URL: "https://wiki.example.com/wiki",
    CONFLUENCE_CLOUD_EMAIL: EMAIL,
    CONFLUENCE_CLOUD_API_TOKEN: TOKEN,
  });
  let baseUrl = "";
  const server = createServer((req, res) => {
    void Promise.resolve()
      .then(() => handler(req, res, baseUrl))
      .catch((err: unknown) => json(res, { message: String(err) }, 500));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  try {
    const client = new ConfluenceClient({
      ...initialConfig,
      CONFLUENCE_BASE_URL: `${baseUrl}${basePath}`,
      CONFLUENCE_DEPLOYMENT: "cloud",
    }, new BasicAuthProvider(EMAIL, TOKEN));
    await run(client, baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
}

test("Cloud client maps all eight methods and follows both site and gateway URL prefixes", async () => {
  for (const basePath of ["/wiki", "/ex/confluence/cloud-123/wiki"]) {
    const paths: string[] = [];
    const cqlPages = [
      { id: "search-1", title: "Search 1", type: "page", space: { key: "ENG" } },
      { id: "search-2", title: "Search 2", type: "page", space: { key: "ENG" } },
      { id: "search-3", title: "Search 3", type: "page", space: { key: "ENG" } },
    ];
    await withCloudApi(basePath, async (req, res, baseUrl) => {
      assert.equal(req.headers.authorization, AUTHORIZATION);
      const url = new URL(req.url ?? "", "http://localhost");
      paths.push(`${req.method} ${url.pathname}`);
      const path = url.pathname.slice(basePath.length);

      if (path === "/rest/api/user/current") {
        json(res, { accountId: "cloud-user", displayName: "Cloud User", publicName: "Cloud User" });
      } else if (path === "/api/v2/spaces" && url.searchParams.has("keys")) {
        json(res, { results: [{ id: "space-42", key: "ENG", name: "Engineering", type: "global" }] });
      } else if (path === "/api/v2/spaces") {
        if (url.searchParams.get("cursor") === "spaces-next") {
          json(res, { results: [{ id: "space-3", key: "OPS", name: "Operations" }],
            meta: { hasMore: false } });
        } else {
          json(res, { results: [
            { id: "space-1", key: "ENG", name: "Engineering" },
            { id: "space-2", key: "HR", name: "People" },
          ], meta: { hasMore: true, cursor: "spaces-next" } });
        }
      } else if (path === "/api/v2/pages/page-1" && req.method === "GET") {
        const format = url.searchParams.get("body-format");
        json(res, {
          id: "page-1", title: "Page", status: "current", spaceId: "space-42", authorId: "page-author",
          createdAt: "2026-01-01T00:00:00Z",
          version: { number: 4, createdAt: "2026-02-01T00:00:00Z", authorId: "version-author" },
          body: { [format === "view" ? "view" : "storage"]: {
            representation: format, value: format === "view" ? "<p>Rendered</p>" : "<p>Stored</p>",
          } },
          _links: { webui: "/spaces/ENG/pages/page-1", base: `${baseUrl}${basePath}` },
        });
      } else if (path === "/api/v2/spaces/space-42") {
        json(res, { id: "space-42", key: "ENG", name: "Engineering", type: "global" });
      } else if (path === "/api/v2/pages" && req.method === "GET") {
        assert.equal(url.searchParams.get("space-id"), "space-42");
        assert.equal(url.searchParams.get("title"), "Exact Title");
        if (url.searchParams.get("cursor") === "title-next") {
          json(res, { results: [{ id: "title-2", title: "Exact Title", spaceId: "space-42" }],
            meta: { hasMore: false } });
        } else {
          json(res, { results: [{ id: "title-1", title: "Exact Title", spaceId: "space-42",
            body: { storage: { value: "<p>Title result</p>", representation: "storage" } } }],
          meta: { hasMore: true, cursor: "title-next" } });
        }
      } else if (path === "/api/v2/pages/page-1/footer-comments") {
        if (url.searchParams.get("cursor") === "comments-next") {
          json(res, { results: [{ id: "comment-2", authorId: "comment-author-2", createdAt: "2026-02-02",
            body: { storage: { value: "<p>Second</p>", representation: "storage" } } }],
          meta: { hasMore: false } });
        } else {
          json(res, { results: [{ id: "comment-1", authorId: "comment-author-1", createdAt: "2026-02-01",
            body: { storage: { value: "<p>First</p>", representation: "storage" } } }],
          meta: { hasMore: true, cursor: "comments-next" } });
        }
      } else if (path === "/rest/api/content/search") {
        assert.equal(url.searchParams.get("cql"), "space = ENG AND title ~ 'release'");
        assert.equal(url.searchParams.get("expand"), "space,version");
        const start = Number(url.searchParams.get("start"));
        json(res, {
          results: cqlPages.slice(start, start + 2),
          size: Math.min(2, cqlPages.length - start),
          start,
          limit: 2,
          _links: start === 0
            ? { next: `${baseUrl}${basePath}/rest/api/content/search?start=2&limit=2` }
            : {},
        });
      } else if (path === "/api/v2/pages" && req.method === "POST") {
        const payload = await readBody(req);
        assert.deepEqual(payload, {
          spaceId: "space-42",
          status: "current",
          title: "New",
          parentId: "parent-1",
          body: { representation: "storage", value: "<p>New</p>" },
        });
        json(res, { id: "created-1", title: "New", status: "current", spaceId: "space-42",
          version: { number: 1 } });
      } else if (path === "/api/v2/pages/page-1" && req.method === "PUT") {
        assert.deepEqual(await readBody(req), {
          id: "page-1",
          status: "current",
          title: "Updated",
          body: { representation: "storage", value: "<p>Updated</p>" },
          version: { number: 5, message: "Saved" },
        });
        json(res, { id: "page-1", title: "Updated", version: { number: 5, createdAt: "2026-03-01" } });
      } else {
        json(res, { message: `Unexpected endpoint ${req.method} ${url.pathname}` }, 404);
      }
    }, async (client) => {
      assert.equal((await client.getCurrentUser()).accountId, "cloud-user");

      const spaces = await client.getSpaces(3);
      assert.deepEqual(spaces.results.map((space) => space.key), ["ENG", "HR", "OPS"]);
      assert.equal(spaces.size, 3);

      const search = await client.search({
        cql: "space = ENG AND title ~ 'release'",
        limit: 3,
      });
      assert.deepEqual(search.results.map((page) => page.id), ["search-1", "search-2", "search-3"]);

      const storagePage = await client.getPage({ pageId: "page-1", expand: ["body.storage"] });
      assert.equal(storagePage.body?.storage?.value, "<p>Stored</p>");
      assert.equal(storagePage.space?.key, "ENG");
      assert.equal(storagePage.version?.when, "2026-02-01T00:00:00Z");
      assert.equal(storagePage.version?.by?.accountId, "version-author");
      assert.equal(storagePage.history?.createdBy?.accountId, "page-author");
      assert.equal(storagePage._links?.webui, "/spaces/ENG/pages/page-1");

      const viewPage = await client.getPage({ pageId: "page-1", expand: ["body.view"] });
      assert.equal(viewPage.body?.view?.value, "<p>Rendered</p>");

      const titlePages = await client.getPageByTitle({ spaceKey: "ENG", title: "Exact Title" });
      assert.deepEqual(titlePages.results.map((page) => page.id), ["title-1", "title-2"]);
      assert.equal(titlePages.results[0].space?.key, "ENG");
      assert.equal(titlePages.results[0].body?.storage?.value, "<p>Title result</p>");

      const comments = await client.getPageComments("page-1");
      assert.deepEqual(comments.results.map((comment) => comment.id), ["comment-1", "comment-2"]);
      assert.equal(comments.results[0].history?.createdBy?.accountId, "comment-author-1");
      assert.equal(comments.results[0].body?.storage?.value, "<p>First</p>");

      assert.equal((await client.createPage({
        spaceKey: "ENG", title: "New", bodyStorage: "<p>New</p>", parentId: "parent-1",
      })).id, "created-1");
      const updated = await client.updatePage({
        pageId: "page-1", title: "Updated", bodyStorage: "<p>Updated</p>",
        versionNumber: 5, versionMessage: "Saved",
      });
      assert.equal(updated.version?.number, 5);
    });
    assert.ok(paths.some((path) => path.endsWith("/api/v2/pages/page-1")));
    assert.ok(paths.some((path) => path.endsWith("/rest/api/content/search")));
    assert.ok(paths.every((path) => path.includes(` ${basePath}/`)));
  }
});

test("Cloud collection pagination honors limits and rejects unsafe continuation URLs", async () => {
  let spaceRequests = 0;
  await withCloudApi("/wiki", async (req, res, baseUrl) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname === "/wiki/api/v2/spaces") {
      spaceRequests++;
      json(res, { results: Array.from({ length: 2 }, (_, index) => ({
        id: `space-${spaceRequests}-${index}`, key: `S${spaceRequests}${index}`,
      })), meta: { hasMore: true, cursor: `cursor-${spaceRequests}` } });
    } else if (url.pathname === "/wiki/rest/api/content/search") {
      json(res, { results: [
        { id: "result-1", title: "Result 1" },
        { id: "result-2", title: "Result 2" },
      ], _links: {
        next: "https://attacker.example/exfiltrate?start=1",
      } });
    } else {
      json(res, { message: `Unexpected endpoint at ${baseUrl}` }, 404);
    }
  }, async (client) => {
    const spaces = await client.getSpaces(3);
    assert.equal(spaces.results.length, 3);
    assert.equal(spaceRequests, 2);
    await assert.rejects(
      client.search({ cql: "type = page", limit: 3 }),
      /unsafe pagination link/,
    );
  });
  assert.equal(spaceRequests, 2);
});

test("Cloud retries bounded 429 responses, validates JSON success bodies, and redacts auth errors", async () => {
  let meAttempts = 0;
  let unavailableAttempts = 0;
  await withCloudApi("/wiki", (req, res) => {
    if (req.url === "/wiki/rest/api/user/current") {
      meAttempts++;
      if (meAttempts === 1) {
        json(res, { message: `rate limited ${TOKEN}` }, 429, { "Retry-After": "0" });
      } else if (meAttempts === 2) {
        json(res, { accountId: "cloud-user" });
      } else {
        json(res, { message: `denied ${TOKEN} ${EMAIL} ${AUTHORIZATION}` }, 403);
      }
      return;
    }
    if (req.url?.startsWith("/wiki/api/v2/spaces")) {
      unavailableAttempts++;
      json(res, { message: "temporary outage" }, 503);
      return;
    }
    json(res, { message: `Unexpected endpoint: ${req.url}` }, 404);
  }, async (client) => {
    assert.equal((await client.getCurrentUser()).accountId, "cloud-user");
    assert.equal(meAttempts, 2);

    await assert.rejects(client.getSpaces(1), (error: unknown) =>
      error instanceof ConfluenceApiError && error.statusCode === 503);
    assert.equal(unavailableAttempts, 1);

    await assert.rejects(client.getCurrentUser(), (error: unknown) => {
      assert.ok(error instanceof ConfluenceApiError);
      const serialized = JSON.stringify({
        message: error.message,
        details: error.confluenceError,
      });
      for (const secret of [TOKEN, EMAIL, AUTHORIZATION]) {
        assert.ok(!serialized.includes(secret));
      }
      assert.match(serialized, /\[REDACTED\]/);
      return true;
    });
  });
});

test("Cloud rejects HTML 200 responses and reports missing spaces before creating", async () => {
  let createRequests = 0;
  await withCloudApi("/wiki", (req, res) => {
    if (req.url?.startsWith("/wiki/rest/api/user/current")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>login</html>");
      return;
    }
    if (req.url?.startsWith("/wiki/api/v2/spaces")) {
      json(res, { results: [] });
      return;
    }
    if (req.method === "POST") createRequests++;
    json(res, { message: "Unexpected endpoint" }, 404);
  }, async (client) => {
    await assert.rejects(client.getCurrentUser(), /Invalid JSON object/);
    await assert.rejects(
      client.createPage({ spaceKey: "MISSING", title: "No page", bodyStorage: "<p>x</p>" }),
      (error: unknown) => error instanceof ConfluenceApiError
        && error.statusCode === 404
        && /space "MISSING" was not found/.test(error.message),
    );
    assert.equal(createRequests, 0);
  });
});

test("Cloud comments fail explicitly at the 10,000-item safety limit", async () => {
  let requests = 0;
  await withCloudApi("/wiki", (_req, res) => {
    requests++;
    json(res, {
      results: Array.from({ length: 100 }, (_, index) => ({
        id: `comment-${requests}-${index}`,
        authorId: "comment-author",
      })),
      meta: { hasMore: true, cursor: `cursor-${requests}` },
    });
  }, async (client) => {
    await assert.rejects(client.getPageComments("page-1"), /10000-item safety limit/);
    assert.equal(requests, 100);
  });
});

test("Confluence operations use only Cloud REST endpoints", async () => {
  const paths: string[] = [];
  await withCloudApi("/wiki", (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    paths.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/wiki/rest/api/user/current") {
      json(res, { accountId: "cloud-user" });
    } else if (url.pathname === "/wiki/rest/api/content/search") {
      json(res, { results: [] });
    } else if (url.pathname === "/wiki/api/v2/spaces") {
      json(res, { results: [{ id: "space-1", key: "ENG" }] });
    } else if (url.pathname === "/wiki/api/v2/spaces/space-1") {
      json(res, { id: "space-1", key: "ENG" });
    } else if (url.pathname === "/wiki/api/v2/pages" && req.method === "GET") {
      json(res, { results: [{ id: "page-1", title: "Page", spaceId: "space-1" }] });
    } else if (url.pathname === "/wiki/api/v2/pages/page-1/footer-comments") {
      json(res, { results: [] });
    } else if (url.pathname === "/wiki/api/v2/pages/page-1") {
      json(res, { id: "page-1", title: "Page", status: "current", spaceId: "space-1", version: { number: 2 } });
    } else if (url.pathname === "/wiki/api/v2/pages" && req.method === "POST") {
      json(res, { id: "page-1", title: "Page", status: "current", spaceId: "space-1", version: { number: 1 } });
    } else {
      json(res, { message: `Unexpected endpoint ${req.method} ${url.pathname}` }, 404);
    }
  }, async (client) => {
    await client.getCurrentUser();
    await client.getPage({ pageId: "page-1" });
    await client.getPageByTitle({ spaceKey: "ENG", title: "Page" });
    await client.createPage({ spaceKey: "ENG", title: "Page", bodyStorage: "<p>Page</p>" });
    await client.updatePage({ pageId: "page-1", title: "Page", bodyStorage: "<p>Page</p>", versionNumber: 2 });
    await client.search({ cql: "type = page" });
    await client.getSpaces();
    await client.getPageComments("page-1");
  });
  assert.ok(paths.includes("GET /wiki/rest/api/user/current"));
  assert.ok(paths.includes("GET /wiki/rest/api/content/search"));
  assert.ok(paths.includes("GET /wiki/api/v2/pages/page-1"));
  assert.ok(paths.includes("GET /wiki/api/v2/pages/page-1/footer-comments"));
  assert.ok(paths.every((path) =>
    !path.includes("/wiki/rest/api/content/page-1")
    && !path.includes("/wiki/rest/api/space")
    && !path.includes("/child/comment"),
  ));
});
