import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function loadHttpAccessToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.MCP_HTTP_ACCESS_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{43,}$/.test(token)) {
    throw new Error("MCP_HTTP_ACCESS_TOKEN must be a high-entropy base64url token of at least 43 characters.");
  }
  return token;
}

export function isHttpRequestAuthorized(req: IncomingMessage, expected: string): boolean {
  const name = "x-mcp-access-token";
  const count = req.rawHeaders.filter((_, index) =>
    index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length;
  const received = req.headers[name];
  if (count !== 1 || typeof received !== "string") return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(received), digest(expected));
}
