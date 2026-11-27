import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { loadRequestConfig } from "../src/http-config.js";

const jiraCloud = {
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_CLOUD_EMAIL: "jira@example.com",
  JIRA_CLOUD_API_TOKEN: "placeholder-jira-token",
};
const wikiCloud = {
  CONFLUENCE_BASE_URL: "https://example.atlassian.net/wiki",
  CONFLUENCE_CLOUD_EMAIL: "wiki@example.com",
  CONFLUENCE_CLOUD_API_TOKEN: "placeholder-wiki-cloud-token",
};

function request(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

test("Confluence is optional, defaults to Cloud, and normalizes /wiki gateway URLs", () => {
  assert.equal(loadConfig(jiraCloud).CONFLUENCE_DEPLOYMENT, "cloud");
  assert.equal(loadConfig(jiraCloud).CONFLUENCE_BASE_URL, undefined);
  const config = loadConfig({
    ...jiraCloud, ...wikiCloud,
    CONFLUENCE_BASE_URL: "https://api.atlassian.com/ex/confluence/site-id/wiki/",
  });
  assert.equal(config.CONFLUENCE_BASE_URL, "https://api.atlassian.com/ex/confluence/site-id/wiki");
});

test("Confluence requires its own complete configuration without exposing secrets", () => {
  for (const field of Object.keys(wikiCloud)) {
    assert.throws(() => loadConfig({ ...jiraCloud, ...wikiCloud, [field]: undefined }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(field));
        assert.ok(!error.message.includes(wikiCloud.CONFLUENCE_CLOUD_API_TOKEN));
        return true;
      });
  }
});

test("Confluence requires safe HTTPS /wiki URLs and strict TLS", () => {
  for (const base of [
    "http://example.com/wiki", "https://example.com", "https://example.com/wiki?x=y",
    "https://example.com/wiki#fragment", "https://user:password@example.com/wiki", "not-a-url",
  ]) {
    assert.throws(() => loadConfig({ ...jiraCloud, ...wikiCloud, CONFLUENCE_BASE_URL: base }),
      /CONFLUENCE_BASE_URL/);
  }
  assert.throws(() => loadConfig({
    ...jiraCloud, ...wikiCloud, JIRA_TLS_REJECT_UNAUTHORIZED: "false",
  }), /must be true/);
});

test("HTTP Confluence overrides are independent and credential pairs are atomic", () => {
  const env = { ...jiraCloud, ...wikiCloud };
  const config = loadRequestConfig(request({
    "x-confluence-base-url": "https://other.atlassian.net/wiki",
    "x-confluence-cloud-email": "other@example.com",
    "x-confluence-cloud-api-token": "placeholder-override",
  }), env);
  assert.equal(config.JIRA_CLOUD_API_TOKEN, jiraCloud.JIRA_CLOUD_API_TOKEN);
  assert.equal(config.CONFLUENCE_CLOUD_EMAIL, "other@example.com");
  assert.equal(config.CONFLUENCE_CLOUD_API_TOKEN, "placeholder-override");
  assert.equal(config.CONFLUENCE_BASE_URL, "https://other.atlassian.net/wiki");
  for (const header of ["x-confluence-cloud-email", "x-confluence-cloud-api-token"]) {
    assert.throws(() => loadRequestConfig(request({ [header]: "placeholder" }), env),
      /supplied together/);
  }
});
