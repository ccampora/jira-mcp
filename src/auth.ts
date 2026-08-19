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
  acquireAuth(): Promise<AuthLease>;
  getSensitiveValues(): readonly string[];
}

export interface AuthLease {
  readonly header: string;
  markRateLimited(retryAfterMs: number): void;
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

  async acquireAuth(): Promise<AuthLease> {
    return { header: this.getAuthHeader(), markRateLimited: () => undefined };
  }

  getSensitiveValues(): readonly string[] {
    return [this.token];
  }
}

interface RotatingPatAuthProviderOptions {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class RotatingPatAuthProvider implements AuthProvider {
  readonly scheme = "pat" as const;
  private readonly cooldownUntil: number[];
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private nextIndex = 0;

  constructor(
    private readonly tokens: readonly string[],
    options: RotatingPatAuthProviderOptions = {},
  ) {
    if (tokens.length === 0 || tokens.some((token) => !token)) {
      throw new Error("RotatingPatAuthProvider requires at least one non-empty token");
    }
    this.cooldownUntil = tokens.map(() => 0);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  getAuthHeader(): string {
    return `Bearer ${this.tokens[0]}`;
  }

  getSensitiveValues(): readonly string[] {
    return this.tokens;
  }

  async acquireAuth(): Promise<AuthLease> {
    while (true) {
      const now = this.now();
      for (let offset = 0; offset < this.tokens.length; offset++) {
        const index = (this.nextIndex + offset) % this.tokens.length;
        if (this.cooldownUntil[index] <= now) {
          this.nextIndex = (index + 1) % this.tokens.length;
          return {
            header: `Bearer ${this.tokens[index]}`,
            markRateLimited: (retryAfterMs) => {
              this.cooldownUntil[index] = Math.max(
                this.cooldownUntil[index],
                this.now() + Math.max(0, retryAfterMs),
              );
            },
          };
        }
      }

      await this.sleep(Math.max(0, Math.min(...this.cooldownUntil) - now));
    }
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

  async acquireAuth(): Promise<AuthLease> {
    return { header: this.getAuthHeader(), markRateLimited: () => undefined };
  }

  getSensitiveValues(): readonly string[] {
    return [this.username, this.password];
  }
}

/**
 * Builds the appropriate AuthProvider from configuration.
 * PAT takes precedence over Basic auth when both are configured.
 */
export function createAuthProvider(config: AppConfig): AuthProvider {
  if (config.JIRA_PATS?.length) {
    return new RotatingPatAuthProvider(config.JIRA_PATS);
  }
  if (config.JIRA_PAT) {
    return new PatAuthProvider(config.JIRA_PAT);
  }
  if (config.JIRA_USERNAME && config.JIRA_PASSWORD) {
    return new BasicAuthProvider(config.JIRA_USERNAME, config.JIRA_PASSWORD);
  }
  throw new Error(
    "No authentication configured. Set JIRA_PATS, JIRA_PAT, or both JIRA_USERNAME and JIRA_PASSWORD.",
  );
}

/**
 * Builds the AuthProvider for Confluence Data Center. Confluence-specific
 * credentials take precedence; if none are provided, the Jira credentials are
 * reused (common when Jira and Confluence share the same SSO / user store).
 */
export function createConfluenceAuthProvider(config: AppConfig): AuthProvider {
  const pat = config.CONFLUENCE_PAT ?? config.JIRA_PAT;
  const username = config.CONFLUENCE_USERNAME ?? config.JIRA_USERNAME;
  const password = config.CONFLUENCE_PASSWORD ?? config.JIRA_PASSWORD;

  if (pat) {
    return new PatAuthProvider(pat);
  }
  if (username && password) {
    return new BasicAuthProvider(username, password);
  }
  throw new Error(
    "No Confluence authentication configured. Set CONFLUENCE_PAT (or CONFLUENCE_USERNAME + CONFLUENCE_PASSWORD), or configure Jira credentials to be reused.",
  );
}
