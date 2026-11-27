import assert from "node:assert/strict";
import { test } from "node:test";
import { BasicAuthProvider, createAuthProvider, createConfluenceAuthProvider } from "../src/auth.js";
import { loadConfig } from "../src/config.js";

const CLOUD_EMAIL = "jira-cloud@example.com";
const CLOUD_TOKEN = "placeholder-cloud-api-token";
const cloudEnv = {
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_CLOUD_EMAIL: CLOUD_EMAIL,
  JIRA_CLOUD_API_TOKEN: CLOUD_TOKEN,
};

test("defaults to Cloud and uses email/API-token Basic authentication", async () => {
  const config = loadConfig(cloudEnv);
  assert.equal(config.JIRA_DEPLOYMENT, "cloud");
  const provider = createAuthProvider(config);
  const encoded = Buffer.from(`${CLOUD_EMAIL}:${CLOUD_TOKEN}`, "utf8").toString("base64");
  assert.ok(provider instanceof BasicAuthProvider);
  assert.equal((await provider.acquireAuth()).header, `Basic ${encoded}`);
  assert.ok(provider.getSensitiveValues().includes(encoded));
  assert.ok(provider.getSensitiveValues().includes(`Basic ${encoded}`));
});

test("accepts explicit Cloud deployment and normalizes the scoped gateway URL", () => {
  const config = loadConfig({
    ...cloudEnv, JIRA_DEPLOYMENT: "cloud",
    JIRA_BASE_URL: "https://api.atlassian.com/ex/jira/site-id/",
  });
  assert.equal(config.JIRA_BASE_URL, "https://api.atlassian.com/ex/jira/site-id");
});

test("rejects missing or invalid Cloud credentials without exposing secrets", () => {
  for (const overrides of [
    { JIRA_CLOUD_EMAIL: undefined },
    { JIRA_CLOUD_API_TOKEN: undefined },
    { JIRA_CLOUD_EMAIL: "invalid-email" },
    { JIRA_CLOUD_API_TOKEN: "   " },
  ]) {
    assert.throws(() => loadConfig({ ...cloudEnv, ...overrides }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /JIRA_CLOUD/);
      assert.ok(!error.message.includes(CLOUD_TOKEN));
      return true;
    });
  }
  assert.throws(() => createAuthProvider({
    ...loadConfig(cloudEnv), JIRA_CLOUD_API_TOKEN: "",
  }), /requires both/);
});

test("rejects legacy authentication rather than ignoring it or falling back", () => {
  for (const field of [
    "JIRA_PAT", "JIRA_PATS", "JIRA_USERNAME", "JIRA_PASSWORD",
    "CONFLUENCE_PAT", "CONFLUENCE_USERNAME", "CONFLUENCE_PASSWORD",
  ]) {
    assert.throws(() => loadConfig({ ...cloudEnv, [field]: "placeholder-legacy-secret" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(field));
        assert.ok(!error.message.includes("placeholder-legacy-secret"));
        assert.ok(!error.message.includes(CLOUD_TOKEN));
        return true;
      });
  }
  for (const field of ["JIRA_DEPLOYMENT", "CONFLUENCE_DEPLOYMENT"]) {
    assert.throws(() => loadConfig({ ...cloudEnv, [field]: "datacenter" }), /cloud/);
  }
});

test("requires HTTPS and strict TLS verification", () => {
  assert.throws(() => loadConfig({
    ...cloudEnv, JIRA_BASE_URL: "http://example.atlassian.net",
  }), /JIRA_BASE_URL must use HTTPS/);
  assert.throws(() => loadConfig({
    ...cloudEnv, JIRA_TLS_REJECT_UNAUTHORIZED: "false",
  }), /JIRA_TLS_REJECT_UNAUTHORIZED must be true/);
});

test("Confluence never reuses Jira credentials", () => {
  assert.throws(() => createConfluenceAuthProvider(loadConfig(cloudEnv)), /Confluence Cloud requires/);
  assert.throws(() => loadConfig({
    ...cloudEnv, CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
  }), /CONFLUENCE_CLOUD_EMAIL is required/);
  const config = loadConfig({
    ...cloudEnv, CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
    CONFLUENCE_CLOUD_EMAIL: "wiki@example.com",
    CONFLUENCE_CLOUD_API_TOKEN: "placeholder-wiki-token",
  });
  const provider = createConfluenceAuthProvider(config);
  assert.equal(provider.getAuthHeader(),
    `Basic ${Buffer.from("wiki@example.com:placeholder-wiki-token").toString("base64")}`);
  assert.ok(!provider.getSensitiveValues().includes(CLOUD_TOKEN));
});
