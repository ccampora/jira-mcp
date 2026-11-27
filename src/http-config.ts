import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { loadConfig, type AppConfig } from "./config.js";

const combinedCredentialsSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1).regex(/^[^\s\x00-\x1f\x7f]+$/),
});

function combinedCredentials(
  req: IncomingMessage,
  name: string,
): { email: string; token: string } | undefined {
  const value = req.headers[name];
  if (value === undefined) return undefined;
  const occurrences = req.rawHeaders?.filter((_, index) =>
    index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length ?? 1;
  if (Array.isArray(value) || occurrences !== 1) {
    throw new Error(`${name} must be supplied exactly once.`);
  }
  const separator = value.indexOf(",");
  const parsed = combinedCredentialsSchema.safeParse({
    email: separator < 0 ? "" : value.slice(0, separator).trim(),
    token: separator < 0 ? "" : value.slice(separator + 1).trim(),
  });
  if (!parsed.success) {
    throw new Error(`${name} must contain a valid email and nonempty API token separated by a comma.`);
  }
  return parsed.data;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function loadRequestConfig(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  for (const name of ["x-jira-pat", "x-confluence-pat"]) {
    if (headerValue(req, name) !== undefined) {
      throw new Error(`${name} is no longer supported; supply Cloud email/API-token headers.`);
    }
  }
  const overrides: NodeJS.ProcessEnv = {};
  const jiraCredentials = combinedCredentials(req, "x-atlassian-credentials");
  const confluenceCredentials = combinedCredentials(req, "x-confluence-credentials");
  if (jiraCredentials || confluenceCredentials) {
    for (const product of ["jira", "confluence"]) {
      if (headerValue(req, `x-${product}-base-url`) !== undefined) {
        throw new Error("Base URL overrides are not allowed with combined credentials; configure server-side URLs.");
      }
    }
  }
  for (const product of ["jira", "confluence"]) {
    const credentials = product === "jira" ? jiraCredentials : confluenceCredentials;
    const email = headerValue(req, `x-${product}-cloud-email`);
    const token = headerValue(req, `x-${product}-cloud-api-token`);
    if (credentials && (email !== undefined || token !== undefined)) {
      throw new Error(`Supply either combined credentials or separate ${product} credential headers, not both.`);
    }
    if (credentials && !env[`${product.toUpperCase()}_BASE_URL`]) {
      throw new Error(`${product.toUpperCase()}_BASE_URL must be configured server-side for combined credentials.`);
    }
    if ((email !== undefined) !== (token !== undefined)) {
      throw new Error(`X-${product}-Cloud-Email and X-${product}-Cloud-Api-Token must be supplied together`);
    }
    for (const suffix of ["deployment", "base-url", "cloud-email", "cloud-api-token"]) {
      const value = headerValue(req, `x-${product}-${suffix}`);
      if (value !== undefined) {
        overrides[`${product}-${suffix}`.replaceAll("-", "_").toUpperCase()] = value;
      }
    }
    if (credentials) {
      overrides[`${product.toUpperCase()}_CLOUD_EMAIL`] = credentials.email;
      overrides[`${product.toUpperCase()}_CLOUD_API_TOKEN`] = credentials.token;
    }
  }
  return loadConfig({ ...env, ...overrides });
}
