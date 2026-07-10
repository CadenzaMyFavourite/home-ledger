[CmdletBinding()]
param(
  [switch]$RequireInitializedProject
)

$ErrorActionPreference = "Stop"
$problems = [System.Collections.Generic.List[string]]::new()

function Add-Problem([string]$message) {
  $script:problems.Add($message)
}

function Get-CommandPath([string]$name) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }

  return $command.Source
}

$javaPath = Get-CommandPath "java"
if ($null -eq $javaPath) {
  Add-Problem "Java JDK 17 or later is not available on PATH. Install a JDK and set JAVA_HOME."
} else {
  $javaVersion = (& java -version 2>&1 | Select-Object -First 1)
  Write-Host "PASS Java: $javaPath ($javaVersion)"
}

if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME) -or -not (Test-Path -LiteralPath $env:JAVA_HOME)) {
  Add-Problem "JAVA_HOME is not set to an existing JDK directory."
} else {
  Write-Host "PASS JAVA_HOME: $env:JAVA_HOME"
}

$androidHome = if (-not [string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($androidHome) -or -not (Test-Path -LiteralPath $androidHome)) {
  Add-Problem "ANDROID_HOME (or ANDROID_SDK_ROOT) is not set to an existing Android SDK directory."
} else {
  Write-Host "PASS Android SDK: $androidHome"
}

$sdkManager = Get-CommandPath "sdkmanager"
if ($null -eq $sdkManager) {
  Add-Problem "Android sdkmanager is not on PATH. Install Android SDK Command-line Tools."
} else {
  Write-Host "PASS sdkmanager: $sdkManager"
}

if ([string]::IsNullOrWhiteSpace($env:NDK_HOME) -or -not (Test-Path -LiteralPath $env:NDK_HOME)) {
  Add-Problem "NDK_HOME is not set to an installed Android NDK directory."
} else {
  Write-Host "PASS Android NDK: $env:NDK_HOME"
}

$rustupPath = Get-CommandPath "rustup"
if ($null -eq $rustupPath) {
  Add-Problem "rustup is not available on PATH. Install Rust with rustup."
} else {
  $installedTargets = @(& rustup target list --installed)
  $requiredTargets = @(
    "aarch64-linux-android",
    "armv7-linux-androideabi",
    "i686-linux-android",
    "x86_64-linux-android"
  )
  $missingTargets = @($requiredTargets | Where-Object { $_ -notin $installedTargets })
  if ($missingTargets.Count -gt 0) {
    Add-Problem ("Missing Rust Android targets: " + ($missingTargets -join ", "))
  } else {
    Write-Host "PASS Rust Android targets: $($requiredTargets -join ', ')"
  }
}

$androidProject = Join-Path $PSScriptRoot "..\\src-tauri\\gen\\android"
if (Test-Path -LiteralPath $androidProject) {
  Write-Host "PASS Tauri Android project: $androidProject"
} elseif ($RequireInitializedProject) {
  Add-Problem "Tauri Android project has not been generated. Run: pnpm tauri android init --ci"
} else {
  Write-Host "INFO Tauri Android project is not generated yet. This is expected before 'pnpm tauri android init --ci'."
}

if ($problems.Count -gt 0) {
  Write-Host ""
  Write-Host "Android / Google Play prerequisites are incomplete:" -ForegroundColor Yellow
  foreach ($problem in $problems) {
    Write-Host " - $problem" -ForegroundColor Yellow
  }
  exit 1
}

Write-Host ""
Write-Host "Android / Google Play prerequisites are ready." -ForegroundColor Green
