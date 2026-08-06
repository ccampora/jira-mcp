/**
 * Lightweight heuristic parser that turns free-form workshop notes / Fit-Gap
 * analysis text into structured Jira backlog items (Story / Task / Bug).
 *
 * This is intentionally rule-based (no external LLM call) so the MCP server
 * has no extra runtime dependencies or secrets beyond the Jira connection.
 * When the calling agent (e.g. GitHub Copilot) has already done the analysis,
 * it should pass structured `items` directly to the `create_jira_story_from_requirements`
 * tool instead of relying on this parser.
 *
 * Recognized patterns, in priority order:
 *   1. Explicit tags at the start of a paragraph: "Story:", "Task:", "Bug:"
 *      (case-insensitive), optionally followed by "-" or ":" separators.
 *   2. Classic user-story phrasing: "As a <role>, I want <goal> so that <benefit>"
 *      -> treated as a Story.
 *   3. Bullet / numbered list lines ("-", "*", "1.") not matching the above
 *      -> treated as a Task.
 *   4. If nothing matches, the entire notes block becomes a single Task so the
 *      tool never silently produces zero issues from non-empty input.
 */

export type BacklogItemType = "Story" | "Task" | "Bug";

export interface ParsedBacklogItem {
  type: BacklogItemType;
  summary: string;
  description?: string;
}

const TAG_PATTERN = /^\s*(story|task|bug)\s*[:\-]\s*(.+)$/i;
const USER_STORY_PATTERN = /^\s*as an?\s+.+?,?\s+i\s+want\s+.+/i;
const BULLET_PATTERN = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;

const MAX_SUMMARY_LENGTH = 240;

function splitIntoBlocks(notes: string): string[] {
  return notes
    .split(/\r?\n\s*\r?\n/) // blank-line separated paragraphs
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function truncateSummary(text: string): { summary: string; overflow?: string } {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= MAX_SUMMARY_LENGTH) {
    return { summary: singleLine };
  }
  return {
    summary: `${singleLine.slice(0, MAX_SUMMARY_LENGTH - 1)}…`,
    overflow: singleLine,
  };
}

function parseBlock(block: string): ParsedBacklogItem[] {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const [firstLine, ...rest] = lines;

  const tagMatch = firstLine.match(TAG_PATTERN);
  if (tagMatch) {
    const type = (tagMatch[1][0].toUpperCase() + tagMatch[1].slice(1).toLowerCase()) as BacklogItemType;
    const { summary, overflow } = truncateSummary(tagMatch[2]);
    const descriptionLines = overflow ? [overflow, ...rest] : rest;
    return [
      {
        type,
        summary,
        description: descriptionLines.join("\n") || undefined,
      },
    ];
  }

  if (USER_STORY_PATTERN.test(firstLine)) {
    const { summary, overflow } = truncateSummary(firstLine);
    return [
      {
        type: "Story",
        summary,
        description: overflow ? overflow : rest.join("\n") || undefined,
      },
    ];
  }

  // Multiple bullet lines within a block each become their own Task.
  const bulletItems: ParsedBacklogItem[] = [];
  for (const line of lines) {
    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch) {
      const { summary, overflow } = truncateSummary(bulletMatch[1]);
      bulletItems.push({ type: "Task", summary, description: overflow });
    }
  }
  if (bulletItems.length > 0) {
    return bulletItems;
  }

  // Fallback: whole block becomes a single Task, first line as summary.
  const { summary, overflow } = truncateSummary(firstLine);
  const description = [overflow, ...rest].filter(Boolean).join("\n") || undefined;
  return [{ type: "Task", summary, description }];
}

export function parseRequirementsNotes(notes: string): ParsedBacklogItem[] {
  const trimmed = notes.trim();
  if (!trimmed) return [];

  const blocks = splitIntoBlocks(trimmed);
  if (blocks.length === 0) {
    return [{ type: "Task", summary: truncateSummary(trimmed).summary, description: trimmed }];
  }

  const items = blocks.flatMap(parseBlock);
  return items.length > 0
    ? items
    : [{ type: "Task", summary: "Requirements from workshop notes", description: trimmed }];
}
