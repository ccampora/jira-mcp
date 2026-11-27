# Copilot Studio setup and authorization

This guide connects Copilot Studio to this server over Streamable HTTP using
**API key authentication with a combined Atlassian email/API-token header**.
It does not use OAuth, Entra sign-in, a token broker, or Key Vault.

## 1. Configure the server

Deploy the built server behind HTTPS with these settings:

```dotenv
MCP_TRANSPORT=http
JIRA_BASE_URL=https://example.atlassian.net
JIRA_TLS_REJECT_UNAUTHORIZED=true
```

The site URL above is appropriate for an **unscoped** Atlassian Cloud API token.
For a **scoped** API token, use:

```dotenv
JIRA_BASE_URL=https://api.atlassian.com/ex/jira/<cloudId>
```

Do not append `/rest/api/3` to either URL. The client appends it.
The MCP endpoint is `https://<your-host>/mcp`; the health endpoint is
`https://<your-host>/healthz`.

For connection-provided Jira credentials, omit `JIRA_CLOUD_EMAIL` and
`JIRA_CLOUD_API_TOKEN` from the deployed environment and any deployed dotenv
file. Do not package your local dotenv file. This prevents missing connection
credentials from falling back to a shared Jira account.

The existing environment-variable and separate credential-header approaches
remain supported for other deployments. No new runtime mode flag is needed.

## 2. Create the MCP connector in Copilot Studio

For repeatable Azure hosting, first follow the
[Azure Web App deployment guide](AZURE_WEBAPP_DEPLOYMENT.md).

In the target agent:

1. Open **Tools** and select **Add a tool**.
2. Select **New tool**, then **Model Context Protocol**.
3. In **Add MCP server**, enter:

   | Field | Value |
   | --- | --- |
   | Server name | A recognizable name, such as `Jira Cloud` |
   | Server description | For example, `Search and manage Jira Cloud issues using the connected user's permissions` |
   | Server URL | `https://<your-host>/mcp` |
   | Authentication | **API key** |
   | Type | **Header** |
   | Header name | `X-Atlassian-Credentials` |

4. Select **Create** or **Add**, as shown in your experience.
5. In the connection dialog, choose **Create a new connection**.
6. In the API-key field, enter the Atlassian account email and API token,
   separated by a comma:

   ```text
   your-email@example.com,your-atlassian-api-token
   ```

   Enter the value only: no header name, quotes, `Basic`, `Bearer`, or base64
   encoding. Use an Atlassian Cloud API token, not a password or Data Center PAT.
7. Finish creating the connection, then select **Add to agent**.
8. Verify that the Jira tools appear in the agent.

The API-key field is a connection secret. Do not put its value in the server
description, agent instructions, chat, URL, or tool arguments.

### Friendly credential label and help text

The MCP wizard may display `X-Atlassian-Credentials` as the connection field
label. This label comes from the connector, not the MCP server. Keep the
technical header name unchanged.

When editing the custom connector's **Security** settings, use this
**Parameter label**:

```text
Atlassian email and API token
```

Use the following credential description wherever the connector editor supports
help text:

```text
Enter your Atlassian account email, followed by a comma and your Atlassian Cloud API token. Example: you@example.com,your-api-token. Use the email belonging to the token owner, which may differ from your Microsoft sign-in email. Do not enter your password or add quotes.
```

