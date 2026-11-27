import type { AppConfig } from "./config.js";

export interface AuthProvider {
  readonly scheme: "basic";
  getAuthHeader(): string;
  acquireAuth(): Promise<AuthLease>;
  getSensitiveValues(): readonly string[];
}

export interface AuthLease {
  readonly header: string;
  markRateLimited(retryAfterMs: number): void;
}

export class BasicAuthProvider implements AuthProvider {
  readonly scheme = "basic" as const;

  constructor(
    private readonly email: string,
    private readonly apiToken: string,
  ) {
    if (!email || !apiToken) {
      throw new Error("BasicAuthProvider requires both an email and API token");
    }
  }

  getAuthHeader(): string {
    const encoded = Buffer.from(`${this.email}:${this.apiToken}`, "utf-8").toString("base64");
    return `Basic ${encoded}`;
  }

  async acquireAuth(): Promise<AuthLease> {
    return { header: this.getAuthHeader(), markRateLimited: () => undefined };
  }

  getSensitiveValues(): readonly string[] {
    const encoded = Buffer.from(`${this.email}:${this.apiToken}`, "utf-8").toString("base64");
    return [this.email, this.apiToken, encoded, `Basic ${encoded}`];
  }
}

export function createAuthProvider(config: AppConfig): AuthProvider {
  return new BasicAuthProvider(config.JIRA_CLOUD_EMAIL, config.JIRA_CLOUD_API_TOKEN);
}

export function createConfluenceAuthProvider(config: AppConfig): AuthProvider {
  if (config.CONFLUENCE_CLOUD_EMAIL && config.CONFLUENCE_CLOUD_API_TOKEN) {
    return new BasicAuthProvider(config.CONFLUENCE_CLOUD_EMAIL, config.CONFLUENCE_CLOUD_API_TOKEN);
  }
  throw new Error("Confluence Cloud requires CONFLUENCE_CLOUD_EMAIL and CONFLUENCE_CLOUD_API_TOKEN.");
}
