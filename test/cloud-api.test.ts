import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAuthProvider } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { JiraApiError, JiraClient, parseRetryAfter } from "../src/jira-client.js";
import { textToAdf } from "../src/jira-rich-text.js";
import { registerAllTools } from "../src/tools/index.js";
import { loadRequestConfig } from "../src/http-config.js";

const EMAIL = "cloud-test@example.com";
const TOKEN = "placeholder-cloud-api-token";
const authorization = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;

test("combined connector credentials reach Jira as per-user Basic auth", async () => {
  await withApi((req, res) => {
    const aliceAuth = `Basic ${Buffer.from("alice@example.com:placeholder-alice-token").toString("base64")}`;
    const bobAuth = `Basic ${Buffer.from("bob@example.com:placeholder-bob-token").toString("base64")}`;
    assert.ok(req.headers.authorization === aliceAuth || req.headers.authorization === bobAuth);
    assert.ok(req.url?.startsWith("/rest/api/3/myself"));
    assert.equal(req.headers["x-atlassian-credentials"], undefined);
    json(res, { accountId: req.headers.authorization === aliceAuth ? "alice" : "bob" });
  }, async (_client, baseUrl) => {
    const accounts = await Promise.all(["alice", "bob"].map(async (user) => {
      const config = loadRequestConfig({
        headers: { "x-atlassian-credentials": `${user}@example.com,placeholder-${user}-token` },
      } as IncomingMessage, { JIRA_BASE_URL: "https://example.atlassian.net" });
      const client = new JiraClient({ ...config, JIRA_BASE_URL: baseUrl }, createAuthProvider(config));
      return (await client.getMyself()).accountId;
    }));
    assert.deepEqual(accounts, ["alice", "bob"]);
  });
});

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res: ServerResponse, data: unknown, status = 200, headers = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

