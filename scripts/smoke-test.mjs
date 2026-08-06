/**
 * Smoke test: spawns the built MCP server over stdio, lists all registered
 * tools, and (if Jira credentials are configured via .env / environment)
 * exercises three read-only tools against the real Jira instance:
 *   server_info -> get_current_user -> search_issues
 *
 * Usage:
 *   npm run build
 *   node scripts/smoke-test.mjs
 *
 * This does NOT create/modify any Jira data - it only calls read-only tools.
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, "..", "dist", "server.js");

function printResult(label, result) {
  const text = result?.content?.[0]?.text ?? JSON.stringify(result);
  console.log(`\n--- ${label} ${result?.isError ? "(ERROR)" : "(OK)"} ---`);
  console.log(text);
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ),
    },
  });

  const client = new Client({ name: "smoke-test-client", version: "1.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`Connected. Server exposes ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}`);
  }

  const hasCreds = !!process.env.JIRA_PAT || (!!process.env.JIRA_USERNAME && !!process.env.JIRA_PASSWORD);
  if (!hasCreds) {
    console.log(
      "\nNo JIRA_PAT / JIRA_USERNAME+JIRA_PASSWORD found in environment - skipping live API calls.",
    );
    console.log("Set up your .env and re-run to exercise server_info / get_current_user / search_issues.");
  } else {
    const serverInfo = await client.callTool({ name: "server_info", arguments: {} });
    printResult("server_info", serverInfo);

    const me = await client.callTool({ name: "get_current_user", arguments: {} });
    printResult("get_current_user", me);

    const search = await client.callTool({
      name: "search_issues",
      arguments: { jql: "order by created DESC", maxResults: 3 },
    });
    printResult("search_issues", search);
  }

  await client.close();
  console.log("\nSmoke test finished.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exitCode = 1;
});