Create or manage your token at
[Atlassian account API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
Treat the entire value as a secret. The standard MCP wizard might not expose
label or help-text customization; in that case, share these instructions with
users or edit the underlying custom connector where available.

### Alternative: import a Power Platform custom connector

If using the Power Apps custom connector editor instead of the MCP wizard,
import the following Swagger 2.0 definition, replacing the host:

```yaml
swagger: '2.0'
info:
  title: Jira Cloud MCP
  description: Jira Cloud tools using the connection owner's Atlassian credentials
  version: 1.0.0
host: your-host.example.com
basePath: /
schemes:
  - https
securityDefinitions:
  atlassianCredentials:
    type: apiKey
    in: header
    name: X-Atlassian-Credentials
    description: "Enter your Atlassian account email, followed by a comma and your Atlassian Cloud API token. Example: you@example.com,your-api-token. Use the email belonging to the token owner, not necessarily your Microsoft sign-in email. Do not enter your password or add quotes."
security:
  - atlassianCredentials: []
paths:
  /mcp:
    post:
      summary: Invoke Jira Cloud MCP
      operationId: InvokeMCP
      x-ms-agentic-protocol: mcp-streamable-1.0
      responses:
        '200':
          description: Success
```

Save the connector, create its connection with the same `email,api-token`
value, and add it to the agent. Environment permissions and Power Platform
data policies can affect whether the connector can be created or used.

## 3. Understand authentication and authorization

```text
Copilot Studio connection holds email + API token
    |
    | HTTPS: X-Atlassian-Credentials: email,api-token
    v
MCP parses credentials and creates a request-specific Jira client
    |
    | HTTPS: Authorization: Basic base64(email:api-token)
    v
Atlassian authenticates the token owner and enforces Jira permissions
```

- **Credential storage:** Copilot Studio/Power Platform manages the connection
  secret. The MCP handles it in request memory; it does not persist it in a
  database or Key Vault. Existing server-side credentials remain optional.
- **Identity:** Jira sees the Atlassian account owning the token. A shared
  maker connection does not automatically become the chatting user's account.
  Where supported, configure the tool to use end-user credentials and have
  each user create their own connection for individual identity.
- **Authorization:** Jira project permissions, issue security, and applicable
  token scopes control reads and writes. Possessing a connection does not grant
  permissions that the Atlassian account lacks.
- **Validation timing:** MCP initialization and tool discovery validate the
  credential's format and required configuration, not the credential against
  Atlassian. A successful connection or tool listing is not proof of Jira access.
- **No independent MCP login:** The server does not issue its own access tokens
  or validate a separate MCP API key. The header carries downstream credentials.
  A well-formed but invalid token can reach discovery; real API calls fail
  according to Atlassian's response. Do not describe discovery as authentication.
- **Expiry and revocation:** This is not OAuth. There is no automatic refresh.
  Replace the API-key value in the connection when its token expires or rotates.
  Revoke the API token in Atlassian when retiring it; deleting a Power Platform
  connection alone does not revoke the Atlassian token.

The parser splits at the first comma and trims surrounding whitespace. Combined
credentials override the same product's environment credentials. Invalid values,
repeated combined headers, and mixing combined and separate credential headers
for the same product are rejected without fallback.

Whenever either combined header is used, base URL override headers for both
products are rejected. Destinations must be configured on the server. Existing
separate-header clients still support their documented URL overrides, so this
is not a global upstream URL allowlist.

Use HTTPS end to end. Base64 is encoding, not encryption. Redact both credential
headers and outbound Authorization headers from gateways, traces, and APM.
Apply network restrictions, throttling, and any separate endpoint protection
appropriate for the deployment. Never publish real credentials in examples.

## 4. Verify the connection

In the agent's test experience:

1. Ask it to call `get_current_user`. Confirm the returned `accountId` and
   display name match the intended account; email can be private.
2. Call `server_info` to verify the Jira site.
3. Run a read-only search in a known project, for example:

   ```text
   project = DEMO AND updated >= -7d ORDER BY updated DESC
   ```

4. Confirm that results match the connected account's permissions.
5. Test writes only in an approved test project after confirming the target
   and proposed change.

`GET /healthz` confirms the process is responsive without contacting Jira.
It is not an authentication, permission, or downstream connectivity check.

## 5. Optional Confluence access

Confluence is enabled only when `CONFLUENCE_BASE_URL` is configured server-side:

```dotenv
CONFLUENCE_BASE_URL=https://example.atlassian.net/wiki
```

For scoped tokens use
`https://api.atlassian.com/ex/confluence/<cloudId>/wiki`.

Confluence needs its own explicit credentials:

- `X-Confluence-Credentials: email,api-token`, or
- the existing `CONFLUENCE_CLOUD_EMAIL` and `CONFLUENCE_CLOUD_API_TOKEN`
  server settings or separate credential headers.

`X-Atlassian-Credentials` is Jira-only; it never silently supplies Confluence
credentials. The standard MCP wizard configures one API-key header. To send
both combined headers, use an appropriately customized connector, or explicitly
configure Confluence credentials server-side. A server-side Confluence account
is shared even when Jira uses individual connections.

The same email/token may be entered explicitly for both products only when
authorized for both; a Jira-only scoped token cannot access Confluence.
Verify Confluence identity separately with `confluence_get_current_user`.

## 6. Troubleshooting

| Symptom | Checks |
| --- | --- |
| Generic `can't create MCP` or connection error | Retry once, then inspect the failed browser Network response for status, error message, and correlation ID. Do not infer an authentication failure from the generic dialog alone. Check connector permissions/data policies and server logs. |
| No tools or connection timeout | Use the HTTPS URL ending in `/mcp`, not the site root or `/healthz`. Check network restrictions and Streamable HTTP reachability. |
| HTTP 400 mentioning credentials | Enter `email,api-token`, use the exact header name, remove duplicate/conflicting credential headers, and configure server-side base URLs. |
| Discovery works but API calls fail | Verify the actual token, expiry, account permissions, site URL, scoped/unscoped token routing, and any Atlassian organization restrictions. |
| Wrong Jira identity | Inspect which connection the tool uses; a maker connection executes as its owner. Verify with `get_current_user`. |
| Confluence tools missing | Set the Cloud `/wiki` base URL on the server; a request header alone does not register tools. |

When sharing diagnostics, include only sanitized response errors and correlation
IDs. Do not share credential headers, cookies, raw request captures, or unredacted
HAR files.

## References

- [Connect an existing MCP server to Copilot Studio](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [Manage Atlassian account API tokens](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
- [Jira Cloud Basic authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
