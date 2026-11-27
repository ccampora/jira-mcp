# Jira and Confluence Cloud MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server connecting
**Jira Cloud** and optionally **Confluence Cloud** to MCP-compatible clients.
Built with TypeScript, the official MCP SDK, Axios, and Zod.

**Data Center and Server deployments are no longer supported.** Remove legacy
PAT, rotating-PAT, username, and password configuration. Both products use
Atlassian account email/API-token Basic authentication; credentials are never
inherited between products.

## Features

- 22 Jira tools for identity, search, bulk retrieval/creation/updates, comments,
  attachments, labels, transitions, projects, links, field metadata, and turning
  requirements into backlog items.
- 8 optional Confluence tools for identity, spaces, CQL search, pages, footer
  comments, and page creation/update.
- Jira REST v3, enhanced JQL search, ADF rich text, and `accountId` identities.
- Confluence v2 pages/spaces/footer comments and v1 identity/CQL APIs.
- Bounded pagination and rate-limit retries, normalized errors, credential
  redaction, and logging to stderr.
- Stdio and stateless Streamable HTTP transports.

## Setup

Requires Node.js >= 18 and a Jira Cloud account with the permissions and token
scopes required by the tools you use.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env with your Cloud URL and credentials.
npm run build
npm start
```

For local iteration, use `npm run dev`. Run the automated tests with `npm test`.
`npm run smoke-test` uses real configured credentials for read-only API calls.

### Deploy to Azure App Service

Use [scripts/deploy-webapp.ps1](scripts/deploy-webapp.ps1) to package the server
and deploy it to an existing Linux App Service plan (B1 or higher). The script
accepts your Azure resource names and Jira URL as parameters; it does not upload
your local `.env` or store Atlassian credentials.

See the [Azure Web App deployment guide](docs/AZURE_WEBAPP_DEPLOYMENT.md) for
prerequisites, device-code login, deployment, updates, and verification. Then
follow the [Copilot Studio setup guide](docs/COPILOT_STUDIO_SETUP.md) to connect
the deployed `/mcp` endpoint.

## Jira Cloud Configuration

For an unscoped API token:

```dotenv
JIRA_BASE_URL=https://example.atlassian.net
JIRA_CLOUD_EMAIL=jira-mcp@example.com
JIRA_CLOUD_API_TOKEN=<api-token>
JIRA_TLS_REJECT_UNAUTHORIZED=true
```

For a scoped API token, use the site's Cloud ID:

```dotenv
JIRA_BASE_URL=https://api.atlassian.com/ex/jira/<cloudId>
```

Do not append `/rest/api/3`; the client appends it, including for attachments.
Tokens use Basic auth with email/token, not bearer PATs or account passwords.
HTTPS and certificate verification are mandatory. OAuth 2.0 (3LO) is not
implemented.

`JIRA_DEPLOYMENT` and `CONFLUENCE_DEPLOYMENT` default to `cloud`. They may be
omitted; explicit `cloud` remains accepted, but any other value is rejected.

### Breaking changes from Data Center

- `JIRA_PATS`, `JIRA_PAT`, `JIRA_USERNAME`, `JIRA_PASSWORD`, `CONFLUENCE_PAT`,
  `CONFLUENCE_USERNAME`, and `CONFLUENCE_PASSWORD` are rejected if present.
  Remove them from the process environment, host configuration, and `.env`.
- `X-Jira-Pat` and `X-Confluence-Pat` HTTP headers are rejected.
- There is no Confluence-to-Jira credential fallback or PAT rotation.
- `import_test_execution` and the Data Center Xray Raven client are removed.
  Xray Cloud uses a separate API and authentication model; it is not implemented.
- The package and MCP server identity are now `jira-cloud-mcp-server`.
  The executable remains `jira-mcp-server`.
- Re-discover Cloud project, field, option, transition, and account IDs; do not
  reuse Data Center IDs without verification.

See the [migration assessment](docs/JIRA_CLOUD_API_MIGRATION.md) for historical
API differences and operational migration considerations.

## Confluence Cloud Configuration

Confluence is optional. Set all three values to enable it:

```dotenv
CONFLUENCE_BASE_URL=https://example.atlassian.net/wiki
CONFLUENCE_CLOUD_EMAIL=wiki-mcp@example.com
CONFLUENCE_CLOUD_API_TOKEN=<api-token>
```

For scoped tokens, use
`https://api.atlassian.com/ex/confluence/<cloudId>/wiki` with Confluence scopes.
Keep `/wiki` in the base URL; do not append `/api/v2` or `/rest/api`.
Confluence credentials must be explicit even when intentionally using the same
account as Jira. A Jira-only token cannot access Confluence.

