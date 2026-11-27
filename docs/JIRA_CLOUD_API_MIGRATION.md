# Jira Data Center to Jira Cloud API Migration Guide

## 1. Purpose

This document defines the migration of this MCP server from the Jira Data
Center REST API to the Jira Cloud REST API. It is based on:

- the current implementation in this repository;
- Atlassian's Jira Software Cloud and Jira Cloud Platform REST documentation;
- the expected Cloud behavior as of 2026-10-05.

This is an application integration migration. It does not cover moving Jira
projects, issues, attachments, users, or marketplace app data from Data Center
to Cloud.

### Implementation status

The server is now **Cloud-only for both Jira and Confluence**. Configure
`JIRA_CLOUD_EMAIL` and `JIRA_CLOUD_API_TOKEN`; remove all Data Center
credentials. Deployment selectors default to `cloud` and reject other values.
See the [README configuration instructions](../README.md#jira-cloud-configuration).

Implemented: Cloud API-token Basic auth, REST v3, enhanced JQL search with
continuation tokens, ADF writes/readable tool output, `accountId` identity,
project/comment pagination, bounded 429 backoff, and stdio/HTTP configuration.
Data Center v2, PAT authentication/rotation, legacy password authentication,
and the Data Center Xray Raven tool have been removed. Xray Cloud is not
implemented; its API requires separate authentication.

Confluence also supports Cloud only, with explicit credentials; see the
[Confluence configuration](../README.md#confluence-cloud-configuration).

Still deployment responsibilities or future work: live site validation,
field/workflow/app mappings, OAuth 2.0 (3LO), distributed
tenant-wide rate-limit coordination, and production cutover/rollback.
The assessment matrix below records the **pre-migration baseline**, not the
current implementation's remaining bugs.

## 2. Executive summary

The migration is not a base URL change only. The Cloud-only implementation handles
the API differences listed below. Production readiness still requires
permissions, Cloud data mappings, live validation, and operational acceptance:

1. **Authentication:** Data Center bearer PATs are not Jira Cloud API tokens.
   Cloud API tokens use Basic authentication with account email plus token for
   simple single-site integrations. OAuth 2.0 (3LO) is Atlassian's recommended
   strategic method for an integration distributed to multiple users or sites.
2. **REST API version and endpoints:** standardize Jira calls on Platform REST
   API v3 and move JQL operations to enhanced search
   (`/rest/api/3/search/jql`). Do not assume every Data Center v2 endpoint or
   response shape is unchanged.
3. **Rich text:** Jira Cloud v3 represents descriptions, comments, and
   `textarea` custom fields in Atlassian Document Format (ADF), not plain
   strings.
4. **Users:** Cloud identifies users by `accountId`; Data Center `name` and
   `key` are not available. Email visibility is privacy-dependent.
5. **Cloud operating model:** pagination, scopes, permissions, rate limits,
   retries, add-on compatibility, and Cloud-specific IDs must be handled and
   tested explicitly.

### Recommended migration strategy

- **Cutover authentication for one internal Jira site:** Basic auth using a
  dedicated Atlassian service account email and a scoped API token, stored in a
  secret manager.
- **Strategic authentication for multiple users/sites or a distributable
  integration:** OAuth 2.0 authorization code flow (3LO), including refresh
  token storage and least-privilege scopes.
- **API target:** Jira Cloud Platform REST API v3 at
  `https://<site>.atlassian.net/rest/api/3` for unscoped API tokens, or
  `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3` for scoped API tokens.
- **Rollout:** dual-environment validation, read-only Cloud smoke tests,
  controlled write tests, then a configuration cutover with the Data Center
  deployment retained for rollback until acceptance is complete.

## 3. Scope and assumptions

### In scope

- Jira issue search, read, create, update, comments, attachments, labels,
  transitions, project listing, links, remote links, edit metadata, user
  identity, and server information.
- MCP stdio and HTTP deployment modes.
- Environment configuration, authentication, types, error handling, rate
  limiting, testing, rollout, and rollback.
- Identification of related Confluence and marketplace app dependencies.

### Out of scope

- Jira data migration and reconciliation.
- Jira Cloud organization, site, SSO, SCIM, or user provisioning setup.
- Confluence Cloud deployment validation (its implementation is now independent
  of the Jira deployment; see README).
- Xray or other marketplace app Cloud API implementation. Their Data Center and
  Cloud APIs, field schemas, and identifiers may differ.

### Assumptions to confirm

- The Cloud site URL is known and has the form
  `https://<site>.atlassian.net`.
- A dedicated Cloud service account is acceptable for the initial cutover.
- The required Jira projects and issue types have already been migrated.
- Project keys intended for use by the MCP server remain stable.
- The service account has only the Jira permissions required by the MCP tools.

## 4. Pre-migration baseline assessment

| Area | Current state | Migration impact |
| --- | --- | --- |
| Product identity | The README, server name, logs, tool descriptions, and comments identify the service as Jira Data Center. | Rename user-facing text and introduce an explicit deployment/API mode during transition. |
| Base URL | `JIRA_BASE_URL` is combined with `/rest/api/2`; attachments already use `/rest/api/3`. | Standardize on a v3 base URL and keep URL construction centralized. |
| Authentication | `JIRA_PATS` and `JIRA_PAT` send `Authorization: Bearer`; username/password sends Basic auth. | Bearer-token settings are Data Center-specific. For the first Cloud release, map Cloud email + API token to Basic auth or add explicit Cloud variables. |
| Credential rotation | Multiple bearer PATs rotate after HTTP 429. | This model does not directly apply to a single Cloud service account/API token. Do not rotate tokens to bypass limits. Back off globally for the credential/site. |
| Issue content | Description and comment types and payloads are strings. | Add ADF types plus plain-text-to-ADF conversion for writes and ADF-to-text/rendered output for MCP responses. |
| Users | `JiraUser` expects `name`, `key`, optional email, and groups. | Add `accountId` and Cloud user fields; stop depending on `name`/`key`; treat email and groups as permission/privacy-dependent. |
| Search | GET and POST use `/rest/api/2/search`; callers assume `startAt`, `maxResults`, `total`, and `issues`. | Move to enhanced JQL search and support its continuation model. Avoid assuming `total` is always present. |
| Projects | `GET /rest/api/2/project` expects an array. | Prefer paginated `GET /rest/api/3/project/search` and iterate pages. |
| Pagination | Search tools request one page; projects and comments do not iterate pages. | Add reusable pagination for every collection endpoint used by the tools. |
| Rate limits | Retries HTTP 429 up to five times and honors `Retry-After`; different PATs have independent cooldowns. | Preserve `Retry-After`, add exponential backoff with jitter when absent, honor Cloud rate-limit headers, and coordinate retries per tenant/credential. |
| TLS | Supports disabling certificate verification for internal Data Center certificates. | Cloud must use certificate verification. Reject `JIRA_TLS_REJECT_UNAUTHORIZED=false` in Cloud mode. |
| Confluence | Optional Data Center `/rest/api` client can inherit legacy Jira credentials. | Independently configurable Cloud v2/v1 adapter requires explicit Confluence email/token credentials. Validate separately before cutover. |
| Custom fields/apps | Tools accept Data Center custom field and option IDs and mention Xray schemas. | Re-discover Cloud field IDs, contexts, option IDs, and marketplace app APIs after data migration. |
| Request headers | HTTP mode accepts `X-Jira-Pat`. | Replace with a neutral secret mechanism; avoid forwarding long-lived Cloud tokens in per-request headers where possible. |

### Implementation surfaces

- [`src/config.ts`](../src/config.ts): Cloud mode, Cloud credential validation,
  OAuth configuration, and safe defaults.
- [`src/auth.ts`](../src/auth.ts): Cloud Basic API-token provider and,
  optionally, OAuth access-token refresh.
- [`src/jira-client.ts`](../src/jira-client.ts): v3 endpoints, ADF, pagination,
  enhanced search, Cloud retry behavior, and URL strategy.
- [`src/types.ts`](../src/types.ts): Cloud user, ADF, pagination, and v3 response
  types.
- [`src/server.ts`](../src/server.ts): product naming, request-scoped
  credentials, and Cloud-safe HTTP behavior.
- [`src/tools/`](../src/tools): descriptions and any MCP output normalization
  affected by ADF or Cloud response shapes.
- [`.env.example`](../.env.example) and [`README.md`](../README.md): Cloud
  configuration and operating instructions.
- [`test/`](../test): Cloud auth, payload, pagination, rate-limit, and endpoint
  contract tests.

## 5. Authentication decision

### Option A: Atlassian email and API token

Use this for the initial cutover when the server is an internal integration for
one controlled Jira Cloud site.

The authorization header is:

```text
Authorization: Basic base64(<atlassian-account-email>:<api-token>)
```

Important constraints:

- The token is not a Data Center PAT and must not be sent as `Bearer`.
- Use an API token, never the Atlassian account password.
- Use a dedicated service account and a scoped API token where supported.
- Jira permissions still apply; authentication does not grant additional Jira
  access.
- Store the token in the deployment secret manager, not in source control,
  images, MCP configuration files, or logs.
- Token rotation is an operational credential replacement, not a strategy for
  bypassing Cloud rate limits.

The implemented Cloud configuration is:

```dotenv
JIRA_DEPLOYMENT=cloud
# Scoped tokens require the Atlassian gateway:
JIRA_BASE_URL=https://api.atlassian.com/ex/jira/<cloudId>
# For an unscoped token instead: https://example.atlassian.net
JIRA_CLOUD_EMAIL=jira-mcp@example.com
JIRA_CLOUD_API_TOKEN=<cloud-api-token>
JIRA_TLS_REJECT_UNAUTHORIZED=true
```

Remove `JIRA_PATS`, `JIRA_PAT`, `JIRA_USERNAME`, and `JIRA_PASSWORD` from the
environment. Mixed credentials fail validation. Validate with read-only tools
before enabling production writes.

### Option B: OAuth 2.0 (3LO)

Use this when the integration acts on behalf of individual users, connects to
multiple Jira sites, or is distributed beyond one controlled internal
deployment.

Required capabilities:

1. Register one integration in the Atlassian developer console.
2. Implement authorization code flow with state validation.
3. Request only the granular or classic scopes needed by enabled MCP tools.
4. Discover accessible resources and retain the Jira `cloudId`.
5. Call Jira through
   `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...`.
6. Encrypt refresh tokens at rest and implement token refresh and revocation.
7. Partition cached tokens, retry state, and logs by tenant and user.

Do not create a separate 3LO app per customer and do not ask users to provide
client secrets.

### Important distinction: Jira Software "on-premises integrations"

The Jira Software Cloud documentation also describes OAuth credentials for
on-premises systems posting Development Information, Builds, and Deployments
through `api.atlassian.com`. Atlassian currently limits that integration model
to those API groups. It is not a replacement authentication route for this
server's issue CRUD, JQL, project, comment, transition, and attachment tools.

## 6. Implemented configuration contract

Use explicit names so Data Center bearer PATs cannot be mistaken for Cloud API
tokens:

```dotenv
# Optional; cloud is the only supported value and the default
JIRA_DEPLOYMENT=cloud

# Scoped API-token gateway URL (unscoped tokens may use the site URL)
JIRA_BASE_URL=https://api.atlassian.com/ex/jira/<cloudId>

# Required in Cloud mode
JIRA_CLOUD_EMAIL=jira-mcp@example.com
JIRA_CLOUD_API_TOKEN=stored-in-secret-manager

JIRA_TIMEOUT_MS=15000
JIRA_TLS_REJECT_UNAUTHORIZED=true
```

Migration behavior:

- Remove `JIRA_PATS`, `JIRA_PAT`, `JIRA_USERNAME`, `JIRA_PASSWORD`, and all
  equivalent legacy Confluence credentials. Their presence is rejected.
- Both products support Cloud only, including when deployment selectors are
  omitted. `datacenter` is rejected.
- Explicit Cloud email/API-token credentials are required; no legacy
  username/password alias or cross-product credential fallback is accepted.
- OAuth configuration is not implemented; section 5 describes a future option.
- Never log tokens, authorization headers, OAuth codes, or refresh tokens.
- HTTP mode supports `X-Jira-Deployment`, `X-Jira-Cloud-Email`, and
  `X-Jira-Cloud-Api-Token` overrides. Cloud credential headers must be supplied
  together. Put the endpoint behind an authenticated TLS gateway, never log
  those headers, and prefer centrally configured secrets where possible.

## 7. REST endpoint and payload migration matrix

| Capability | Current call | Cloud target | Required change |
| --- | --- | --- | --- |
| Current user | `GET /rest/api/2/myself?expand=groups` | `GET /rest/api/3/myself` | Model `accountId`; make email/groups optional and permission-aware. |
| Server info | `GET /rest/api/2/serverInfo` | `GET /rest/api/3/serverInfo` | Keep for diagnostics but rename the tool/output to site information and do not rely on Data Center-only fields. |
| JQL search | `GET /rest/api/2/search` | `GET /rest/api/3/search/jql` | Adopt enhanced search request and continuation behavior. |
| Bulk issue read | `POST /rest/api/2/search` | `POST /rest/api/3/search/jql` | Use key-in JQL, v3 fields, pagination, and stable input order reconstruction if required. |
| Get issue | `GET /rest/api/2/issue/{key}` | `GET /rest/api/3/issue/{key}` | Parse ADF descriptions/comments and Cloud user objects. |
| Create issue | `POST /rest/api/2/issue` | `POST /rest/api/3/issue` | Encode description and other rich-text fields as ADF; validate Cloud issue type and field IDs. |
| Bulk create | `POST /rest/api/2/issue/bulk` | `POST /rest/api/3/issue/bulk` | Encode ADF and verify Cloud batch limits and partial-failure mapping. |
| Add comment | `POST /rest/api/2/issue/{key}/comment` | `POST /rest/api/3/issue/{key}/comment` | Send comment body as ADF. |
| Attachment metadata | `GET /rest/api/3/attachment/meta` | Same | Retain, but test returned limits and permissions. |
| Add attachment | `POST /rest/api/3/issue/{key}/attachments` | Same | Retain multipart and `X-Atlassian-Token: no-check`; validate size and Cloud permissions. |
| Labels/update | `PUT /rest/api/2/issue/{key}` | `PUT /rest/api/3/issue/{key}` | Retain update operations; encode any rich-text fields passed through generic `fields`. |
| Transitions | v2 issue transition endpoints | v3 equivalents | Verify transition IDs in Cloud; migrated workflow IDs can differ. |
| Comments list | v2 issue comment endpoint | v3 equivalent | Page results and parse ADF. |
| Projects | `GET /rest/api/2/project` | `GET /rest/api/3/project/search` | Replace array assumption with paginated response. |
| Link types | v2 issue link type endpoint | v3 equivalent | Re-discover available types; IDs/names may differ. |
| Create link | `POST /rest/api/2/issueLink` | `POST /rest/api/3/issueLink` | Send an optional link comment as ADF or omit it. |
| Remote links | v2 issue remote-link endpoint | v3 equivalent | Test Cloud link representation and do not assume Data Center Confluence URLs. |
| Edit metadata | v2 issue edit metadata | v3 issue edit metadata/field APIs | Verify availability and use Cloud field contexts/options; do not reuse Data Center custom field IDs. |

The Jira Software Cloud API and Jira Cloud Platform API are complementary. The
current repository mainly uses Platform issue APIs, not board/sprint/backlog
resources. Use the Jira Software API under `/rest/agile/1.0` only if future MCP
tools add board, sprint, epic, or backlog operations.

## 8. Data model changes

### 8.1 Atlassian Document Format

In Jira Cloud v3, rich-text content is an ADF JSON document:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "Example text"
        }
      ]
    }
  ]
}
```

Implementation rules:

- Represent ADF with typed nodes; do not use `Record<string, any>`.
- Add a plain-text-to-ADF helper for existing MCP string inputs.
- Add an ADF-to-plain-text or structured serializer for readable MCP output.
- Preserve the raw ADF where round-trip fidelity matters.
- Validate generated documents before sending them.
- Apply the conversion to descriptions, comments, link comments, and
  rich-text custom fields.
- Do not globally convert every string field; summary, labels, and many option
  fields remain strings.

### 8.2 Cloud users

Update the user model to use:

- `accountId` as the stable API identifier;
- `displayName` for display only;
- optional `emailAddress`, because privacy settings may hide it;
- `active`, `accountType`, and avatar URLs where useful.

Do not use `name`, `key`, or email as a stable identity. Review stored JQL and
tool inputs that refer to users. JQL containing old usernames must be converted
to account IDs or use functions such as `currentUser()` where appropriate.

### 8.3 IDs and migrated configuration

Treat all of the following as environment-specific and re-discover them in
Cloud:

- project, issue type, workflow transition, status, field, field context, and
  option IDs;
- issue link types;
- marketplace app custom fields and schema identifiers;
- Confluence page IDs and remote links;
- automation actors and service accounts.

Project and issue keys may remain stable, but that must be verified rather than
assumed.

## 9. Permissions and scopes

Create a tool-to-permission matrix before production enablement. At minimum,
test:

- browse projects and issues;
- create and edit issues;
- add comments and attachments;
- transition issues;
- link issues;
- browse users/groups only if identity/group output is retained;
- access to each custom field and issue security level involved.

For OAuth, map every enabled endpoint to Atlassian scopes and request the least
privilege set. Jira project permissions remain effective in addition to OAuth
scopes. A successful token exchange does not prove the user can perform a tool
operation.

Use separate Cloud service accounts and tokens for development, test, and
production. Do not reuse a human administrator's token.

## 10. Pagination and rate limiting

### Pagination

Create a reusable paginator that supports both common Cloud patterns:

- `startAt`, `maxResults`, optional `total`, optional `isLast`;
- enhanced search continuation using `nextPageToken`.

Requirements:

- stop on `isLast`, missing continuation token, or an empty page as appropriate;
- do not assume `total` is present or stable;
- expose an MCP-level result limit so one prompt cannot read an unbounded site;
- preserve requested field selection to reduce payload size and API cost;
- add tests for empty intermediate/final pages, changing totals, and server
  page-size caps.

### Rate limiting

Jira Cloud can return HTTP 429 for burst, quota, and per-issue write limits.
The client must:

1. honor `Retry-After`;
2. use bounded exponential backoff with jitter when the header is absent;
3. avoid retrying non-idempotent writes unless the outcome is known or an
   idempotency/deduplication strategy exists;
4. coordinate cooldown by Cloud tenant and credential rather than cycling
   credentials;
5. reduce concurrency after repeated throttling;
6. log status, endpoint category, retry count, and delay without logging
   secrets or sensitive payloads.

The existing five-retry bound and credential redaction are useful foundations,
but PAT rotation must not be carried into Cloud mode.

## 11. Confluence and marketplace apps

### Confluence

Confluence supports Cloud only with explicit email/API-token credentials.
`CONFLUENCE_DEPLOYMENT=cloud` is optional. Pages/spaces/footer comments use
Cloud v2; CQL and current-user identity use v1. Configure and validate
Confluence separately, or disable its tools during Jira cutover.

Do not silently send Jira Cloud credentials to Confluence. Update remote-link
handling because Cloud links may use different URLs and integrated
relationships.

### Xray and other apps

Marketplace apps can have different products and APIs in Cloud. For every app:

1. confirm that its Cloud edition is installed and licensed;
2. obtain its Cloud API and authentication documentation;
3. map Data Center custom fields to Cloud fields;
4. verify whether test steps and other app data are Jira fields or app-owned
   entities;
5. execute app-specific read/write contract tests.

The generic edit-metadata tool is not sufficient evidence that a Data Center
app integration works in Cloud.

## 12. Implementation plan

### Phase 0: inventory and decisions

- Confirm single-site API token versus OAuth 2.0 target.
- Record Cloud site URL and, for OAuth, `cloudId`.
- Inventory enabled MCP tools and disable unused write tools.
- Create the tool-to-permission/scope matrix.
- Export representative Data Center API fixtures and capture equivalent Cloud
  fixtures with sanitized data.
- Map project keys, issue types, fields/options, workflows, links, and apps.

**Exit criteria:** authentication approach approved; Cloud test account and
test project available; field/app mapping reviewed.

### Phase 1: configuration and authentication

- Add `JIRA_DEPLOYMENT` (implemented; Cloud mode uses API-token Basic auth).
- Add explicit Cloud API-token settings.
- Implement Cloud Basic authentication.
- Reject bearer PATs and disabled TLS verification in Cloud mode.
- If OAuth is selected, add authorization, refresh, tenant discovery, encrypted
  token storage, and revocation in a future implementation. OAuth and
  `JIRA_AUTH_METHOD` selection are not currently implemented.
- Preserve secret redaction tests.

**Exit criteria:** `/rest/api/3/myself` succeeds against the Cloud test site and
returns the expected `accountId`.

### Phase 2: v3 models and content

- Add ADF types and conversion helpers.
- Update user and comment/issue types.
- Change all Jira Platform calls to v3.
- Update tool output so ADF is readable while raw content can still be
  inspected when needed.
- Rename Data Center-specific server/tool text.

**Exit criteria:** get, create, update, and comment operations pass contract
tests with plain and formatted content.

### Phase 3: search, projects, and pagination

- Implement enhanced JQL search.
- Add continuation-token and offset pagination helpers.
- Move project listing to paginated project search.
- Add MCP result limits and field selection.

**Exit criteria:** multi-page issue/project tests complete without duplicates,
omissions, or unbounded requests.

### Phase 4: writes and app dependencies

- Validate issue create/bulk create, generic updates, labels, transitions,
  comments, attachments, links, and remote links.
- Re-map custom fields and options.
- Validate or disable Confluence and marketplace app features.
- Add safe retry behavior for writes.

**Exit criteria:** every enabled write tool passes in a disposable Cloud test
project and produces the intended Jira audit history.

### Phase 5: operational hardening

- Add rate-limit metrics and tenant-aware cooldown.
- Add structured logs with correlation IDs.
- Add synthetic read-only health validation separate from process health.
- Document token rotation, revocation, incident response, and rollback.
- Update deployment manifests and secret references.

**Exit criteria:** operational runbook approved; alerting and secret rotation
tested.

### Phase 6: production cutover

- Freeze integration configuration changes.
- Run the pre-cutover smoke suite against Data Center and Cloud.
- Disable Cloud writes, validate reads, then enable a limited write canary.
- Switch MCP clients to the Cloud deployment.
- Monitor authentication failures, 403s, 404s, 429s, latency, and write errors.
- Retain the Data Center deployment for rollback without allowing dual writes.

**Exit criteria:** acceptance tests pass, error and throttle rates are within
agreed thresholds, and product owners approve the cutover.

## 13. Test strategy

### Unit tests

- Cloud API token header uses Basic email/token encoding.
- Data Center bearer PATs are rejected in Cloud mode.
- Secrets are redacted from configuration, API errors, and logs.
- Plain text converts to valid ADF; ADF converts to expected MCP text.
- Cloud users work without `name`, `key`, or email.
- Both pagination models terminate correctly.
- 429 handling honors `Retry-After` and uses bounded jittered backoff.
- Non-idempotent writes are not blindly replayed.

### Mock API contract tests

For every enabled tool, assert:

- HTTP method and v3 path;
- query parameters and requested fields;
- required headers;
- request payload, especially ADF;
- successful response normalization;
- 400, 401, 403, 404, 409, 413, 429, and 5xx behavior where relevant;
- paginated and privacy-restricted responses.

### Cloud integration tests

Use a disposable project and dedicated service account:

1. get current user and verify `accountId`;
2. get server/site information;
3. list more projects than one page;
4. search more issues than one page;
5. create an issue with a description and labels;
6. read it and verify ADF normalization;
7. add and read a comment;
8. upload a small attachment;
9. update fields and labels;
10. list and execute an allowed transition;
11. create and read an issue link;
12. retrieve edit metadata and validate mapped custom fields;
13. delete/close test artifacts according to test-project policy.

Run permission-negative tests with a restricted account to ensure 403 responses
are surfaced clearly rather than reported as empty successful results.

### Acceptance criteria

- All enabled MCP tools use documented Jira Cloud endpoints.
- No enabled tool relies on Data Center usernames, user keys, plaintext rich
  text responses, or Data Center bearer PATs.
- All collection operations are bounded and pagination-safe.
- Secrets are absent from logs and surfaced errors.
- A 429 does not cause credential cycling or an uncontrolled retry storm.
- Data Center and Cloud cannot both receive writes during cutover.
- Cloud audit logs show the expected service account or OAuth user.

## 14. Cutover and rollback runbook

### Pre-cutover

- Revoke unused test tokens and create the production credential.
- Load the credential from the production secret manager.
- Confirm the service account's groups, product access, and project
  permissions.
- Verify field, option, transition, link type, and issue type mappings.
- Confirm Confluence/app-dependent tools are migrated or disabled.
- Run the complete read/write canary in a test project.
- Capture baseline latency, error rate, and 429 rate.

### Cutover

1. Stop or disable Data Center writes from the MCP service.
2. Deploy the Cloud-capable build with write tools initially disabled.
3. Run identity, project, issue, search, and pagination smoke tests.
4. Enable write tools for the canary project/service account.
5. Validate create, comment, attachment, update, transition, and link audit
   events.
6. Enable the approved production project scope.
7. Monitor closely through the agreed stabilization window.

### Rollback triggers

- repeated authentication/token refresh failures;
- incorrect ADF or destructive field updates;
- missing/duplicated search results;
- sustained 429s after concurrency reduction;
- permission behavior broader than approved;
- marketplace app or custom field corruption;
- error rate or latency above the agreed threshold.

### Rollback procedure

1. Disable Cloud write tools immediately.
2. Preserve logs, correlation IDs, failed payload metadata, and Jira audit
   evidence without retaining secrets.
3. Restore the previous MCP deployment/configuration pointing to Data Center
   only if Data Center remains authoritative and available.
4. Do not replay uncertain Cloud writes automatically.
5. Reconcile canary writes manually before another cutover.
6. Revoke the Cloud credential if credential compromise is suspected.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Treating an API token as a bearer PAT | All Cloud calls fail or credentials are mishandled. | Explicit Cloud auth mode and startup validation. |
| Plain strings sent to v3 rich-text fields | 400 responses or lost formatting. | Typed ADF conversion and contract tests. |
| Data Center user fields assumed | Missing identities and broken JQL. | Use `accountId`; make private fields optional. |
| Legacy search semantics retained | Endpoint failures or incomplete results. | Enhanced search plus continuation-token tests. |
| No pagination | Silent data omission. | Shared bounded paginator and multi-page integration fixtures. |
| PAT cycling under Cloud throttling | Limit evasion behavior and retry storms. | Tenant/credential cooldown, backoff, and lower concurrency. |
| IDs reused after data migration | Writes target wrong fields/options/workflows. | Cloud discovery and approved mapping inventory. |
| Confluence credentials inherited | Cross-product auth failure or secret exposure. | Separate Cloud migration and credentials; disable until ready. |
| Xray/app parity assumed | Test-management data loss or broken tools. | App-specific Cloud API assessment and tests. |
| Dual writes during cutover | Divergent issue state. | Single writer, write freeze, and controlled rollback. |

## 16. Open decisions

The following decisions must be recorded before implementation:

1. Is the target one internal Jira site/service account, or a multi-user and
   multi-site integration?
2. Is API-token Basic auth acceptable for the first production release, or is
   OAuth 2.0 required from day one?
3. Which MCP write tools are required in production?
4. What maximum issues/projects may one MCP call retrieve?
5. Must formatted ADF be preserved round-trip, or is readable plain-text MCP
   output sufficient?
6. Will Confluence tools be disabled or migrated at the same time?
7. Which marketplace apps and custom fields are release blockers?
8. What are the measurable rollback thresholds for error rate, latency, and
   throttling?

## 17. Readiness checklist

- [ ] Authentication option and ownership approved.
- [ ] Cloud site URL and optional `cloudId` recorded.
- [ ] Dedicated service account or OAuth app created.
- [ ] Least-privilege permissions/scopes approved.
- [ ] Explicit Cloud configuration implemented.
- [ ] REST API v3 migration complete.
- [ ] Enhanced JQL search implemented.
- [ ] ADF read/write conversion tested.
- [ ] `accountId` user migration complete.
- [ ] Pagination implemented for every collection.
- [ ] Cloud rate-limit handling load-tested.
- [ ] Custom field and workflow mappings approved.
- [ ] Confluence and marketplace app decision complete.
- [ ] Unit, contract, integration, and acceptance tests pass.
- [ ] Monitoring, token rotation, cutover, and rollback runbooks approved.
- [ ] Data Center write path disabled before Cloud writes begin.

## 18. References

Accessed 2026-10-05:

- [Jira Software Cloud REST API introduction](https://developer.atlassian.com/cloud/jira/software/rest/intro/#introduction)
- [Jira Cloud Platform REST API v3 introduction](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [Basic authentication for Jira Cloud REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- [OAuth 2.0 (3LO) apps](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- [OAuth 2.0 scopes for Jira](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/)
- [Jira Cloud issue search API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)
- [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
- [Jira Cloud user privacy API migration guide](https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-user-privacy-api-migration-guide/)
- [Jira Cloud rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [Managing API tokens and scoped-token gateway URLs](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
