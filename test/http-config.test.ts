import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { loadRequestConfig } from "../src/http-config.js";
import { createAuthProvider, createConfluenceAuthProvider } from "../src/auth.js";

function request(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

const cloudEnv = {
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_CLOUD_EMAIL: "test@example.com",
  JIRA_CLOUD_API_TOKEN: "placeholder-cloud-token",
};

test("HTTP defaults to Cloud and retains configured credentials", () => {
  const config = loadRequestConfig(request({}), cloudEnv);
  assert.equal(config.JIRA_DEPLOYMENT, "cloud");
  assert.equal(config.JIRA_CLOUD_EMAIL, cloudEnv.JIRA_CLOUD_EMAIL);
  assert.equal(config.JIRA_CLOUD_API_TOKEN, cloudEnv.JIRA_CLOUD_API_TOKEN);
});

test("HTTP accepts paired per-request credentials without changing other requests", () => {
  const config = loadRequestConfig(request({
    "x-jira-cloud-email": "override@example.com",
    "x-jira-cloud-api-token": "override-cloud-token",
  }), cloudEnv);
  assert.equal(config.JIRA_CLOUD_EMAIL, "override@example.com");
  assert.equal(config.JIRA_CLOUD_API_TOKEN, "override-cloud-token");
  assert.equal(config.JIRA_BASE_URL, cloudEnv.JIRA_BASE_URL);
  assert.equal(loadRequestConfig(request({}), cloudEnv).JIRA_CLOUD_API_TOKEN,
    cloudEnv.JIRA_CLOUD_API_TOKEN);
});

test("HTTP can use only request credentials without environment credentials", () => {
  const config = loadRequestConfig(request({
    "x-jira-cloud-email": cloudEnv.JIRA_CLOUD_EMAIL,
    "x-jira-cloud-api-token": cloudEnv.JIRA_CLOUD_API_TOKEN,
  }), { JIRA_BASE_URL: cloudEnv.JIRA_BASE_URL });
  assert.equal(config.JIRA_DEPLOYMENT, "cloud");
});

test("HTTP rejects all request-selected destinations before using any credentials", () => {
  for (const header of ["x-jira-base-url", "x-confluence-base-url"]) {
    for (const credentials of [
      {},
      { "x-jira-cloud-email": "override@example.com", "x-jira-cloud-api-token": "override-token" },
      { "x-atlassian-credentials": "override@example.com,override-token" },
    ]) {
      assert.throws(() => loadRequestConfig(request({
        ...credentials, [header]: "https://attacker.example",
      }), cloudEnv), /Base URL overrides are not allowed/);
    }
  }
});

test("HTTP rejects partial pairs, legacy PAT headers, and non-Cloud deployments", () => {
  for (const header of ["x-jira-cloud-email", "x-jira-cloud-api-token"]) {
    assert.throws(() => loadRequestConfig(request({ [header]: "placeholder" }), cloudEnv),
      /supplied together/);
  }
  for (const header of ["x-jira-pat", "x-confluence-pat"]) {
    assert.throws(() => loadRequestConfig(request({ [header]: "placeholder-secret" }), cloudEnv),
      /no longer supported/);
  }
  for (const header of ["x-jira-deployment", "x-confluence-deployment"]) {
    assert.throws(() => loadRequestConfig(request({ [header]: "datacenter" }), cloudEnv), /cloud/);
    assert.throws(() => loadRequestConfig(request({ [header]: "unknown" }), cloudEnv), /cloud/);
  }
});

test("combined Jira credentials replace environment credentials and produce Atlassian Basic auth", () => {
  const config = loadRequestConfig(request({
    "x-atlassian-credentials": " user@example.com , placeholder-user-token ",
  }), cloudEnv);
  assert.equal(config.JIRA_CLOUD_EMAIL, "user@example.com");
  assert.equal(config.JIRA_CLOUD_API_TOKEN, "placeholder-user-token");
  assert.equal(createAuthProvider(config).getAuthHeader(),
    `Basic ${Buffer.from("user@example.com:placeholder-user-token").toString("base64")}`);
  assert.equal(loadRequestConfig(request({}), cloudEnv).JIRA_CLOUD_API_TOKEN,
    cloudEnv.JIRA_CLOUD_API_TOKEN);
});

test("combined credentials work without server-side tokens and split only at the first comma", () => {
  const config = loadRequestConfig(request({
    "x-atlassian-credentials": "user@example.com,placeholder,token",
  }), { JIRA_BASE_URL: cloudEnv.JIRA_BASE_URL });
  assert.equal(config.JIRA_CLOUD_API_TOKEN, "placeholder,token");
});

test("Confluence combined credentials are explicit, independent, and never inherited from Jira", () => {
  const headers = {
    "x-atlassian-credentials": "jira@example.com,placeholder-jira-token",
    "x-confluence-credentials": "wiki@example.com,placeholder-wiki-token",
  };
  const env = {
    JIRA_BASE_URL: cloudEnv.JIRA_BASE_URL,
    CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
  };
  const config = loadRequestConfig(request(headers), env);
  assert.equal(config.JIRA_CLOUD_API_TOKEN, "placeholder-jira-token");
  assert.equal(config.CONFLUENCE_CLOUD_EMAIL, "wiki@example.com");
  assert.equal(createConfluenceAuthProvider(config).getAuthHeader(),
    `Basic ${Buffer.from("wiki@example.com:placeholder-wiki-token").toString("base64")}`);
  assert.throws(() => loadRequestConfig(request({
    "x-atlassian-credentials": headers["x-atlassian-credentials"],
  }), env), /CONFLUENCE_CLOUD/);
  const wikiOnly = loadRequestConfig(request({
    "x-confluence-credentials": headers["x-confluence-credentials"],
  }), { ...cloudEnv, CONFLUENCE_BASE_URL: env.CONFLUENCE_BASE_URL });
  assert.equal(wikiOnly.JIRA_CLOUD_API_TOKEN, cloudEnv.JIRA_CLOUD_API_TOKEN);
});

test("malformed and repeated combined credentials are rejected without exposing secrets or falling back", () => {
  for (const header of ["x-atlassian-credentials", "x-confluence-credentials"]) {
    for (const value of [
      "", "placeholder-secret", "not-email,placeholder-secret", ",placeholder-secret",
      "user@example.com,", "user@example.com,   ", "user@example.com,placeholder secret",
      "user@example.com,placeholder\r\nsecret",
    ]) {
      assert.throws(() => loadRequestConfig(request({ [header]: value }), cloudEnv),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(!error.message.includes("placeholder-secret"));
          assert.ok(!error.message.includes("user@example.com"));
          assert.ok(error.message.includes(header));
          return true;
        });
    }
    assert.throws(() => loadRequestConfig(request({
      [header]: ["user@example.com,first", "user@example.com,second"],
    }), cloudEnv), /exactly once/);
    assert.throws(() => loadRequestConfig({
      headers: { [header]: "user@example.com,first, user@example.com,second" },
      rawHeaders: [header, "user@example.com,first", header.toUpperCase(), "user@example.com,second"],
    } as IncomingMessage, cloudEnv), /exactly once/);
  }
});

test("combined credentials reject ambiguous sources and require fixed server-side destinations", () => {
  const combined = { "x-atlassian-credentials": "user@example.com,placeholder-secret" };
  for (const field of ["x-jira-cloud-email", "x-jira-cloud-api-token"]) {
    assert.throws(() => loadRequestConfig(request({ ...combined, [field]: "placeholder" }), cloudEnv),
      /not both/);
  }
  for (const field of ["x-confluence-cloud-email", "x-confluence-cloud-api-token"]) {
    assert.throws(() => loadRequestConfig(request({
      "x-confluence-credentials": "user@example.com,placeholder-secret", [field]: "placeholder",
    }), cloudEnv), /not both/);
  }
  for (const field of ["x-jira-base-url", "x-confluence-base-url"]) {
    assert.throws(() => loadRequestConfig(request({
      ...combined, [field]: "https://other.example.com",
    }), cloudEnv), /Base URL overrides/);
  }
  assert.throws(() => loadRequestConfig(request(combined), {}), /JIRA_BASE_URL must be configured/);
  assert.throws(() => loadRequestConfig(request({
    "x-confluence-credentials": "user@example.com,placeholder-secret",
  }), cloudEnv), /CONFLUENCE_BASE_URL must be configured/);
});
