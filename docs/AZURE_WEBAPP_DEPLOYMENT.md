# Deploy to Azure Web App

[deploy-webapp.ps1](../scripts/deploy-webapp.ps1) packages this server and creates
a Linux Azure Web App on an **existing App Service plan**. It can also update
apps previously created by this script or the original Copilot Studio PoC script.
No subscription IDs, resource names, Atlassian emails, or API tokens are built in.

## Prerequisites

- PowerShell 7 or later (`pwsh`), Node.js 22 LTS with npm, and Azure CLI.
- A checkout of this repository, including its lockfile.
- An existing resource group and Linux App Service plan, Basic B1 or higher.
  The plan's region determines the app's region. The script does not create,
  resize, move, or delete the plan.
- Azure permissions to read the plan and create/configure/deploy Web Apps in
  the target resource group (for example, Contributor at that scope).
- Network access to npm, Azure deployment endpoints, and Atlassian.

The plan incurs Azure charges. Deploying another app on an existing plan shares
its compute capacity. Review capacity before adding workloads.

Run commands from the repository root:

```powershell
npm ci
npm test
```

The deployment script runs the TypeScript build itself. It installs only
production dependencies into a fresh temporary staging directory, using the
lockfile and disabling dependency lifecycle scripts.

## Sign in to Azure

```powershell
az login
```

For device-code login on Windows, including environments where the broker hangs:

```powershell
# Applies only to this PowerShell process.
$env:AZURE_CORE_ENABLE_BROKER_ON_WINDOWS = 'false'
az login --use-device-code --tenant '<tenant-id>'
```

Complete sign-in using the URL and code printed by Azure CLI. Never share the
device code. The deployment script passes `--subscription` explicitly for every
Azure command; it does not change your default subscription.

## Deploy

Use an unscoped Atlassian API token with your site's URL:

```powershell
.\scripts\deploy-webapp.ps1 `
    -SubscriptionId '<subscription-id>' `
    -ResourceGroup '<existing-resource-group>' `
    -PlanName '<existing-linux-plan>' `
    -AppName '<globally-unique-app-name>' `
    -JiraBaseUrl 'https://example.atlassian.net'
```

For a scoped API token, use this instead:

```text
https://api.atlassian.com/ex/jira/<cloudId>
```

Do not append `/rest/api/3`. Use the URL appropriate for the tokens that users
will supply in their connections.

The script:

1. Checks the existing plan and refuses Windows, Free, and Shared plans.
2. Refuses to overwrite an existing app unless explicitly updating a recognized
   MCP deployment on the same plan.
3. Builds the server, copies only compiled JavaScript corresponding to source
   files plus package manifests, and installs production dependencies.
4. Creates a ZIP at `.deployment/app-<unique-id>.zip`. It excludes `.env`,
   the PoC folder, tests, Git metadata, and other repository files.
5. Creates the app if needed, with the `managed-by=jira-cloud-mcp` ownership tag.
6. Configures Node.js 22 LTS, startup `node dist/server.js`, HTTPS only, minimum
   TLS 1.2, disabled FTPS, HTTP/2, Always On, and `/healthz` health checks.
7. Sets HTTP transport, the Jira URL, strict Atlassian TLS validation, and info
   logging. Server-side builds are disabled because the ZIP is ready to run.
8. ZIP-deploys with a clean application directory and restarts the app.
9. Checks `/healthz` with bounded HTTP retries and prints the `/mcp` endpoint.

Temporary staging files are removed even on failure. ZIPs remain locally for
inspection and are ignored by Git. They contain application code and dependencies,
not Atlassian credentials. Remove individual old ZIPs when no longer needed.

The current dependencies are JavaScript-only. If native dependencies are added,
build/package in an environment matching the Linux runtime and architecture;
do not upload Windows native binaries.

Packaging does not certify dependency security. Review `npm audit --omit=dev`
and address applicable advisories before production exposure.

### Package without changing Azure

```powershell
.\scripts\deploy-webapp.ps1 -PackageOnly
```

This builds the same ZIP, without requiring Azure login or running Azure
commands. It still requires local build dependencies and npm registry access.

### Update or retry a deployment

Repeat the deployment command with **`-UpdateExisting`**:

```powershell
.\scripts\deploy-webapp.ps1 `
    -SubscriptionId '<subscription-id>' `
    -ResourceGroup '<existing-resource-group>' `
    -PlanName '<existing-linux-plan>' `
    -AppName '<existing-mcp-app-name>' `
    -JiraBaseUrl 'https://example.atlassian.net' `
    -UpdateExisting
```

The app must be on the specified plan and carry either `managed-by=jira-cloud-mcp`
or the original PoC's `purpose=copilot-studio-jira-mcp-poc` tag. An unrecognized
existing app is rejected. Do not add ownership tags to unrelated apps to bypass
this check. An app created by a partially completed run can be retried this way.

Updates replace deployed application files and overwrite the settings listed
above, including the runtime and Jira URL. Unrelated app settings are retained.
The script does not delete resources or modify your local PoC project.

## Credentials and Copilot Studio

This deployment uses **connection-owned credentials**. Neither an email nor an
API token is accepted as a deployment parameter. The script does not read or
upload your local `.env`.

Configure Copilot Studio using the printed HTTPS endpoint:

| Setting | Value |
| --- | --- |
| Server URL | `https://<app-host>/mcp` (use the printed hostname) |
| Authentication | API key |
| Location | Header |
| Header name | `X-Atlassian-Credentials` |
| Connection value | `your-email@example.com,your-api-token` |

See [Copilot Studio setup and authorization](COPILOT_STUDIO_SETUP.md) for
connection ownership, friendly labels, token expiry, and the optional Confluence
configuration. This script configures Jira only; it does not enable Confluence.

**Hosting is not authentication hardening.** The MCP endpoint has no independent
login, OAuth implementation, or separately validated API key. Discovery checks
configuration, not token validity; Jira validates credentials and permissions on
actual API calls. Do not set shared server-side credentials unless you intentionally
want callers to use that identity. Separate-header clients retain their documented
URL overrides; combined credentials require server-configured destinations.
For broader exposure, assess network restrictions, abuse controls, and a suitable
authentication boundary for your organization.

## Verify and troubleshoot

```powershell
Invoke-RestMethod 'https://<app-host>/healthz'
# Expected: status = ok
```

Add the MCP connection, discover tools, and call `get_current_user` to verify
real Atlassian access. Health and discovery alone do not prove token validity.

- **Missing build dependencies:** run `npm ci` at the repository root.
- **Authorization/subscription errors:** check your login, tenant, supplied
  subscription, and role assignments.
- **Existing app rejected:** confirm the exact app/plan and use `-UpdateExisting`
  only for a recognized deployment.
- **Deployment command fails or times out:** inspect Deployment Center in the
  Azure portal before retrying. The script does not turn a CLI error into success;
  Azure may still be processing the deployment.
- **Startup or health failure:** inspect App Service Log stream and Deployment
  Center. Check the startup command, runtime, `MCP_TRANSPORT=http`, and plan
  capacity. No local hardcoded `PORT` is needed; the server uses Azure's port.
- **Jira 401/403:** check the connection's email/token, token expiry/scopes,
  Jira permissions, and whether the configured URL matches the token type.

No live Azure resources are required to run the script's mocked regression checks:

```powershell
npm run build
.\scripts\test-deploy-webapp.ps1
```
