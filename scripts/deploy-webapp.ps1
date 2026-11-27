#Requires -Version 7.0
<#
.SYNOPSIS
Packages and deploys the MCP server to an existing Linux Azure App Service plan.
.DESCRIPTION
Uses an explicit package allowlist; never uploads .env, poc, tests, or local credentials.
Run npm ci at the repository root before using this script.
#>
[CmdletBinding(DefaultParameterSetName = 'Deploy')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Deploy')]
    [ValidateNotNullOrEmpty()]
    [string]$SubscriptionId,

    [Parameter(Mandatory, ParameterSetName = 'Deploy')]
    [ValidateNotNullOrEmpty()]
    [string]$ResourceGroup,

    [Parameter(Mandatory, ParameterSetName = 'Deploy')]
    [ValidateNotNullOrEmpty()]
    [string]$PlanName,

    [Parameter(Mandatory, ParameterSetName = 'Deploy')]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9-]{0,58}[a-zA-Z0-9]$')]
    [string]$AppName,

    [Parameter(Mandatory, ParameterSetName = 'Deploy')]
    [ValidateNotNullOrEmpty()]
    [string]$JiraBaseUrl,

    [Parameter(Mandatory, ParameterSetName = 'Deploy')]
    [ValidatePattern('^@Microsoft\.KeyVault\(SecretUri=https://[a-zA-Z0-9-]+\.vault\.azure\.net/secrets/[a-zA-Z0-9-]+(/[a-fA-F0-9]+)?/?\)$')]
    [string]$McpAccessTokenKeyVaultReference,

    [Parameter(ParameterSetName = 'Deploy')]
    [switch]$UpdateExisting,

    [Parameter(Mandatory, ParameterSetName = 'Package')]
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Az {
    param([string[]]$Arguments)
    $output = & az @Arguments --only-show-errors
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments[0]) $($Arguments[1])"
    }
    return $output
}

$repo = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) "jira-mcp-deploy-$([guid]::NewGuid())"
$stage = Join-Path $work 'package'
$outputDirectory = Join-Path $repo '.deployment'
$zip = Join-Path $outputDirectory "app-$([guid]::NewGuid()).zip"

Get-Command npm -ErrorAction Stop | Out-Null
if (-not $PackageOnly) {
    Get-Command az -ErrorAction Stop | Out-Null
    $uri = [Uri]$JiraBaseUrl
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or
        -not $uri.Host -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw 'JiraBaseUrl must be an HTTPS URL without credentials, query, or fragment.'
    }
    $plan = (Invoke-Az -Arguments @(
        'appservice', 'plan', 'show', '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup, '--name', $PlanName, '--output', 'json'
    )) | ConvertFrom-Json
    if (-not $plan.reserved -and $plan.kind -notmatch 'linux') {
        throw 'A Linux App Service plan is required. The existing plan will not be changed.'
    }
    if ($plan.sku.tier -in @('Free', 'Shared')) {
        throw 'Use a Basic (B1) or higher plan; this script enables Always On.'
    }
    $existing = @((Invoke-Az -Arguments @(
        'webapp', 'list', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup,
        '--output', 'json'
    )) | ConvertFrom-Json | Where-Object name -EQ $AppName)
    if ($existing.Count -gt 0) {
        $app = $existing[0]
        $tags = if ($app.tags) { $app.tags } else { [pscustomobject]@{} }
        $managed = $tags.PSObject.Properties['managed-by']
        $purpose = $tags.PSObject.Properties['purpose']
        $owned = ($managed -and $managed.Value -eq 'jira-cloud-mcp') -or
            ($purpose -and $purpose.Value -eq 'copilot-studio-jira-mcp-poc')
        if (-not $UpdateExisting -or $app.serverFarmId -ine $plan.id -or -not $owned) {
            throw 'App already exists. Updates require -UpdateExisting, the same plan, and a recognized MCP ownership tag.'
        }
    }
}

