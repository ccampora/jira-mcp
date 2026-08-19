import { z } from "zod";

const jiraPatsSchema = z.string().optional().transform((raw, ctx) => {
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "JIRA_PATS must be a valid JSON array of PAT strings.",
    });
    return z.NEVER;
  }

  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "JIRA_PATS must be a JSON array containing only strings.",
    });
    return z.NEVER;
  }

  const pats = parsed.map((value) => value.trim()).filter(Boolean);
  if (pats.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "JIRA_PATS must contain at least one non-empty PAT.",
    });
    return z.NEVER;
  }
  return pats;
});

/**
 * Environment configuration schema.
 *
 * Jira authentication is either:
 *  - JIRA_PATS or JIRA_PAT (Personal Access Token, preferred), or
 *  - JIRA_USERNAME + JIRA_PASSWORD (Basic auth)
 *
 * Confluence (Data Center / Server) support is OPTIONAL and only enabled when
 * CONFLUENCE_BASE_URL is set. Confluence-specific credentials are optional; if
 * omitted, the Jira credentials are reused (common when Jira and Confluence
 * share the same SSO / user directory).
 */
const envSchema = z
  .object({
    JIRA_BASE_URL: z
      .string()
      .min(1, "JIRA_BASE_URL is required")
      .url("JIRA_BASE_URL must be a valid URL, e.g. https://jira.company.com"),
    JIRA_PATS: jiraPatsSchema,
    JIRA_PAT: z.string().trim().min(1).optional(),
    JIRA_USERNAME: z.string().min(1).optional(),
    JIRA_PASSWORD: z.string().min(1).optional(),
    JIRA_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    JIRA_TLS_REJECT_UNAUTHORIZED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    // --- Confluence Data Center / Server (optional) ---
    CONFLUENCE_BASE_URL: z
      .string()
      .url("CONFLUENCE_BASE_URL must be a valid URL, e.g. https://confluence.company.com")
      .optional(),
    CONFLUENCE_PAT: z.string().min(1).optional(),
    CONFLUENCE_USERNAME: z.string().min(1).optional(),
    CONFLUENCE_PASSWORD: z.string().min(1).optional(),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((data, ctx) => {
    const hasPat = !!data.JIRA_PATS?.length || !!data.JIRA_PAT;
    const hasBasic = !!data.JIRA_USERNAME && !!data.JIRA_PASSWORD;

    if (!hasPat && !hasBasic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "No authentication configured. Set JIRA_PATS, JIRA_PAT, or both JIRA_USERNAME and JIRA_PASSWORD.",
      });
    }

    if (data.JIRA_USERNAME && !data.JIRA_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "JIRA_USERNAME is set but JIRA_PASSWORD is missing.",
      });
    }

    if (!data.JIRA_USERNAME && data.JIRA_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "JIRA_PASSWORD is set but JIRA_USERNAME is missing.",
      });
    }

    if (data.CONFLUENCE_USERNAME && !data.CONFLUENCE_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CONFLUENCE_USERNAME is set but CONFLUENCE_PASSWORD is missing.",
      });
    }

    if (!data.CONFLUENCE_USERNAME && data.CONFLUENCE_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CONFLUENCE_PASSWORD is set but CONFLUENCE_USERNAME is missing.",
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(config)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Jira MCP server configuration:\n${details}`);
  }
  // Normalize base URLs (strip trailing slash) so path joins are predictable.
  parsed.data.JIRA_BASE_URL = parsed.data.JIRA_BASE_URL.replace(/\/+$/, "");
  if (parsed.data.CONFLUENCE_BASE_URL) {
    parsed.data.CONFLUENCE_BASE_URL = parsed.data.CONFLUENCE_BASE_URL.replace(/\/+$/, "");
  }
  return parsed.data;
}

/**
 * Confluence tools are only registered when a Confluence base URL is
 * configured. This lets the server run in Jira-only mode unchanged.
 */
export function isConfluenceEnabled(config: AppConfig): boolean {
  return !!config.CONFLUENCE_BASE_URL;
}
