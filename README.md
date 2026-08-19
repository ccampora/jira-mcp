# Jira Data Center MCP Server

A production-ready [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an on-premises **Jira Data Center** instance to MCP-compatible clients such as GitHub Copilot Agent mode, Claude Desktop, or any other MCP host.

Built with TypeScript, the official `@modelcontextprotocol/sdk`, Axios, and Zod.

## Features

- 🔐 **Pluggable authentication**: round-robin Personal Access Token rotation, a single PAT fallback, or Basic auth, selected automatically from environment variables via an `AuthProvider` abstraction.
- 🧰 **19 Jira MCP tools** covering issue search, bulk retrieval, creation, combined updates, comments, labels, workflow transitions, project listing, issue linking, and remote links (linked Confluence pages).
- 📚 **Optional Confluence Data Center / Server support**: when `CONFLUENCE_BASE_URL` is set, 8 additional tools for spaces, CQL search, page retrieval, comments, and page creation/update are registered. Confluence uses its own credentials or falls back to the legacy single Jira credential; it never uses the rotating PAT pool.
- 🧠 **`create_jira_story_from_requirements`**: turns raw workshop notes / Fit-Gap analysis text into structured Jira Stories, Tasks, and Bugs — ideal for going straight from meeting notes to a Jira backlog.
- ✅ Zod-validated tool inputs, typed Jira REST responses, and normalized error handling.
- 📝 Leveled logging to `stderr` (safe for the stdio MCP transport).
- 🌐 Optional Streamable HTTP transport for standalone container deployments.

## Project Structure

```
/src
  server.ts                          # Entry point: wires config, auth, client, tools, and stdio transport
  jira-client.ts                     # Axios-based Jira REST API v2 client + error normalization
  auth.ts                            # AuthProvider abstraction, PAT rotation, and cooldown state
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
  - one or more **Personal Access Tokens** (Jira DC 8.14+, `Profile > Personal Access Tokens`), or
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
| `JIRA_PATS`                      | One of PAT/Basic     | JSON array of PAT strings. Requests use round-robin selection with independent 429 cooldowns. |
| `JIRA_PAT`                       | One of PAT/Basic     | Single Personal Access Token used when `JIRA_PATS` is omitted. |
| `JIRA_USERNAME`                  | One of PAT/Basic     | Username for Basic auth (requires `JIRA_PASSWORD`)             |
| `JIRA_PASSWORD`                  | One of PAT/Basic     | Password for Basic auth (requires `JIRA_USERNAME`)              |
| `JIRA_TIMEOUT_MS`                | No (default `15000`) | HTTP request timeout in milliseconds (shared with Confluence)  |
| `JIRA_TLS_REJECT_UNAUTHORIZED`   | No (default `true`)  | Set to `false` only for internal CAs without a valid chain (shared with Confluence) |
| `CONFLUENCE_BASE_URL`            | No                   | Base URL of your Confluence Data Center instance, e.g. `https://confluence.company.com`. Enables the Confluence tools when set. |
| `CONFLUENCE_PAT`                 | No                   | Confluence Personal Access Token. Falls back to `JIRA_PAT` if omitted. |
| `CONFLUENCE_USERNAME`            | No                   | Username for Confluence Basic auth (requires `CONFLUENCE_PASSWORD`). Falls back to `JIRA_USERNAME`. |
| `CONFLUENCE_PASSWORD`            | No                   | Password for Confluence Basic auth (requires `CONFLUENCE_USERNAME`). Falls back to `JIRA_PASSWORD`. |
| `LOG_LEVEL`                      | No (default `info`)  | `debug` \| `info` \| `warn` \| `error`                          |
| `MCP_TRANSPORT`                  | No (default `stdio`) | Set to `http` to expose the Streamable HTTP endpoint at `/mcp`  |
| `PORT`                           | No (default `8787`)  | Listen port when `MCP_TRANSPORT=http`                            |

`JIRA_PATS` takes precedence over the backward-compatible `JIRA_PAT`; otherwise both `JIRA_USERNAME` and `JIRA_PASSWORD` must be set. `JIRA_PATS` must be a valid JSON array containing at least one non-empty string. The server refuses to start without valid authentication.

When Jira responds with HTTP 429, only the PAT used for that request enters cooldown. The server honors `Retry-After`, immediately tries another available PAT, and waits for the earliest cooldown only when all PATs are cooling down. Rate-limit retries are bounded. Existing behavior for network and 5xx failures is unchanged.

**Confluence** is optional: set `CONFLUENCE_BASE_URL` to register the Confluence tools. It does not use the rotating `JIRA_PATS` pool. Configure `CONFLUENCE_PAT` explicitly, or omit it to reuse only the legacy single `JIRA_PAT` (or Jira username/password).

## HTTP Transport

The default transport remains stdio, so `node dist/server.js` and existing MCP host configurations continue to work unchanged. To run as a standalone Streamable HTTP service, set:

```bash
MCP_TRANSPORT=http PORT=8787 node dist/server.js
```

The MCP endpoint is `http://localhost:8787/mcp`. Container health probes can use `GET http://localhost:8787/healthz`, which returns `200 {"status":"ok"}` without contacting Jira.

For shared deployments, callers can override the Jira connection on every request with these headers:

| Header | Description |
| --- | --- |
| `X-Jira-Base-Url` | Jira Data Center base URL; falls back to `JIRA_BASE_URL` |
| `X-Jira-Pat` | Jira Personal Access Token; falls back to `JIRA_PAT` |

Both headers must be sent on each MCP HTTP request when environment fallbacks are not configured. Treat `X-Jira-Pat` as a secret and terminate TLS before the container endpoint. HTTP mode can start without Jira environment credentials so health probes remain available; an MCP request without valid header or environment credentials receives a configuration error.

Example initialization request:

```bash
curl http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Jira-Base-Url: https://jira.company.com" \
  -H "X-Jira-Pat: $JIRA_PAT" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

## MCP Tools

| Tool | REST Call | Description |
| --- | --- | --- |
| `get_current_user` | `GET /rest/api/2/myself` | username, displayName, email, groups |
| `server_info` | `GET /rest/api/2/serverInfo` | Jira version, deployment type, build number |
| `search_issues` | `GET /rest/api/2/search` | Runs JQL, returns key/summary/status/assignee/reporter/created/updated |
| `get_issue` | `GET /rest/api/2/issue/{key}` | Full issue details incl. comments, labels, assignee |
| `get_issues_bulk` | `POST /rest/api/2/search` | Retrieves up to 1000 issue keys in one request with configurable fields |
| `create_issue` | `POST /rest/api/2/issue` | Creates an issue with optional labels and option-backed custom fields, then returns its key |
| `create_issues_bulk` | `POST /rest/api/2/issue/bulk` | Creates issues with optional option-backed custom fields in native Jira batches of up to 50 |
| `add_comment` | `POST /rest/api/2/issue/{key}/comment` | Adds a comment |
| `add_issue_labels` | `PUT /rest/api/2/issue/{key}` | Adds labels without removing existing labels |
| `update_issue` | `PUT /rest/api/2/issue/{key}` | Updates fields, labels, and option-backed custom fields in one request |
| `update_issues_bulk` | `PUT /rest/api/2/issue/{key}` (parallel) | Combines fields, labels, and option-backed custom fields into one request per issue, with concurrency limited to 5 |
| `transition_issue` | `POST /rest/api/2/issue/{key}/transitions` | Moves an issue through its workflow |
| `get_projects` | `GET /rest/api/2/project` | Lists visible projects |
| `get_transitions` *(bonus)* | `GET /rest/api/2/issue/{key}/transitions` | Lists valid transitions for an issue |
| `get_issue_comments` *(bonus)* | `GET /rest/api/2/issue/{key}/comment` | Lists all comments on an issue |
| `get_issue_remote_links` *(bonus)* | `GET /rest/api/2/issue/{key}/remotelink` | Lists an issue's remote links, including linked Confluence pages |
| `get_issue_link_types` *(bonus)* | `GET /rest/api/2/issueLinkType` | Lists valid issue link types and their inward/outward wording |
| `create_issue_link` *(bonus)* | `POST /rest/api/2/issueLink` | Links two existing issues, with an optional comment |
| `execute_jql` *(bonus)* | `GET /rest/api/2/search` | Arbitrary JQL with a configurable field set |
| `create_jira_story_from_requirements` *(bonus)* | `POST /rest/api/2/issue/bulk` | Parses workshop notes / Fit-Gap text and creates issues in batches of up to 50 |

Jira Data Center REST v2 has native bulk creation and bulk search, but no public bulk-update endpoint. `update_issues_bulk` therefore reduces MCP round trips and combines multiple changes to each issue, while Jira still receives one `PUT` request per issue.

### Option-backed custom fields

The `create_issue`, `create_issues_bulk`, `update_issue`, and `update_issues_bulk` tools accept `customFieldOptions`. This lets callers provide deployment-specific Jira custom field keys and option IDs at call time instead of hardcoding them in the server. Each field key must use Jira's `customfield_<number>` format.

For example, create a Test issue whose required `customfield_12402` option is `22300`:

```json
{
  "projectKey": "NFS",
  "issueType": "Test",
  "summary": "Test summary",
  "customFieldOptions": [
    {
      "fieldKey": "customfield_12402",
      "optionId": "22300"
    }
  ]
}
```

For bulk creation, include `customFieldOptions` on each issue that needs them:

```json
{
  "issues": [
    {
      "projectKey": "NFS",
      "issueType": "Test",
      "summary": "First test",
      "customFieldOptions": [
        {
          "fieldKey": "customfield_12402",
          "optionId": "22300"
        }
      ]
    }
  ]
}
```

The same structure can update an existing issue:

```json
{
  "issueKey": "NFS-123",
  "customFieldOptions": [
    {
      "fieldKey": "customfield_12402",
      "optionId": "22300"
    }
  ]
}
```

For `update_issues_bulk`, include that structure on each item in `updates`:

```json
{
  "updates": [
    {
      "issueKey": "NFS-123",
      "customFieldOptions": [
        {
          "fieldKey": "customfield_12402",
          "optionId": "22300"
        }
      ]
    }
  ]
}
```

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
        "JIRA_PATS": "[\"${input:jiraPat1}\",\"${input:jiraPat2}\",\"${input:jiraPat3}\"]"
      }
    }
  },
  "inputs": [
    {
      "id": "jiraPat1",
      "type": "promptString",
      "description": "Jira Personal Access Token 1",
      "password": true
    },
    {
      "id": "jiraPat2",
      "type": "promptString",
      "description": "Jira Personal Access Token 2",
      "password": true
    },
    {
      "id": "jiraPat3",
      "type": "promptString",
      "description": "Jira Personal Access Token 3",
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
- If a PAT has been exposed, revoke it immediately and replace it with a newly generated PAT. Do not reuse the exposed value in `JIRA_PATS`.
- Prefer a Personal Access Token over Basic auth; PATs can be scoped and revoked independently of your account password.
- Set `JIRA_TLS_REJECT_UNAUTHORIZED=false` only as a last resort for internal CAs; prefer installing your corporate CA certificate via `NODE_EXTRA_CA_CERTS` instead.
- The optional HTTP transport listens on all interfaces by default. Put it behind TLS and appropriate network access controls; treat `X-Jira-Pat` as a secret.
- Run `npm audit` periodically and keep the MCP SDK and HTTP transport dependencies current.

## License

MIT
