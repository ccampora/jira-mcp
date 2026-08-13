import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";
import { parseRequirementsNotes, type ParsedBacklogItem } from "./requirements-parser.js";

const backlogItemSchema = z.object({
  type: z.enum(["Story", "Task", "Bug"]).describe("Jira issue type to create"),
  summary: z.string().min(1).describe("Issue summary/title"),
  description: z.string().optional().describe("Issue description"),
  acceptanceCriteria: z
    .array(z.string())
    .optional()
    .describe("Optional list of acceptance criteria, appended to the description"),
});

function buildDescription(item: {
  description?: string;
  acceptanceCriteria?: string[];
}): string | undefined {
  const parts: string[] = [];
  if (item.description) parts.push(item.description);
  if (item.acceptanceCriteria?.length) {
    parts.push(
      "Acceptance Criteria:\n" + item.acceptanceCriteria.map((c) => `- ${c}`).join("\n"),
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function registerCreateJiraStoryFromRequirementsTool(
  server: McpServer,
  client: JiraClient,
): void {
  server.registerTool(
    "create_jira_story_from_requirements",
    {
      title: "Create Jira Backlog Items From Requirements",
      description:
        "Turns workshop notes or Fit/Gap analysis text into properly structured Jira Stories, Tasks, and Bugs, then creates them in the given project. " +
        "If `items` is provided, those pre-structured items are created as-is (recommended when the calling agent has already analyzed the notes). " +
        "Otherwise, `notes` is parsed heuristically: lines tagged 'Story:'/'Task:'/'Bug:', 'As a ... I want ... so that ...' phrasing (-> Story), " +
        "and bullet/numbered lines (-> Task) are detected automatically. Use dryRun to preview extracted items before creating anything in Jira.",
      inputSchema: {
        projectKey: z.string().min(1).describe("Target project key, e.g. 'ABC'"),
        notes: z
          .string()
          .optional()
          .default("")
          .describe("Raw workshop notes / Fit-Gap analysis text to auto-parse into backlog items"),
        items: z
          .array(backlogItemSchema)
          .optional()
          .describe("Optional pre-structured backlog items; overrides automatic parsing of `notes`"),
        dryRun: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, only return the parsed/would-create items without calling Jira"),
      },
    },
    async ({ projectKey, notes, items, dryRun }) => {
      try {
        const backlogItems: ParsedBacklogItem[] =
          items && items.length > 0 ? items : parseRequirementsNotes(notes ?? "");

        if (backlogItems.length === 0) {
          return errorResult(
            "No requirements could be extracted from the provided notes, and no `items` were supplied.",
          );
        }

        if (dryRun) {
          return jsonResult({ preview: backlogItems, totalParsed: backlogItems.length });
        }

        const results = await client.createIssuesBulk(
          backlogItems.map((item) => ({
            projectKey,
            issueType: item.type,
            summary: item.summary,
            description: buildDescription(item),
          })),
        );

        const created: Array<{ type: string; summary: string; key: string }> = [];
        const failed: Array<{ type: string; summary: string; error: string }> = [];

        results.forEach((result) => {
          const item = backlogItems[result.index];
          if (result.issue) {
            created.push({ type: item.type, summary: item.summary, key: result.issue.key });
          } else {
            failed.push({
              type: item.type,
              summary: item.summary,
              error: result.error ?? "Jira did not return a created issue",
            });
          }
        });

        return jsonResult({
          totalRequested: backlogItems.length,
          jiraRequestCount: Math.ceil(backlogItems.length / 50),
          createdCount: created.length,
          failedCount: failed.length,
          created,
          failed,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
