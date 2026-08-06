import type { AppConfig } from "./config.js";

/**
 * Abstraction over Jira Data Center authentication schemes.
 *
 * Both schemes ultimately resolve to a single `Authorization` header applied
 * to every outgoing request. This keeps `jira-client.ts` fully decoupled from
 * *how* credentials are supplied.
 */
export interface AuthProvider {
  readonly scheme: "pat" | "basic";
  getAuthHeader(): string;
}

export class PatAuthProvider implements AuthProvider {
  readonly scheme = "pat" as const;

  constructor(private readonly token: string) {
    if (!token) {
      throw new Error("PatAuthProvider requires a non-empty token");
    }
  }

  getAuthHeader(): string {
    return `Bearer ${this.token}`;
  }
}

export class BasicAuthProvider implements AuthProvider {
  readonly scheme = "basic" as const;

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {
    if (!username || !password) {
      throw new Error("BasicAuthProvider requires both username and password");
    }
  }

  getAuthHeader(): string {
    const encoded = Buffer.from(`${this.username}:${this.password}`, "utf-8").toString(
      "base64",
    );
    return `Basic ${encoded}`;
  }
}

/**
 * Builds the appropriate AuthProvider from configuration.
 * PAT takes precedence over Basic auth when both are configured.
 */
export function createAuthProvider(config: AppConfig): AuthProvider {
  if (config.JIRA_PAT) {
    return new PatAuthProvider(config.JIRA_PAT);
  }
  if (config.JIRA_USERNAME && config.JIRA_PASSWORD) {
    return new BasicAuthProvider(config.JIRA_USERNAME, config.JIRA_PASSWORD);
  }
  throw new Error(
    "No authentication configured. Set JIRA_PAT, or both JIRA_USERNAME and JIRA_PASSWORD.",
  );
}
