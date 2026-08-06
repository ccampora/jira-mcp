import { z } from "zod";

/**
 * Environment configuration schema.
 *
 * Authentication is either:
 *  - JIRA_PAT (Personal Access Token, preferred), or
 *  - JIRA_USERNAME + JIRA_PASSWORD (Basic auth)
 */
const envSchema = z
  .object({
    JIRA_BASE_URL: z
      .string()
      .min(1, "JIRA_BASE_URL is required")
      .url("JIRA_BASE_URL must be a valid URL, e.g. https://jira.company.com"),
    JIRA_PAT: z.string().min(1).optional(),
    JIRA_USERNAME: z.string().min(1).optional(),
    JIRA_PASSWORD: z.string().min(1).optional(),
    JIRA_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    JIRA_TLS_REJECT_UNAUTHORIZED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((data, ctx) => {
    const hasPat = !!data.JIRA_PAT;
    const hasBasic = !!data.JIRA_USERNAME && !!data.JIRA_PASSWORD;

    if (!hasPat && !hasBasic) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "No authentication configured. Set JIRA_PAT, or both JIRA_USERNAME and JIRA_PASSWORD.",
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
  // Normalize base URL (strip trailing slash) so path joins are predictable.
  parsed.data.JIRA_BASE_URL = parsed.data.JIRA_BASE_URL.replace(/\/+$/, "");
  return parsed.data;
}
