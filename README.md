# Jira Data Center MCP Server

A production-ready [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an on-premises **Jira Data Center** instance to MCP-compatible clients such as GitHub Copilot Agent mode, Claude Desktop, or any other MCP host.

Built with TypeScript, the official `@modelcontextprotocol/sdk`, Axios, and Zod.

## Features

- 🔐 **Pluggable authentication**: Personal Access Token (preferred) or Basic auth (username/password), selected automatically from environment variables via an `AuthProvider` abstraction.
- 🧰 **15 Jira MCP tools** covering issue search, retrieval, creation, comments, workflow transitions, project listing, issue linking, and remote links (linked Confluence pages).
- 📚 **Optional Confluence Data Center / Server support**: when `CONFLUENCE_BASE_URL` is set, 8 additional tools for spaces, CQL search, page retrieval, comments, and page creation/update are registered. Confluence reuses the Jira credentials unless Confluence-specific ones are provided.
- 🧠 **`create_jira_story_from_requirements`**: turns raw workshop notes / Fit-Gap analysis text into structured Jira Stories, Tasks, and Bugs — ideal for going straight from meeting notes to a Jira backlog.
- ✅ Zod-validated tool inputs, typed Jira REST responses, and normalized error handling.
- 📝 Leveled logging to `stderr` (safe for the stdio MCP transport).

## Project Structure

```
/src
  server.ts                          # Entry point: wires config, auth, client, tools, and stdio transport
  jira-client.ts                     # Axios-based Jira REST API v2 client + error normalization
  auth.ts                            # AuthProvider abstraction (PAT / Basic)
  config.ts                          # Env var loading & validation (Zod)
  logger.ts                          # Leveled stderr logger
  types.ts                           # Jira REST API response shapes
  confluence-client.ts               # Axios-based Confluence REST client + error normalization
  confluence-types.ts                # Confluence REST API response shapes
  tools/
    tool-helpers.ts                  # Shared CallToolResult helpers
    get-current-user.ts
    server-info.ts
    search-issues.ts
    get-issue.ts
    create-issue.ts
    add-comment.ts
    transition-issue.ts
    get-projects.ts
    get-transitions.ts               # bonus
    get-issue-comments.ts            # bonus
    get-issue-remote-links.ts        # bonus: linked Confluence pages / web links
    get-issue-link-types.ts          # bonus: available inward/outward link types
    create-issue-link.ts             # bonus: links two existing Jira issues
    execute-jql.ts                   # bonus
    create-story-from-requirements.ts# bonus: notes -> Jira backlog
    requirements-parser.ts           # heuristic notes parser used above
    index.ts                        # registers all tools
    confluence/                      # Confluence tools (registered only when enabled)
      get-current-user.ts
      get-spaces.ts
      search.ts
      get-page.ts
      get-page-by-title.ts
      get-page-comments.ts
      create-page.ts
      update-page.ts
      index.ts
```

## Prerequisites

- Node.js >= 18
- A Jira Data Center instance reachable from this machine, with either:
  - a **Personal Access Token** (Jira DC 8.14+, `Profile > Personal Access Tokens`), or
  - a valid **username + password**

## Setup

```bash
npm install
cp .env.example .env   # then edit .env with your Jira URL + credentials
npm run build
npm start
```

For local iteration without a build step:

```bash
npm run dev
```

## Environment Variables

| Variable                        | Required            | Description                                                   |
| -------------------------------- | -------------------- | -------------------------------------------------------------- |
| `JIRA_BASE_URL`                  | Yes                  | Base URL of your Jira Data Center instance, e.g. `https://jira.company.com` |
| `JIRA_PAT`                       | One of PAT/Basic     | Personal Access Token (preferred auth method)                 |
| `JIRA_USERNAME`                  | One of PAT/Basic     | Username for Basic auth (requires `JIRA_PASSWORD`)             |
| `JIRA_PASSWORD`                  | One of PAT/Basic     | Password for Basic auth (requires `JIRA_USERNAME`)              |
| `JIRA_TIMEOUT_MS`                | No (default `15000`) | HTTP request timeout in milliseconds (shared with Confluence)  |
| `JIRA_TLS_REJECT_UNAUTHORIZED`   | No (default `true`)  | Set to `false` only for internal CAs without a valid chain (shared with Confluence) |
| `CONFLUENCE_BASE_URL`            | No                   | Base URL of your Confluence Data Center instance, e.g. `https://confluence.company.com`. Enables the Confluence tools when set. |
| `CONFLUENCE_PAT`                 | No                   | Confluence Personal Access Token. Falls back to `JIRA_PAT` if omitted. |
| `CONFLUENCE_USERNAME`            | No                   | Username for Confluence Basic auth (requires `CONFLUENCE_PASSWORD`). Falls back to `JIRA_USERNAME`. |
| `CONFLUENCE_PASSWORD`            | No                   | Password for Confluence Basic auth (requires `CONFLUENCE_USERNAME`). Falls back to `JIRA_PASSWORD`. |
| `LOG_LEVEL`                      | No (default `info`)  | `debug` \| `info` \| `warn` \| `error`                          |

If `JIRA_PAT` is set it takes precedence; otherwise both `JIRA_USERNAME` and `JIRA_PASSWORD` must be set. The server refuses to start if neither is configured.

**Confluence** is optional: set `CONFLUENCE_BASE_URL` to register the Confluence tools. If you don't set Confluence-specific credentials, the Jira PAT (or username/password) is reused — handy when both apps share the same SSO / user directory.

## MCP Tools

| Tool | REST Call | Description |
| --- | --- | --- |
| `get_current_user` | `GET /rest/api/2/myself` | username, displayName, email, groups |
| `server_info` | `GET /rest/api/2/serverInfo` | Jira version, deployment type, build number |
| `search_issues` | `GET /rest/api/2/search` | Runs JQL, returns key/summary/status/assignee/reporter/created/updated |
| `get_issue` | `GET /rest/api/2/issue/{key}` | Full issue details incl. comments, labels, assignee |
| `create_issue` | `POST /rest/api/2/issue` | Creates an issue, returns its key |
| `add_comment` | `POST /rest/api/2/issue/{key}/comment` | Adds a comment |
| `transition_issue` | `POST /rest/api/2/issue/{key}/transitions` | Moves an issue through its workflow |
| `get_projects` | `GET /rest/api/2/project` | Lists visible projects |
| `get_transitions` *(bonus)* | `GET /rest/api/2/issue/{key}/transitions` | Lists valid transitions for an issue |
| `get_issue_comments` *(bonus)* | `GET /rest/api/2/issue/{key}/comment` | Lists all comments on an issue |
| `get_issue_remote_links` *(bonus)* | `GET /rest/api/2/issue/{key}/remotelink` | Lists an issue's remote links, including linked Confluence pages |
| `get_issue_link_types` *(bonus)* | `GET /rest/api/2/issueLinkType` | Lists valid issue link types and their inward/outward wording |
| `create_issue_link` *(bonus)* | `POST /rest/api/2/issueLink` | Links two existing issues, with an optional comment |
| `execute_jql` *(bonus)* | `GET /rest/api/2/search` | Arbitrary JQL with a configurable field set |
| `create_jira_story_from_requirements` *(bonus)* | `POST /rest/api/2/issue` (looped) | Parses workshop notes / Fit-Gap text into Stories/Tasks/Bugs and bulk-creates them |

### Confluence Tools (enabled when `CONFLUENCE_BASE_URL` is set)

| Tool | REST Call | Description |
| --- | --- | --- |
| `confluence_get_current_user` | `GET /rest/api/user/current` | Current Confluence user (username, key, displayName) |
| `confluence_get_spaces` | `GET /rest/api/space` | Lists visible spaces |
| `confluence_search` | `GET /rest/api/content/search` | Runs a CQL query, returns matching content |
| `confluence_get_page` | `GET /rest/api/content/{id}` | Full page by ID. `format: "storage"` (raw source, default) or `"view"` (server-rendered HTML with macros resolved) |
| `confluence_get_page_by_title` | `GET /rest/api/content?spaceKey=&title=` | Finds a page by exact title within a space |
| `confluence_get_page_comments` | `GET /rest/api/content/{id}/child/comment` | Lists comments on a page |
| `confluence_create_page` | `POST /rest/api/content` | Creates a page from Confluence storage-format XHTML, optionally under a parent page |
| `confluence_update_page` | `PUT /rest/api/content/{id}` | Replaces a page title and full storage-format XHTML body using a new version number |

Confluence page bodies use storage-format XHTML, not Markdown. Before calling `confluence_update_page`, fetch the page with `confluence_get_page`, then pass `versionNumber` as the current `version.number + 1`; updates replace the complete body.

### Accessing Confluence pages linked from a Jira issue

Linked Confluence pages are **not** part of an issue's fields — Jira Data Center stores them as **remote links**. To go from an issue to its Confluence content:

1. Call `get_issue_remote_links` with the issue key to list linked pages. Each entry's `url` looks like `.../pages/viewpage.action?pageId=<ID>`.
2. Extract the numeric `pageId` from that URL.
3. Call `confluence_get_page` with that `pageId` and `format: "view"` for readable content (or `"storage"` for the raw source).

Alternatively, run `confluence_search` with a CQL query like `text ~ "<ISSUE-KEY>"` to find any page that mentions the issue. The `get_issue` tool also returns a `confluenceAccess` hint pointing agents at this workflow.

### `create_jira_story_from_requirements` details

Two ways to use it:

1. **Automatic parsing** — pass raw `notes` text. The built-in heuristic parser detects:
   - Explicit tags: lines starting with `Story:`, `Task:`, or `Bug:`
   - User-story phrasing: `As a <role>, I want <goal> so that <benefit>` → Story
   - Bullet / numbered list lines → Task
   - Falls back to a single Task if nothing else matches, so non-empty notes always produce at least one item.
2. **Pre-structured input** — pass an `items` array (`{ type, summary, description?, acceptanceCriteria? }`) when the calling agent has already analyzed the notes itself. `items` always takes precedence over `notes`.

Set `dryRun: true` to preview the parsed/would-create items without touching Jira — recommended before bulk-creating from a large set of notes.

Issue creation is done per-item with `Promise.allSettled`, so partial failures (e.g. one bad issue type) don't block the rest; the response reports `created` and `failed` separately.

## VS Code MCP Configuration

Add to your VS Code MCP configuration (e.g. `.vscode/mcp.json` in a workspace, or the user-level MCP settings):

```json
{
  "servers": {
    "jira-datacenter": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/server.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.company.com",
        "JIRA_PAT": "${input:jiraPat}"
      }
    }
  },
  "inputs": [
    {
      "id": "jiraPat",
      "type": "promptString",
      "description": "Jira Personal Access Token",
      "password": true
    }
  ]
}
```

Alternatively, point `command` at your global install (`jira-mcp-server`) if you `npm link` or `npm install -g` this package, or simply rely on a `.env` file next to `dist/server.js` and omit `env` entirely.

## Example Prompts

Once connected in Copilot Agent mode:

- *"Use server_info to confirm we're talking to the right Jira instance, then get_current_user to confirm my identity."*
- *"Search for all open bugs in project ABC assigned to me using search_issues."*
- *"Get the full details of ABC-123, including its comments."*
- *"Create a Task in project ABC titled 'Configure SSO for staging' with a short description."*
- *"Add a comment to ABC-123 saying the fix has been deployed to staging."*
- *"Show me the available transitions for ABC-123, then transition it to Done."*
- *"List the Jira issue link types, then link ABC-123 as blocking ABC-456."*
- *"List all projects I have access to."*
- *"Run this JQL and show me just the priority and fixVersions fields: project = ABC AND status = 'In Progress'."*
- *"Here are my Fit/Gap workshop notes: [paste notes]. Preview the Jira Stories/Tasks/Bugs you'd create in project ABC with dryRun, then create them for real."*
- *"Fetch Confluence page 12345, then update it with this full storage-format XHTML body using the next version number."*

## Error Handling

All Jira REST errors (4xx/5xx, network failures) are caught in `jira-client.ts`, mapped to a `JiraApiError` carrying the HTTP status code and Jira's own `errorMessages`/`errors` payload, and surfaced to the MCP client as a tool error result (`isError: true`) with a human-readable message — never a raw stack trace.

## Security Notes

- Credentials are only ever read from environment variables — never hardcoded or logged.
- Prefer a Personal Access Token over Basic auth; PATs can be scoped and revoked independently of your account password.
- Set `JIRA_TLS_REJECT_UNAUTHORIZED=false` only as a last resort for internal CAs; prefer installing your corporate CA certificate via `NODE_EXTRA_CA_CERTS` instead.
- This server only implements the **stdio** MCP transport (no HTTP listener), so it is not network-exposed by itself.
- Run `npm audit` periodically — the MCP SDK's optional HTTP transport dependencies (`hono`, `ajv`/`fast-uri`) are not exercised by this server (stdio-only) but should still be kept current when upstream patches become available.

## License

MIT
