import { z } from "zod";

const envSchema = z.object({
  JIRA_DEPLOYMENT: z.literal("cloud").default("cloud"),
  JIRA_BASE_URL: z.string().url("JIRA_BASE_URL must be a valid URL"),
  JIRA_CLOUD_EMAIL: z.string({
    required_error: "JIRA_CLOUD_EMAIL is required",
  }).email("JIRA_CLOUD_EMAIL must be a valid email address"),
  JIRA_CLOUD_API_TOKEN: z.string({
    required_error: "JIRA_CLOUD_API_TOKEN is required",
  }).trim().min(1, "JIRA_CLOUD_API_TOKEN must not be empty"),
  JIRA_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  JIRA_TLS_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true")
    .transform((value) => value === "true"),
  CONFLUENCE_DEPLOYMENT: z.literal("cloud").default("cloud"),
  CONFLUENCE_BASE_URL: z.string().url("CONFLUENCE_BASE_URL must be a valid URL").optional(),
  CONFLUENCE_CLOUD_EMAIL: z.string().email("CONFLUENCE_CLOUD_EMAIL must be a valid email address").optional(),
  CONFLUENCE_CLOUD_API_TOKEN: z.string().trim().min(1, "CONFLUENCE_CLOUD_API_TOKEN must not be empty").optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((data, ctx) => {
  if (URL.canParse(data.JIRA_BASE_URL) && new URL(data.JIRA_BASE_URL).protocol !== "https:") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JIRA_BASE_URL"],
      message: "JIRA_BASE_URL must use HTTPS for Jira Cloud.",
    });
  }
  if (!data.JIRA_TLS_REJECT_UNAUTHORIZED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JIRA_TLS_REJECT_UNAUTHORIZED"],
      message: "JIRA_TLS_REJECT_UNAUTHORIZED must be true for Jira and Confluence Cloud.",
    });
  }
  const confluenceConfigured = data.CONFLUENCE_BASE_URL !== undefined
    || data.CONFLUENCE_CLOUD_EMAIL !== undefined
    || data.CONFLUENCE_CLOUD_API_TOKEN !== undefined;
  if (confluenceConfigured) {
    for (const field of [
      "CONFLUENCE_BASE_URL", "CONFLUENCE_CLOUD_EMAIL", "CONFLUENCE_CLOUD_API_TOKEN",
    ] as const) {
      if (!data[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required for Confluence Cloud.`,
        });
      }
    }
  }
  if (data.CONFLUENCE_BASE_URL && URL.canParse(data.CONFLUENCE_BASE_URL)) {
    const url = new URL(data.CONFLUENCE_BASE_URL);
    if (url.protocol !== "https:" || !url.pathname.replace(/\/+$/, "").endsWith("/wiki")
      || url.search || url.hash || url.username || url.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONFLUENCE_BASE_URL"],
        message: "Confluence Cloud requires an HTTPS base URL ending in /wiki, without query, fragment, or embedded credentials.",
      });
    }
  }
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const legacyFields = [
    "JIRA_PATS", "JIRA_PAT", "JIRA_USERNAME", "JIRA_PASSWORD",
    "CONFLUENCE_PAT", "CONFLUENCE_USERNAME", "CONFLUENCE_PASSWORD",
  ].filter((field) => env[field] !== undefined);
  if (legacyFields.length) {
    throw new Error(
      `Data Center authentication is no longer supported. Remove ${legacyFields.join(", ")} and configure Cloud email/API-token credentials.`,
    );
  }
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(config)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Jira MCP server configuration:\n${details}`);
  }
  parsed.data.JIRA_BASE_URL = parsed.data.JIRA_BASE_URL.replace(/\/+$/, "");
  if (parsed.data.CONFLUENCE_BASE_URL) {
    parsed.data.CONFLUENCE_BASE_URL = parsed.data.CONFLUENCE_BASE_URL.replace(/\/+$/, "");
  }
  return parsed.data;
}

export function isConfluenceEnabled(config: AppConfig): boolean {
  return !!config.CONFLUENCE_BASE_URL;
}
