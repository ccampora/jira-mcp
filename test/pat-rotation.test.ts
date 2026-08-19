import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import {
  PatAuthProvider,
  RotatingPatAuthProvider,
  createAuthProvider,
} from "../src/auth.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { JiraApiError, JiraClient, parseRetryAfter } from "../src/jira-client.js";

const PAT_ALPHA = "placeholder-pat-alpha";
const PAT_BETA = "placeholder-pat-beta";
const PAT_GAMMA = "placeholder-pat-gamma";

function config(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    JIRA_BASE_URL: "http://127.0.0.1",
    JIRA_PAT: PAT_ALPHA,
    ...overrides,
  });
}

async function withJiraServer<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
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

function respondJson(res: ServerResponse, status: number, body: unknown, headers = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
});

test("uses a single legacy JIRA_PAT", async () => {
  const provider = createAuthProvider(config());
  assert.ok(provider instanceof PatAuthProvider);
  assert.equal((await provider.acquireAuth()).header, `Bearer ${PAT_ALPHA}`);
});

test("parses JIRA_PATS and gives it precedence over JIRA_PAT", async () => {
  const provider = createAuthProvider(config({
    JIRA_PATS: JSON.stringify([PAT_ALPHA, PAT_BETA]),
    JIRA_PAT: PAT_GAMMA,
  }));
  assert.ok(provider instanceof RotatingPatAuthProvider);
  assert.equal((await provider.acquireAuth()).header, `Bearer ${PAT_ALPHA}`);
});

test("selects PATs in round-robin order", async () => {
  const provider = new RotatingPatAuthProvider([PAT_ALPHA, PAT_BETA, PAT_GAMMA]);
  const headers = [];
  for (let index = 0; index < 5; index++) headers.push((await provider.acquireAuth()).header);
  assert.deepEqual(headers, [
    `Bearer ${PAT_ALPHA}`,
    `Bearer ${PAT_BETA}`,
    `Bearer ${PAT_GAMMA}`,
    `Bearer ${PAT_ALPHA}`,
    `Bearer ${PAT_BETA}`,
  ]);
});

test("skips only the throttled PAT", async () => {
  let now = 100;
  const provider = new RotatingPatAuthProvider([PAT_ALPHA, PAT_BETA], { now: () => now });
  const first = await provider.acquireAuth();
  first.markRateLimited(1000);
  assert.equal((await provider.acquireAuth()).header, `Bearer ${PAT_BETA}`);
  assert.equal((await provider.acquireAuth()).header, `Bearer ${PAT_BETA}`);
  now = 1100;
  assert.equal((await provider.acquireAuth()).header, `Bearer ${PAT_ALPHA}`);
});

test("waits until the earliest cooldown when every PAT is cooling down", async () => {
  let now = 100;
  const waits: number[] = [];
  const provider = new RotatingPatAuthProvider([PAT_ALPHA, PAT_BETA], {
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });
  const first = await provider.acquireAuth();
  first.markRateLimited(1000);
  const second = await provider.acquireAuth();
  second.markRateLimited(2000);

  assert.equal((await provider.acquireAuth()).header, `Bearer ${PAT_ALPHA}`);
  assert.deepEqual(waits, [1000]);
});

test("rejects malformed and empty JIRA_PATS without exposing input", () => {
  const malformed = "not-json-placeholder-secret";
  assert.throws(
    () => config({ JIRA_PATS: malformed, JIRA_PAT: undefined }),
    (error: unknown) => error instanceof Error
      && error.message.includes("valid JSON array")
      && !error.message.includes(malformed),
  );
  assert.throws(
    () => config({ JIRA_PATS: JSON.stringify(["", "  "]), JIRA_PAT: undefined }),
    /at least one non-empty PAT/,
  );
  assert.throws(
    () => config({ JIRA_PAT: undefined }),
    /No authentication configured/,
  );
});

test("parses Retry-After seconds and HTTP dates", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  assert.equal(parseRetryAfter("1.5", now), 1500);
  assert.equal(parseRetryAfter("Wed, 19 Aug 2026 12:00:03 GMT", now), 3000);
});

test("retries a 429 immediately with another available PAT", async () => {
  const seen: Array<string | undefined> = [];
  await withJiraServer((req, res) => {
    seen.push(req.headers.authorization);
    if (seen.length === 1) {
      respondJson(res, 429, { errorMessages: ["rate limited"] }, { "Retry-After": "10" });
      return;
    }
    respondJson(res, 200, { version: "test" });
  }, async (baseUrl) => {
    const client = new JiraClient(
      { ...config({ JIRA_PATS: JSON.stringify([PAT_ALPHA, PAT_BETA]) }), JIRA_BASE_URL: baseUrl },
      new RotatingPatAuthProvider([PAT_ALPHA, PAT_BETA]),
    );
    await client.getServerInfo();
  });
  assert.deepEqual(seen, [`Bearer ${PAT_ALPHA}`, `Bearer ${PAT_BETA}`]);
});

test("bounds 429 retries and redacts credentials from errors and logs", async () => {
  const capturedLogs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => capturedLogs.push(args);
  let attempts = 0;
  try {
    await withJiraServer((req, res) => {
      attempts++;
      const echoedCredential = req.headers.authorization?.replace("Bearer ", "");
      respondJson(
        res,
        429,
        { errorMessages: [`rejected credential ${echoedCredential}`] },
        { "Retry-After": "0" },
      );
    }, async (baseUrl) => {
      const provider = new RotatingPatAuthProvider([PAT_ALPHA, PAT_BETA]);
      const client = new JiraClient({ ...config(), JIRA_BASE_URL: baseUrl }, provider);
      await assert.rejects(client.getServerInfo(), (error: unknown) => {
        assert.ok(error instanceof JiraApiError);
        const surfaced = JSON.stringify({ message: error.message, details: error.jiraErrors });
        assert.ok(!surfaced.includes(PAT_ALPHA));
        assert.ok(!surfaced.includes(PAT_BETA));
        assert.match(surfaced, /\[REDACTED\]/);
        return true;
      });
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(attempts, 6);
  const logged = JSON.stringify(capturedLogs);
  assert.ok(!logged.includes(PAT_ALPHA));
  assert.ok(!logged.includes(PAT_BETA));
});

test("does not add retries for transient 5xx failures", async () => {
  let attempts = 0;
  await withJiraServer((_req, res) => {
    attempts++;
    respondJson(res, 503, { errorMessages: ["temporarily unavailable"] });
  }, async (baseUrl) => {
    const client = new JiraClient({ ...config(), JIRA_BASE_URL: baseUrl }, new PatAuthProvider(PAT_ALPHA));
    await assert.rejects(client.getServerInfo(), JiraApiError);
  });
  assert.equal(attempts, 1);
});

test("keeps concurrent PAT acquisition in round-robin order", async () => {
  const provider = new RotatingPatAuthProvider([PAT_ALPHA, PAT_BETA, PAT_GAMMA]);
  const leases = await Promise.all(
    Array.from({ length: 12 }, () => provider.acquireAuth()),
  );
  assert.deepEqual(
    leases.map((lease) => lease.header),
    Array.from({ length: 12 }, (_, index) =>
      `Bearer ${[PAT_ALPHA, PAT_BETA, PAT_GAMMA][index % 3]}`,
    ),
  );
});