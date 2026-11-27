#Requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$deploy = Join-Path $PSScriptRoot 'deploy-webapp.ps1'
$parameters = @{
    SubscriptionId = 'test-subscription'
    ResourceGroup = 'test-group'
    PlanName = 'test-plan'
    AppName = 'test-mcp-app'
    JiraBaseUrl = 'https://example.atlassian.net'
}
$global:JiraDeployTest = @{
    Mode = 'new'
    Calls = [Collections.Generic.List[object]]::new()
    Packages = [Collections.Generic.List[string]]::new()
}

function Assert {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

function az {
    $global:JiraDeployTest.Calls.Add(@($args))
    $global:LASTEXITCODE = 0
    $command = "$($args[0]) $($args[1])"
    switch ($command) {
        'appservice plan' {
            if ($global:JiraDeployTest.Mode -eq 'cli-failure') {
                $global:LASTEXITCODE = 1
                return
            }
            @{
                id = '/subscriptions/test/serverfarms/test-plan'
                kind = if ($global:JiraDeployTest.Mode -eq 'windows') { 'app' } else { 'linux' }
                reserved = $false
                sku = @{ tier = if ($global:JiraDeployTest.Mode -eq 'free') { 'Free' } else { 'Basic' } }
            } | ConvertTo-Json
        }
        'webapp list' {
            $apps = @()
            if ($global:JiraDeployTest.Mode -in @('existing', 'unowned', 'wrong-plan', 'poc', 'deploy-failure', 'bad-health')) {
                $tags = if ($global:JiraDeployTest.Mode -eq 'unowned') { @{} }
                    elseif ($global:JiraDeployTest.Mode -eq 'poc') { @{ purpose = 'copilot-studio-jira-mcp-poc' } }
                    else { @{ 'managed-by' = 'jira-cloud-mcp' } }
                $apps = @(@{
                    name = 'test-mcp-app'
                    serverFarmId = if ($global:JiraDeployTest.Mode -eq 'wrong-plan') { '/other-plan' }
                        else { '/subscriptions/test/serverfarms/test-plan' }
                    tags = $tags
                })
            }
            ConvertTo-Json -InputObject $apps -Depth 5
        }
        'webapp show' { '{"host":"test.invalid"}' }
        'webapp config' {
            if ($args -contains '--generic-configurations') {
                $configPath = $args[[array]::IndexOf($args, '--generic-configurations') + 1].Substring(1)
                $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
                Assert ($config.healthCheckPath -eq '/healthz') 'configures health checks'
                Assert ($config.linuxFxVersion -eq 'NODE|22-lts') 'sets Node runtime without shell quoting issues'
            }
        }
        'webapp deploy' {
            $global:JiraDeployTest.Packages.Add($args[[array]::IndexOf($args, '--src-path') + 1])
            if ($global:JiraDeployTest.Mode -eq 'deploy-failure') {
                $global:LASTEXITCODE = 1
            }
        }
    }
}

function npm {
    $global:LASTEXITCODE = if ($global:JiraDeployTest.Mode -eq 'build-failure') { 1 } else { 0 }
}

function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $MaximumRetryCount, $RetryIntervalSec)
    Assert ($Uri -eq 'https://test.invalid/healthz') 'checks the deployed hostname'
    if ($global:JiraDeployTest.Mode -eq 'bad-health') { return @{ status = 'bad' } }
    return @{ status = 'ok' }
}

function Expect-Failure {
    param([string]$Mode, [string]$Message, [switch]$Update)
    $global:JiraDeployTest.Mode = $Mode
    $global:JiraDeployTest.Calls.Clear()
    $failed = $false
    try {
        & $deploy @parameters -UpdateExisting:$Update
    } catch {
        Assert ($_.Exception.Message -like "*$Message*") "expected error: $Message; got $_"
        $failed = $true
    }
    Assert $failed "$Mode must fail"
    Assert (-not ($global:JiraDeployTest.Calls | Where-Object { $_[0] -eq 'webapp' -and $_[1] -eq 'create' })) 'failure must not create an app'
}

try {
    Expect-Failure 'windows' 'Linux App Service plan'
    Expect-Failure 'free' 'Basic (B1)'
    Expect-Failure 'existing' 'App already exists'
    Expect-Failure 'unowned' 'App already exists' -Update
    Expect-Failure 'wrong-plan' 'App already exists' -Update
    Expect-Failure 'cli-failure' 'Azure CLI command failed'
    Expect-Failure 'build-failure' 'Server build failed'
    foreach ($url in @('http://example.atlassian.net', 'https://user:secret@example.atlassian.net', 'https://example.atlassian.net?x=1')) {
        $parameters.JiraBaseUrl = $url
        Expect-Failure 'new' 'JiraBaseUrl must be an HTTPS URL'
    }
    $parameters.JiraBaseUrl = 'https://example.atlassian.net'

    foreach ($mode in @('new', 'existing', 'poc')) {
        $global:JiraDeployTest.Mode = $mode
        $global:JiraDeployTest.Calls.Clear()
        $result = & $deploy @parameters -UpdateExisting:($mode -ne 'new')
        Assert ($result -contains 'MCP endpoint: https://test.invalid/mcp') 'prints verified MCP endpoint'
        $creates = @($global:JiraDeployTest.Calls | Where-Object { $_[1] -eq 'create' })
        Assert ($creates.Count -eq $(if ($mode -eq 'new') { 1 } else { 0 })) 'creates only a new app'
        foreach ($call in $global:JiraDeployTest.Calls) {
            Assert ($call -contains '--subscription') 'all Azure commands specify subscription'
        }
        $deployment = @($global:JiraDeployTest.Calls | Where-Object { $_[1] -eq 'deploy' })
        Assert ($deployment.Count -eq 1) 'deploys exactly once'
        $settings = @($global:JiraDeployTest.Calls | Where-Object { $_ -contains '--settings' })[0]
        Assert ($settings -contains 'MCP_TRANSPORT=http') 'uses HTTP transport'
        Assert (-not ($settings | Where-Object { $_ -match 'CLOUD_(EMAIL|API_TOKEN)=' })) 'never sets credentials'
    }
    Expect-Failure 'deploy-failure' 'Azure CLI command failed' -Update
    Expect-Failure 'bad-health' 'health endpoint did not return status=ok' -Update
    $global:JiraDeployTest.Calls.Clear()
    $result = & $deploy -PackageOnly
    $packageLine = @($result | Where-Object { $_ -like 'Deployment package: *' })[0]
    $global:JiraDeployTest.Packages.Add($packageLine.Substring('Deployment package: '.Length))
    Assert ($global:JiraDeployTest.Calls.Count -eq 0) 'package-only must not call Azure'
    Assert ([bool]($result -match 'Deployment package:')) 'package-only prints ZIP path'
    Write-Output 'Deployment regression checks passed (mocked Azure and npm; no cloud changes).'
} finally {
    foreach ($file in $global:JiraDeployTest.Packages) {
        Remove-Item -LiteralPath $file -Force
    }
    Remove-Variable -Name JiraDeployTest -Scope Global
}
