import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createAuthProvider } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { JiraClient } from "../src/jira-client.js";

const TEST_TOKEN = "placeholder-attachment-token";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function withJiraServer<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error: unknown) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errorMessages: [String(error)] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

test("constructs the Jira Cloud v3 multipart attachment request", async () => {
  const fileContent = Buffer.from("hello attachment", "utf8");
  let postRequest: {
    url?: string;
    token?: string;
    authorization?: string;
    contentType?: string;
    body: Buffer;
  } | undefined;

  await withJiraServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/rest/api/3/attachment/meta") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ enabled: true, uploadLimit: 1024 * 1024 }));
      return;
    }

    postRequest = {
      url: req.url,
      token: req.headers["x-atlassian-token"] as string | undefined,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      body: await readBody(req),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      id: "10001",
      filename: "evidence.txt",
      size: fileContent.length,
      mimeType: "text/plain",
      created: "2026-08-31T10:00:00.000Z",
      author: { displayName: "Test User" },
    }]));
  }, async (baseUrl) => {
    const appConfig = loadConfig({
      JIRA_BASE_URL: "https://example.atlassian.net",
      JIRA_CLOUD_EMAIL: "attachment@example.com",
      JIRA_CLOUD_API_TOKEN: TEST_TOKEN,
    });
    const client = new JiraClient({ ...appConfig, JIRA_BASE_URL: baseUrl }, createAuthProvider(appConfig));
    const result = await client.addAttachment({
      issueKey: "NFS-1234",
      filename: "evidence.txt",
      mimeType: "text/plain",
      contentBase64: fileContent.toString("base64"),
    });
    assert.equal(result[0]?.filename, "evidence.txt");
  });

  assert.ok(postRequest);
  assert.equal(postRequest.url, "/rest/api/3/issue/NFS-1234/attachments");
  assert.equal(postRequest.token, "no-check");
  assert.equal(postRequest.authorization,
    `Basic ${Buffer.from(`attachment@example.com:${TEST_TOKEN}`).toString("base64")}`);
  assert.match(postRequest.contentType ?? "", /^multipart\/form-data; boundary=/);

  const multipartBody = postRequest.body.toString("latin1");
  assert.match(multipartBody, /name="file"/);
  assert.match(multipartBody, /filename="evidence\.txt"/);
  assert.match(multipartBody, /Content-Type: text\/plain/i);
  assert.ok(postRequest.body.includes(fileContent));
});