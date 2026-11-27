import type { AdfDocument, AdfNode, JiraRichText } from "./types.js";

export function textToAdf(text: string): AdfDocument {
  return {
    type: "doc",
    version: 1,
    content: text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

function nodeText(node: AdfNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") {
    return typeof node.attrs?.text === "string" ? node.attrs.text : "@mention";
  }
  if (node.type === "emoji") {
    return typeof node.attrs?.text === "string"
      ? node.attrs.text
      : typeof node.attrs?.shortName === "string" ? node.attrs.shortName : "";
  }
  if (node.type === "inlineCard" || node.type === "blockCard") {
    return typeof node.attrs?.url === "string" ? node.attrs.url : "";
  }
  const content = (node.content ?? []).map(nodeText);
  switch (node.type) {
    case "doc":
    case "bulletList":
    case "orderedList":
    case "blockquote":
    case "panel":
    case "table":
    case "tableCell":
    case "tableHeader":
    case "listItem":
      return content.join("\n");
    case "tableRow":
      return content.join("\t");
    default:
      return content.join("");
  }
}

export function richTextToString(value: JiraRichText | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : nodeText(value);
}