async function withApi(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
  run: (client: JiraClient, baseUrl: string) => Promise<void>,
  basePath = "",
): Promise<void> {
  const server = createServer((req, res) => {
    void Promise.resolve().then(() => handler(req, res)).catch((err: unknown) => {
      json(res, { errorMessages: [String(err)] }, 500);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    JIRA_DEPLOYMENT: "cloud",
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_CLOUD_EMAIL: EMAIL,
    JIRA_CLOUD_API_TOKEN: TOKEN,
  });
  // Only the local transport is substituted; production Cloud configuration requires HTTPS.
  const client = new JiraClient({ ...config, JIRA_BASE_URL: `${baseUrl}${basePath}` }, createAuthProvider(config));
  try {
    await run(client, baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test("Cloud routes reads, writes, and attachments to v3 with Basic API-token auth", async () => {
  const requests: string[] = [];
  await withApi(async (req, res) => {
    assert.equal(req.headers.authorization, authorization);
    const url = new URL(req.url ?? "", "http://localhost");
    requests.push(`${req.method} ${url.pathname}`);
    assert.ok(url.pathname.startsWith("/rest/api/3/"));
    switch (url.pathname) {
      case "/rest/api/3/myself":
        json(res, { accountId: "cloud-user-id", displayName: "Cloud User" });
        break;
      case "/rest/api/3/serverInfo":
        json(res, { deploymentType: "Cloud" });
        break;
      case "/rest/api/3/issue/ABC-1/transitions":
        if (req.method === "POST") assert.deepEqual(await body(req), { transition: { id: "42" } });
        json(res, { transitions: [{ id: "42", name: "Done" }] });
        break;
      case "/rest/api/3/issueLinkType":
        json(res, { issueLinkTypes: [{ id: "1", name: "Blocks", inward: "blocked by", outward: "blocks" }] });
        break;
      case "/rest/api/3/issue/ABC-1/remotelink":
        json(res, [{ object: { url: "https://example.com", title: "Link" } }]);
        break;
      case "/rest/api/3/issue/ABC-1/editmeta":
        json(res, { fields: {} });
        break;
      case "/rest/api/3/attachment/meta":
        json(res, { enabled: true, uploadLimit: 1024 });
        break;
      case "/rest/api/3/issue/ABC-1/attachments": {
        assert.equal(req.headers["x-atlassian-token"], "no-check");
        assert.match(req.headers["content-type"] ?? "", /^multipart\/form-data/);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        assert.match(Buffer.concat(chunks).toString(), /attachment-content/);
        json(res, [{ id: "1", filename: "cloud.txt" }]);
        break;
      }
      case "/rest/api/3/issue/ABC-1":
        if (req.method === "PUT") {
          assert.deepEqual(await body(req), { update: { labels: [{ add: "cloud" }] } });
          res.writeHead(204);
          res.end();
        } else {
          json(res, { id: "1", key: "ABC-1", fields: { description: textToAdf("Cloud description") } });
        }
        break;
      default:
        json(res, { errorMessages: ["Unexpected endpoint"] }, 404);
    }
  }, async (client) => {
    assert.equal((await client.getMyself()).accountId, "cloud-user-id");
    assert.equal((await client.getServerInfo()).deploymentType, "Cloud");
    assert.deepEqual((await client.getIssue("ABC-1")).fields.description, textToAdf("Cloud description"));
    assert.equal((await client.getTransitions("ABC-1")).transitions[0].id, "42");
    await client.transitionIssue("ABC-1", "42");
    await client.addIssueLabels("ABC-1", ["cloud"]);
    assert.equal((await client.getIssueLinkTypes())[0].name, "Blocks");
    assert.equal((await client.getIssueRemoteLinks("ABC-1"))[0].object?.title, "Link");
    assert.deepEqual(await client.getIssueEditMeta("ABC-1"), { fields: {} });
    assert.equal((await client.addAttachment({
      issueKey: "ABC-1", filename: "cloud.txt", mimeType: "text/plain",
      contentBase64: Buffer.from("attachment-content").toString("base64"),
    }))[0].filename, "cloud.txt");
  });
  assert.equal(requests.length, 11);
});

test("Cloud create, bulk create, comments and link comments encode multiline ADF", async () => {
  const seen: Array<{ path: string; data: Record<string, unknown> }> = [];
  await withApi(async (req, res) => {
    seen.push({ path: req.url ?? "", data: await body(req) });
    json(res, req.url?.endsWith("/bulk") ? { issues: [{ id: "2", key: "ABC-2" }] }
      : req.url?.endsWith("/comment") ? { id: "3", body: textToAdf("Comment\nsecond line") }
      : { id: "1", key: "ABC-1" });
  }, async (client) => {
    const input = { projectKey: "ABC", issueType: "Task", summary: "Title", description: "Line one\n\nLine three" };
    await client.createIssue(input);
    assert.equal((await client.createIssuesBulk([input]))[0].issue?.key, "ABC-2");
    await client.addComment("ABC-1", "Comment\nsecond line");
    await client.linkIssues({ linkType: "Blocks", inwardIssueKey: "ABC-2", outwardIssueKey: "ABC-1", comment: "Link comment" });
  });
  const fields = { project: { key: "ABC" }, issuetype: { name: "Task" }, summary: "Title",
    description: textToAdf("Line one\n\nLine three") };
  assert.deepEqual(seen, [
    { path: "/rest/api/3/issue", data: { fields } },
    { path: "/rest/api/3/issue/bulk", data: { issueUpdates: [{ fields }] } },
    { path: "/rest/api/3/issue/ABC-1/comment", data: { body: textToAdf("Comment\nsecond line") } },
    { path: "/rest/api/3/issueLink", data: { type: { name: "Blocks" },
      inwardIssue: { key: "ABC-2" }, outwardIssue: { key: "ABC-1" }, comment: { body: textToAdf("Link comment") } } },
  ]);
});

test("Cloud scoped-token gateway prefixes are retained for issue and absolute attachment URLs", async () => {
  const paths: string[] = [];
  await withApi(async (req, res) => {
    paths.push((req.url ?? "").split("?")[0]);
    assert.equal(req.headers.authorization, authorization);
    if (req.url?.endsWith("/attachment/meta")) {
      json(res, { enabled: true, uploadLimit: 1024 });
    } else if (req.url?.endsWith("/attachments")) {
      for await (const _chunk of req) { /* drain multipart request */ }
      json(res, [{ id: "1", filename: "file.txt" }]);
    } else {
      json(res, { accountId: "gateway-user" });
    }
  }, async (client) => {
    assert.equal((await client.getMyself()).accountId, "gateway-user");
    await client.addAttachment({ issueKey: "ABC-1", filename: "file.txt", mimeType: "text/plain",
      contentBase64: Buffer.from("data").toString("base64") });
  }, "/ex/jira/site-id");
  assert.deepEqual(paths, [
    "/ex/jira/site-id/rest/api/3/myself",
    "/ex/jira/site-id/rest/api/3/attachment/meta",
    "/ex/jira/site-id/rest/api/3/issue/ABC-1/attachments",
  ]);
});

test("Cloud updates convert only rich-text fields and preserve supplied ADF, nulls and accountId", async () => {
  let update: Record<string, unknown> | undefined;
  const inputFields = {
    description: "Updated", environment: "", customfield_1: "Long text", customfield_2: "Single line",
    customfield_3: textToAdf("Already ADF"), summary: "Summary", assignee: { accountId: "user-2" },
    customfield_4: null,
  };
  const original = structuredClone(inputFields);
  await withApi(async (req, res) => {
    if (req.method === "GET") {
      assert.equal(req.url, "/rest/api/3/issue/ABC-1/editmeta");
      json(res, { fields: {
        customfield_1: { schema: { custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea" } },
        customfield_2: { schema: { custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield" } },
      } });
    } else {
      update = await body(req);
      res.writeHead(204);
      res.end();
    }
  }, async (client) => {
    await client.updateIssue({ issueKey: "ABC-1", fields: inputFields, labelsToAdd: ["new"], labelsToRemove: ["old"] });
  });
  assert.deepEqual(inputFields, original);
  assert.deepEqual(update, { fields: {
    ...inputFields, description: textToAdf("Updated"), environment: textToAdf(""),
    customfield_1: textToAdf("Long text"),
  }, update: { labels: [{ add: "new" }, { remove: "old" }] } });
});

test("Cloud enhanced search follows server caps, exposes continuation, and never fabricates a total", async () => {
  const requests: Record<string, unknown>[] = [];
  const tokens = ["page-2", "page-3"];
  await withApi(async (req, res) => {
    assert.equal(req.url, "/rest/api/3/search/jql");
    const data = await body(req);
    requests.push(data);
    const index = data.nextPageToken ? tokens.indexOf(String(data.nextPageToken)) + 1 : 0;
    json(res, { issues: [{ id: String(index + 1), key: `ABC-${index + 1}`, fields: {} }],
      ...(index < 2 ? { nextPageToken: tokens[index], isLast: false } : { isLast: true }) });
  }, async (client) => {
    const first = await client.searchIssues({ jql: "project = ABC", maxResults: 2, fields: ["summary"] });
    assert.deepEqual(first.issues.map((issue) => issue.key), ["ABC-1", "ABC-2"]);
    assert.equal(first.total, undefined);
    assert.equal(first.isLast, false);
    assert.equal(first.nextPageToken, "page-3");
    const last = await client.searchIssues({ jql: "project = ABC", maxResults: 2,
      fields: ["summary"], nextPageToken: first.nextPageToken });
    assert.equal(last.isLast, true);
    assert.equal(last.nextPageToken, undefined);
    assert.equal(last.issues[0].key, "ABC-3");
  });
  assert.deepEqual(requests.map((request) => request.maxResults), [2, 1, 2]);
  assert.deepEqual(requests[1].fields, ["summary"]);
});

test("Cloud bulk reads exhaust pages before reporting missing keys", async () => {
  let requests = 0;
  await withApi(async (req, res) => {
    const data = await body(req);
    assert.equal(data.jql, 'key in ("ABC-1","ABC-2","ABC-3")');
    requests++;
    json(res, requests === 1
      ? { issues: [{ id: "2", key: "ABC-2", fields: {} }], nextPageToken: "last", isLast: false }
      : { issues: [{ id: "1", key: "ABC-1", fields: {} }], isLast: true });
  }, async (client) => {
    const result = await client.getIssuesBulk(["ABC-1", "ABC-2", "ABC-3"]);
    assert.equal(result.issues.length, 2);
    assert.equal(result.isLast, true);
  });
  assert.equal(requests, 2);
});

test("Cloud search rejects a repeated token instead of silently returning incomplete data", async () => {
  let attempts = 0;
  await withApi((_req, res) => {
    attempts++;
    json(res, { issues: [], nextPageToken: "same", isLast: false });
  }, async (client) => {
    await assert.rejects(client.searchIssues({ jql: "project = ABC" }), /repeated continuation token/);
  });
  assert.equal(attempts, 2);
});

test("Cloud project and comment listings collect every capped page", async () => {
  const offsets: Array<{ path: string; offset: number }> = [];
  await withApi((req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const startAt = Number(url.searchParams.get("startAt"));
    offsets.push({ path: url.pathname, offset: startAt });
    if (url.pathname === "/rest/api/3/project/search") {
      json(res, { startAt, maxResults: 1, total: 2, isLast: startAt === 1,
        values: [{ id: String(startAt), key: `P${startAt}`, name: "Project" }] });
    } else {
      json(res, { startAt, maxResults: 1, total: 2,
        comments: [{ id: String(startAt), body: textToAdf(`Comment ${startAt}`) }] });
    }
  }, async (client) => {
    assert.equal((await client.getProjects()).length, 2);
    assert.equal((await client.getIssueComments("ABC-1")).comments.length, 2);
  });
  assert.deepEqual(offsets.map((entry) => entry.offset), [0, 1, 0, 1]);
});

test("Cloud collection safety limits fail explicitly instead of returning partial success", async () => {
  await withApi((req, res) => {
    if (req.url?.includes("/project/search")) {
      json(res, { startAt: 0, maxResults: 10001, isLast: true,
        values: Array.from({ length: 10001 }, (_, index) => ({ id: String(index), key: `P${index}`, name: "Project" })) });
    } else {
      json(res, { startAt: 0, maxResults: 10001, total: 10001,
        comments: Array.from({ length: 10001 }, (_, index) => ({ id: String(index), body: "Comment" })) });
    }
  }, async (client) => {
    await assert.rejects(client.getProjects(), /10000-item safety limit/);
    await assert.rejects(client.getIssueComments("ABC-1"), /10000-item safety limit/);
  });
});

test("Cloud collections reject repeated offsets and premature empty pages", async () => {
  await withApi((req, res) => {
    if (req.url?.includes("/project/search")) {
      json(res, { startAt: 1, maxResults: 1, isLast: false, values: [] });
    } else {
      json(res, { startAt: 0, maxResults: 1, total: 1, comments: [] });
    }
  }, async (client) => {
    await assert.rejects(client.getProjects(), /unexpected project page offset/);
    await assert.rejects(client.getIssueComments("ABC-1"), /empty comment page/);
  });
});

test("Cloud errors preserve status and redact both API token and encoded Basic credentials", async () => {
  await withApi((_req, res) => {
    json(res, { errorMessages: [`denied ${TOKEN} ${authorization}`] }, 403);
  }, async (client) => {
    await assert.rejects(client.getMyself(), (error: unknown) => {
      assert.ok(error instanceof JiraApiError);
      assert.equal(error.statusCode, 403);
      const message = JSON.stringify({ message: error.message, details: error.jiraErrors });
      assert.ok(!message.includes(TOKEN));
      assert.ok(!message.includes(authorization));
      assert.match(message, /REDACTED/);
      return true;
    });
  });
});

test("Cloud 429 retry honors Retry-After without cycling credentials", async () => {
  const seen: Array<{ time: number; auth?: string }> = [];
  await withApi((req, res) => {
    seen.push({ time: Date.now(), auth: req.headers.authorization });
    json(res, seen.length === 1 ? { errorMessages: ["limited"] } : { accountId: "user" },
      seen.length === 1 ? 429 : 200, { "Retry-After": "0.05" });
  }, async (client) => {
    assert.equal((await client.getMyself()).accountId, "user");
  });
  assert.equal(seen.length, 2);
  assert.ok(seen[1].time - seen[0].time >= 45);
  assert.deepEqual(seen.map((request) => request.auth), [authorization, authorization]);
});

test("Cloud 429 without Retry-After waits for exponential backoff with jitter", async () => {
  const times: number[] = [];
  await withApi((_req, res) => {
    times.push(Date.now());
    json(res, times.length === 1 ? { errorMessages: ["limited"] } : { accountId: "user" },
      times.length === 1 ? 429 : 200);
  }, async (client) => {
    assert.equal((await client.getMyself()).accountId, "user");
  });
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 1000);
});

test("Cloud custom-field metadata failure surfaces an error without attempting an unsafe update", async () => {
  const methods: string[] = [];
  await withApi((req, res) => {
    methods.push(req.method ?? "");
    json(res, { errorMessages: ["Metadata unavailable"] }, 403);
  }, async (client) => {
    await assert.rejects(client.updateIssue({
      issueKey: "ABC-1", fields: { customfield_1: "Rich text might require ADF" },
    }), (error: unknown) => error instanceof JiraApiError && error.statusCode === 403);
  });
  assert.deepEqual(methods, ["GET"]);
});

test("Cloud rate-limit retries stay bounded; ambiguous 5xx writes are not replayed", async () => {
  let attempts = 0;
  await withApi((_req, res) => {
    attempts++;
    json(res, { errorMessages: ["limited"] }, 429, { "Retry-After": "0" });
  }, async (client) => {
    await assert.rejects(client.getMyself(), (error: unknown) =>
      error instanceof JiraApiError && error.statusCode === 429);
  });
  assert.equal(attempts, 6);
  attempts = 0;
  await withApi((_req, res) => {
    attempts++;
    json(res, { errorMessages: ["unavailable"] }, 503);
  }, async (client) => {
    await assert.rejects(client.createIssue({ projectKey: "ABC", issueType: "Task", summary: "Test" }), JiraApiError);
  });
  assert.equal(attempts, 1);
});

test("parses Retry-After seconds and HTTP dates", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  assert.equal(parseRetryAfter("1.5", now), 1500);
  assert.equal(parseRetryAfter("Wed, 19 Aug 2026 12:00:03 GMT", now), 3000);
});

test("Cloud update errors retain the numeric-ID hint for Sprint fields", async () => {
  await withApi((req, res) => {
    if (req.url?.endsWith("/editmeta")) {
      json(res, { fields: { customfield_10100: { schema: { type: "array" } } } });
    } else {
      json(res, { errors: { customfield_10100: "Number value expected as the Sprint id" } }, 400);
    }
  }, async (client) => {
    await assert.rejects(client.updateIssue({
      issueKey: "ABC-1", fields: { customfield_10100: "Sprint 42" },
    }), (error: unknown) => {
      assert.ok(error instanceof JiraApiError);
      assert.match(error.message, /Number value expected as the Sprint id/);
      assert.match(error.message, /hint: this field requires the numeric Jira ID/i);
      return true;
    });
  });
});

test("MCP Cloud tools expose accountId, readable rich text, raw ADF, and search continuation", async () => {
  await withApi((req, res) => {
    if (req.url?.startsWith("/rest/api/3/myself")) {
      json(res, { accountId: "account-123", displayName: "Private User" });
    } else if (req.url === "/rest/api/3/search/jql") {
      json(res, { issues: [{ id: "1", key: "ABC-1", fields: { summary: "Title" } }],
        isLast: false, nextPageToken: "next" });
    } else if (req.url?.includes("/comment")) {
      json(res, { startAt: 0, maxResults: 100, total: 1,
        comments: [{ id: "c1", body: textToAdf("Comment") }] });
    } else {
      json(res, { id: "1", key: "ABC-1", fields: { description: textToAdf("Description"),
        comment: { comments: [{ body: textToAdf("Inline comment") }] } } });
    }
  }, async (jira) => {
    const server = new McpServer({ name: "cloud-test", version: "1" });
    registerAllTools(server, jira);
    const client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      async function call(name: string, args: Record<string, unknown> = {}) {
        const result = await client.callTool({ name, arguments: args });
        assert.ok(!result.isError, JSON.stringify(result));
        const content = result.content;
        assert.ok(Array.isArray(content));
        const block = content[0];
        assert.equal(block.type, "text");
        return JSON.parse(String(block.text)) as Record<string, unknown>;
      }
      const me = await call("get_current_user");
      assert.equal(me.accountId, "account-123");
      assert.equal(me.email, undefined);
      const issue = await call("get_issue", { issueKey: "ABC-1" });
      assert.equal(issue.description, "Description");
      assert.deepEqual(issue.descriptionAdf, textToAdf("Description"));
      const comments = await call("get_issue_comments", { issueKey: "ABC-1" });
      assert.deepEqual(comments.comments, [{ id: "c1", body: "Comment", bodyAdf: textToAdf("Comment") }]);
      const search = await call("search_issues", { jql: "project = ABC", maxResults: 1 });
      assert.equal(search.isLast, false);
      assert.equal(search.nextPageToken, "next");
      assert.equal(search.total, undefined);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