Page bodies use storage-format XHTML, not Markdown or Jira ADF.
Before updating a page, fetch its current version and pass that version plus
one. Updates replace the full body; conflicts are surfaced without replaying
the write. Footer comments do not include inline comments. Author account IDs
may be returned instead of display names.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `JIRA_BASE_URL` | Yes | HTTPS site URL or scoped-token API gateway URL |
| `JIRA_CLOUD_EMAIL` | Yes | Atlassian account email |
| `JIRA_CLOUD_API_TOKEN` | Yes | Atlassian API token |
| `JIRA_DEPLOYMENT` | No | Only `cloud`, which is the default |
| `CONFLUENCE_BASE_URL` | With Confluence | HTTPS base URL ending in `/wiki` |
| `CONFLUENCE_CLOUD_EMAIL` | With Confluence | Explicit Confluence account email |
| `CONFLUENCE_CLOUD_API_TOKEN` | With Confluence | Token with Confluence access |
| `CONFLUENCE_DEPLOYMENT` | No | Only `cloud`, which is the default |
| `JIRA_TIMEOUT_MS` | No | Request timeout; default `15000` |
| `JIRA_TLS_REJECT_UNAUTHORIZED` | No | Must be `true`; default `true` |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error`; default `info` |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | HTTP only | Listen port; default `8787` |

## HTTP Transport

```powershell
$env:MCP_TRANSPORT = "http"
$env:PORT = "8787"
node dist\server.js
```

The MCP endpoint is `http://localhost:8787/mcp`. `GET /healthz` returns
`200 {"status":"ok"}` without contacting Jira.

Callers can override connections on every MCP request:

| Header | Description |
| --- | --- |
| `X-Atlassian-Credentials` | Jira `email,api-token` in a single secret header; requires server-side `JIRA_BASE_URL` |
| `X-Confluence-Credentials` | Independent Confluence `email,api-token`; requires server-side `CONFLUENCE_BASE_URL` |
| `X-Jira-Base-Url` | Jira site/API gateway URL |
| `X-Jira-Cloud-Email` | Atlassian email; send with token header |
| `X-Jira-Cloud-Api-Token` | API token; send with email header |
| `X-Confluence-Base-Url` | Confluence URL including `/wiki` |
| `X-Confluence-Cloud-Email` | Confluence email; send with token header |
| `X-Confluence-Cloud-Api-Token` | Confluence token; send with email header |
| `X-Jira-Deployment` / `X-Confluence-Deployment` | Optional; only `cloud` accepted |

Missing overrides fall back to environment settings. Credential overrides must
be supplied as complete email/token pairs, even when environment credentials
exist. Without environment credentials, send the base URL and credential pair
on every MCP request, including initialization and tool discovery.

Confluence tools must first be enabled with the environment
`CONFLUENCE_BASE_URL`; a header alone does not register them. HTTP mode can
start without credentials for health probes; MCP requests still require valid
configuration.

### Copilot Studio: single-header API key

Follow the [Copilot Studio setup and authorization guide](docs/COPILOT_STUDIO_SETUP.md)
for step-by-step MCP onboarding, a manual custom connector definition,
connection identity, token handling, verification, and troubleshooting.

Configure the MCP tool with:

| Setting | Value |
| --- | --- |
| Server URL | `https://<your-host>/mcp` |
| Authentication | API key |
| Type | Header |
| Header name | `X-Atlassian-Credentials` |
| Connection API-key value | `email@example.com,api-token` |

