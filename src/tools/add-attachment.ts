import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JiraClient } from "../jira-client.js";
import { jsonResult, errorResult } from "./tool-helpers.js";

const base64Schema = z.string().min(1).refine(
  (value) => value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
  "contentBase64 must be valid base64 with no data-URL prefix",
);

export function registerAddAttachmentTool(server: McpServer, client: JiraClient): void {
  server.registerTool(
    "add_attachment",
    {
      title: "Add Attachment",
      description: "Uploads a base64-encoded file to a Jira Cloud issue (POST /rest/api/3/issue/{key}/attachments).",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'NFS-1234'"),
        filename: z.string().min(1).refine(
          (value) => !/[\r\n]/.test(value),
          "filename must not contain line breaks",
        ).describe("Attachment filename"),
        mimeType: z.string().min(1).describe("MIME type, e.g. 'video/webm' or 'application/zip'"),
        contentBase64: base64Schema.describe("Base64-encoded file bytes"),
      },
    },
    async (input) => {
      try {
        const attachments = await client.addAttachment(input);
        return jsonResult(attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          size: attachment.size,
          mimeType: attachment.mimeType,
          created: attachment.created,
          author: attachment.author,
        })));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}