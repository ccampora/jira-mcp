/**
 * Generic ad-hoc tool invoker: spawns the built MCP server over stdio and
 * calls a single named tool with the given JSON arguments, printing the
 * result. Useful for manual verification during development.
 *
 * Usage:
 *   node scripts/call-tool.mjs <toolName> '<jsonArgs>'
 *   (Windows/PowerShell strips quotes from inline JSON args, so you can
 *   alternatively set TOOL_ARGS_JSON as an env var instead of arg 2.)
 *
 * Example:
 *   node scripts/call-tool.mjs get_issue '{"issueKey":"NFS-7848"}'
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, "..", "dist", "server.js");

const [toolName, argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error("Usage: node scripts/call-tool.mjs <toolName> '<jsonArgs>'");
  process.exit(1);
}
const rawArgs = process.env.TOOL_ARGS_JSON ?? argsJson;
const toolArgs = rawArgs ? JSON.parse(rawArgs) : {};

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
  });
  const client = new Client({ name: "call-tool-script", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.callTool({ name: toolName, arguments: toolArgs });
  const text = result?.content?.[0]?.text ?? JSON.stringify(result);
  console.log(`\n--- ${toolName} ${result?.isError ? "(ERROR)" : "(OK)"} ---`);
  console.log(text);

  await client.close();
}

main().catch((err) => {
  console.error("Tool call failed:", err);
  process.exitCode = 1;
});