Set `JIRA_BASE_URL` on the server (use the Atlassian gateway URL for scoped
tokens). Jira email/token environment variables are not required when every
request supplies this header. Use an Atlassian Cloud API token, not a Data
Center PAT or account password.

The value is split at the first comma; surrounding whitespace is trimmed.
The server constructs Basic authentication for Atlassian in request memory.
It does not persist the credential or require Key Vault, OAuth endpoints, or
refresh-token storage. Copilot Studio holds the secret in its connection.
Users must replace expired or revoked API tokens themselves.

Combined credentials take precedence over that product's environment
credentials. Malformed values, duplicate headers, and mixing combined and
separate credentials for the same product fail explicitly without fallback.
Base URL override headers for either product are rejected whenever a combined
credential is supplied; use server-configured destinations.

`X-Atlassian-Credentials` applies to Jira only. Confluence credentials are
never automatically inherited: use `X-Confluence-Credentials` separately, or
explicit server-side Confluence credentials. The MCP wizard has one API-key
header, so a Jira connection alone does not also supply a separate Confluence
credential. A manually customized connector can provide both headers; the
same token may be entered explicitly for both only if it has the required
Jira and Confluence scopes.

Use end-user connections for individual Jira identity. A shared maker
connection executes as the credential owner. Test `get_current_user` to
confirm which account is used.

### Copilot Studio and endpoint authentication

The Streamable HTTP transport can be connected to Copilot Studio. However,
**the server does not authenticate inbound MCP callers**: it does not validate
an MCP API key or OAuth bearer token. Cloud credential headers configure
outbound Atlassian access, not independent access control to MCP.

For production, place it behind an authenticated HTTPS gateway, restrict
upstream base URLs, and never log credential headers. Authenticate the
connector to that gateway separately from Jira/Confluence authentication.
An Entra token does not automatically become a Jira token or establish the
chatting user's Jira identity. Server-side credentials mean a shared Jira
identity; per-user access requires each user's downstream credentials or a
future Atlassian OAuth implementation.

The single-header option above supplies both downstream values without OAuth.
Configuring only `X-Jira-Cloud-Api-Token` still requires its separate email
header. These credentials are validated by Atlassian on a tool's API call,
not independently during MCP initialization or tool discovery. Use HTTPS,
redact these headers at gateways/APM systems, and never put them in URLs or
tool arguments. API-token mode does not add independent MCP access control.

## Jira Tools

Routes are relative to `/rest/api/3`.

| Tool | REST call | Description |
| --- | --- | --- |
| `get_current_user` | `GET /myself` | Current account identity |
| `server_info` | `GET /serverInfo` | Site information |
| `search_issues` | `POST /search/jql` | Enhanced JQL search |
| `execute_jql` | `POST /search/jql` | JQL with requested fields |
| `get_issue` | `GET /issue/{key}` | Issue details and readable rich text |
| `get_issues_bulk` | `POST /search/jql` | Key-in query with pagination |
| `create_issue` | `POST /issue` | Create an issue |
| `create_issues_bulk` | `POST /issue/bulk` | Create in batches of up to 50 |
| `add_comment` | `POST /issue/{key}/comment` | Add a comment |
| `add_attachment` | `POST /issue/{key}/attachments` | Upload a base64 file as multipart |
| `add_issue_labels` | `PUT /issue/{key}` | Add labels without removing existing ones |
| `update_issue` | `PUT /issue/{key}` | Combined field and label updates |
| `update_issues_bulk` | `PUT /issue/{key}` per item | Updates with bounded concurrency |
| `transition_issue` | `POST /issue/{key}/transitions` | Move through a workflow |
| `get_projects` | `GET /project/search` | Paginated visible projects |
| `get_transitions` | `GET /issue/{key}/transitions` | Available transitions |
| `get_issue_comments` | `GET /issue/{key}/comment` | Paginated comments |
| `get_issue_remote_links` | `GET /issue/{key}/remotelink` | Linked pages and web links |
| `get_issue_link_types` | `GET /issueLinkType` | Link types and direction wording |
| `get_issue_edit_meta` | `GET /issue/{key}/editmeta` | Editable field schemas and options |
| `create_issue_link` | `POST /issueLink` | Link two issues |
| `create_jira_story_from_requirements` | `POST /issue/bulk` | Parse notes into backlog items |