try {
    Push-Location $repo
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Server build failed. Run npm ci at the repository root first.' }
    } finally {
        Pop-Location
    }

    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    # Copy only compiler outputs, not arbitrary files left in dist by earlier builds.
    $dist = Join-Path $stage 'dist'
    New-Item -ItemType Directory -Path $dist | Out-Null
    $sources = Get-ChildItem -LiteralPath (Join-Path $repo 'src') -Recurse -Filter '*.ts'
    foreach ($source in $sources) {
        $relative = [IO.Path]::GetRelativePath((Join-Path $repo 'src'), $source.FullName)
        $compiled = [IO.Path]::ChangeExtension($relative, '.js')
        $destination = Join-Path $dist $compiled
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path (Join-Path $repo 'dist') $compiled) -Destination $destination
    }
    Copy-Item -LiteralPath (Join-Path $repo 'package.json'), (Join-Path $repo 'package-lock.json') -Destination $stage
    Push-Location $stage
    try {
        & npm ci --omit=dev --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
    } finally {
        Pop-Location
    }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
    if ($PackageOnly) {
        Write-Output "Deployment package: $zip"
        return
    }

    if ($existing.Count -eq 0) {
        $null = Invoke-Az -Arguments @(
            'webapp', 'create', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup,
            '--plan', $plan.id, '--name', $AppName, '--runtime', 'NODE:22-lts',
            '--tags', 'managed-by=jira-cloud-mcp', '--output', 'none'
        )
    }
    $healthConfig = Join-Path $work 'health-config.json'
    '{"healthCheckPath":"/healthz","linuxFxVersion":"NODE|22-lts"}' |
        Set-Content -LiteralPath $healthConfig -Encoding utf8NoBOM
    $null = Invoke-Az -Arguments @(
        'webapp', 'update', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup,
        '--name', $AppName, '--https-only', 'true', '--output', 'none'
    )
    $null = Invoke-Az -Arguments @(
        'webapp', 'config', 'set', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup,
        '--name', $AppName,
        '--startup-file', 'node dist/server.js', '--always-on', 'true',
        '--min-tls-version', '1.2', '--ftps-state', 'Disabled', '--http20-enabled', 'true',
        '--generic-configurations', "@$healthConfig", '--output', 'none'
    )
    $null = Invoke-Az -Arguments @(
        'webapp', 'config', 'appsettings', 'set', '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup, '--name', $AppName, '--settings',
        'MCP_TRANSPORT=http', "JIRA_BASE_URL=$($JiraBaseUrl.TrimEnd('/'))",
        "MCP_HTTP_ACCESS_TOKEN=$McpAccessTokenKeyVaultReference",
        'JIRA_TLS_REJECT_UNAUTHORIZED=true', 'LOG_LEVEL=info',
        'SCM_DO_BUILD_DURING_DEPLOYMENT=false', '--output', 'none'
    )
    $null = Invoke-Az -Arguments @(
        'webapp', 'deploy', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup,
        '--name', $AppName, '--src-path', $zip, '--type', 'zip', '--clean', 'true',
        '--restart', 'true', '--output', 'none'
    )
    $app = (Invoke-Az -Arguments @(
        'webapp', 'show', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup,
        '--name', $AppName, '--query', '{host:defaultHostName}', '--output', 'json'
    )) | ConvertFrom-Json
    # App Service may still be starting after the deployment command returns.
    $healthUri = "https://$($app.host)/healthz"
    $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 30 -MaximumRetryCount 12 -RetryIntervalSec 10
    if ($health.status -ne 'ok') { throw 'The deployed health endpoint did not return status=ok.' }
    Write-Output "Health verified: $healthUri"
    Write-Output "MCP endpoint: https://$($app.host)/mcp"
    Write-Output 'HTTP clients must supply X-MCP-Access-Token and Jira credentials separately.'
} finally {
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}
