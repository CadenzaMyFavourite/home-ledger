$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$artifacts = Join-Path $workspace "artifacts\desktop-e2e"
$appDataPath = Join-Path $env:APPDATA "com.homeledger.desktop-e2e"
$localAppDataPath = Join-Path $env:LOCALAPPDATA "com.homeledger.desktop-e2e"
$desktopE2eCapabilitySource = Join-Path $workspace "tests\desktop\desktop-e2e.capability.json"
$desktopE2eCapabilityDestination = Join-Path $workspace "src-tauri\capabilities\desktop-e2e.json"
$expectedArtifactSuffix = "home-ledger\artifacts\desktop-e2e"
if (-not $artifacts.EndsWith($expectedArtifactSuffix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected artifact path: $artifacts"
}
if (Test-Path -LiteralPath $artifacts) {
    Remove-Item -LiteralPath $artifacts -Recurse -Force
}
New-Item -ItemType Directory -Path $artifacts | Out-Null

$testDataPaths = @(
    $appDataPath,
    $localAppDataPath
)
foreach ($testDataPath in $testDataPaths) {
    $leaf = Split-Path -Leaf $testDataPath
    if ($leaf -ne "com.homeledger.desktop-e2e") {
        throw "Refusing to clean unexpected app data path: $testDataPath"
    }
    if (Test-Path -LiteralPath $testDataPath) {
        Remove-Item -LiteralPath $testDataPath -Recurse -Force
    }
}

function Wait-ForDesktopE2eRestartBoundary {
    param(
        [Parameter(Mandatory = $true)]
        [string] $DataPath,
        [Parameter(Mandatory = $true)]
        [string] $ApplicationPath
    )

    $pendingMarker = Join-Path $DataPath "restore-pending.json"
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $running = @(Get-Process -Name "home-ledger" -ErrorAction SilentlyContinue | Where-Object {
                try {
                    $_.Path -and ((Resolve-Path -LiteralPath $_.Path).Path -ieq $ApplicationPath)
                }
                catch {
                    $false
                }
            })
        if ($running.Count -eq 0 -and (Test-Path -LiteralPath $pendingMarker)) {
            return
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    $processCount = @(Get-Process -Name "home-ledger" -ErrorAction SilentlyContinue).Count
    $markerState = if (Test-Path -LiteralPath $pendingMarker) { "present" } else { "missing" }
    throw "Desktop E2E did not reach the restart boundary. pending marker is $markerState; home-ledger process count is $processCount."
}

Push-Location $workspace
try {
    if (-not (Test-Path -LiteralPath $desktopE2eCapabilitySource)) {
        throw "Missing desktop E2E capability template: $desktopE2eCapabilitySource"
    }
    Copy-Item -LiteralPath $desktopE2eCapabilitySource -Destination $desktopE2eCapabilityDestination -Force

    $ErrorActionPreference = "Continue"
    & pnpm tauri build --debug --no-bundle --features desktop-e2e --config src-tauri/tauri.desktop-e2e.conf.json 2>&1 |
        Tee-Object -FilePath (Join-Path $artifacts "build.log")
    $buildExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($buildExitCode -ne 0) { throw "Desktop E2E build failed with exit code $buildExitCode" }

    $ErrorActionPreference = "Continue"
    & pnpm exec wdio run wdio.desktop.conf.ts --spec tests/desktop/desktop-main.desktop.e2e.ts 2>&1 |
        Tee-Object -FilePath (Join-Path $artifacts "phase-1.log")
    $phaseOneExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($phaseOneExitCode -ne 0) { throw "Desktop E2E phase 1 failed with exit code $phaseOneExitCode" }
    $application = (Resolve-Path "src-tauri\target\debug\home-ledger.exe").Path
    Wait-ForDesktopE2eRestartBoundary -DataPath $appDataPath -ApplicationPath $application

    $ErrorActionPreference = "Continue"
    & pnpm exec wdio run wdio.desktop.conf.ts --spec tests/desktop/desktop-restore.desktop.e2e.ts 2>&1 |
        Tee-Object -FilePath (Join-Path $artifacts "phase-2.log")
    $phaseTwoExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($phaseTwoExitCode -ne 0) { throw "Desktop E2E phase 2 failed with exit code $phaseTwoExitCode" }
}
finally {
    if (Test-Path -LiteralPath $desktopE2eCapabilityDestination) {
        Remove-Item -LiteralPath $desktopE2eCapabilityDestination -Force
    }
    Pop-Location
}
