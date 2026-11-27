import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { isHttpRequestAuthorized, loadHttpAccessToken } from "../src/http-auth.js";

const token = "test_access_token_012345678901234567890123456789012345";

test("HTTP startup requires a sufficiently long base64url access token", () => {
  for (const value of [undefined, "", "short", "a".repeat(42), "a".repeat(43) + " "]) {
    assert.throws(() => loadHttpAccessToken({ MCP_HTTP_ACCESS_TOKEN: value }), /MCP_HTTP_ACCESS_TOKEN/);
  }
  assert.equal(loadHttpAccessToken({ MCP_HTTP_ACCESS_TOKEN: token }), token);
});

test("HTTP authentication rejects missing, incorrect and duplicate credentials", () => {
  const req = (value: string | undefined, rawHeaders: string[]) =>
    ({ headers: { "x-mcp-access-token": value }, rawHeaders }) as IncomingMessage;
  assert.equal(isHttpRequestAuthorized(req(undefined, []), token), false);
  assert.equal(isHttpRequestAuthorized(req("wrong", ["X-MCP-Access-Token", "wrong"]), token), false);
  assert.equal(isHttpRequestAuthorized(req(token, ["X-MCP-Access-Token", token]), token), true);
  assert.equal(isHttpRequestAuthorized(req(token, [
    "X-MCP-Access-Token", token, "x-mcp-access-token", token,
  ]), token), false);
});