### Rich text, pagination, and retries

- String descriptions/comments are converted to ADF. Generic updates also
  convert `environment` and textarea custom fields identified by edit metadata.
  Supplied ADF and null values are preserved. Use `{ "accountId": "..." }` for
  user fields.
- `get_issue` and `get_issue_comments` return readable text plus raw
  `descriptionAdf`/`bodyAdf`. Search/bulk results retain raw ADF.
- Search follows page-size caps up to `maxResults` (default 50; maximum 1000).
  There is no exact `total`: use `isLast` and `nextPageToken`, keeping JQL and
  fields unchanged for continuation.
- Project/comment lists have safety limits of 10000 items and 1000 requests.
  Exceeding a limit fails explicitly, rather than returning incomplete success.
- 429 retries honor `Retry-After`, or exponential backoff with jitter, up to
  five retries with the same credential. Network/5xx failures are not replayed.
  Cooldown is client-local, not shared globally across HTTP requests.

### Option-backed custom fields

Creation and update tools accept `customFieldOptions`. Discover actual field
and option IDs with edit metadata rather than guessing:

```json
{
  "issueKey": "ABC-123",
  "customFieldOptions": [
    { "fieldKey": "customfield_12402", "optionId": "22300" }
  ]
}
```

For bulk operations, include this structure on the appropriate item in
`issues` or `updates`.

### Requirements to backlog

`create_jira_story_from_requirements` accepts raw `notes` or an `items` array
with `{ type, summary, description?, acceptanceCriteria? }`. Explicit items take
precedence. Parsing recognizes `Story:`, `Task:`, `Bug:`, user-story wording,
and bullet/numbered lists. Set `dryRun: true` to preview before creating.
Partial creation failures are reported separately from successes.

## Confluence Tools

Routes below assume a site base URL ending in `/wiki`.

| Tool | REST call |
| --- | --- |
| `confluence_get_current_user` | `GET /wiki/rest/api/user/current` |
| `confluence_get_spaces` | `GET /wiki/api/v2/spaces` |
| `confluence_search` | `GET /wiki/rest/api/content/search` |
| `confluence_get_page` | `GET /wiki/api/v2/pages/{id}` |
| `confluence_get_page_by_title` | Resolve space ID, then `GET /wiki/api/v2/pages` |
| `confluence_get_page_comments` | `GET /wiki/api/v2/pages/{id}/footer-comments` |
| `confluence_create_page` | `POST /wiki/api/v2/pages` |
| `confluence_update_page` | `PUT /wiki/api/v2/pages/{id}` |

Linked Confluence pages are not Jira issue fields. Call
`get_issue_remote_links`, extract the page ID from a
`/wiki/spaces/<key>/pages/<pageId>/...` or `viewpage.action?pageId=...` URL,
then call `confluence_get_page`. Use `format: "view"` for rendered HTML or
`"storage"` for storage-format XHTML.

## VS Code MCP Configuration

```json
{
  "servers": {
    "jira-cloud": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/server.js"],
      "env": {
        "JIRA_BASE_URL": "https://api.atlassian.com/ex/jira/<cloudId>",
        "JIRA_CLOUD_EMAIL": "jira-mcp@example.com",
        "JIRA_CLOUD_API_TOKEN": "${input:jiraCloudToken}"
      }
    }
  },
  "inputs": [
    {
      "id": "jiraCloudToken",
      "type": "promptString",
      "description": "Jira Cloud API token",
      "password": true
    }
  ]
}
```

The executable `jira-mcp-server` can also be used after a global install.
Remove inherited legacy credentials, including those in `.env`.

## Error Handling

API errors preserve HTTP status and API details while redacting configured
credentials. MCP tool failures return `isError: true`. Configuration errors
name the invalid settings without including credential values.
