$ErrorActionPreference = "Stop"

$repository = "realwarp/FLUX"
$minimumBun = [version]"1.4.4"
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($architecture -notin @("AMD64", "x86_64")) {
  throw "This FLUX release supports Windows x64 only; detected $architecture."
}

$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bun) {
  $versionText = (& bun --version 2>$null | Select-Object -First 1)
  $versionMatch = [regex]::Match($versionText, '^\d+\.\d+\.\d+')
  if (-not $versionMatch.Success -or [version]$versionMatch.Value -lt $minimumBun) {
    $bun = $null
  }
}
if (-not $bun) {
  $consent = Read-Host "FLUX requires Bun $minimumBun or newer. Install Bun using its official installer? [y/N]"
  if ($consent -notin @("y", "Y", "yes", "YES")) {
    throw "Installation cancelled. Install Bun $minimumBun or newer, then rerun the FLUX installer."
  }
  Invoke-Expression (Invoke-RestMethod "https://bun.sh/install.ps1")
  $bunBin = Join-Path $env:USERPROFILE ".bun\bin"
  $env:Path = "$bunBin;$env:Path"
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) { throw "Bun installation did not provide a usable bun command." }
  $installedText = (& bun --version 2>$null | Select-Object -First 1)
  $installedMatch = [regex]::Match($installedText, '^\d+\.\d+\.\d+')
  if (-not $installedMatch.Success -or [version]$installedMatch.Value -lt $minimumBun) {
    throw "The installed Bun version is older than $minimumBun."
  }
}

$requestedTag = $env:FLUX_VERSION
if ($requestedTag) {
  if ($requestedTag -notmatch '^v\d+\.\d+\.\d+(-rc\.\d+)?$') {
    throw "FLUX_VERSION must be a release tag such as v0.1.0 or v0.1.0-rc.1."
  }
  $release = Invoke-RestMethod "https://api.github.com/repos/$repository/releases/tags/$requestedTag"
} else {
  $release = Invoke-RestMethod "https://api.github.com/repos/$repository/releases/latest"
}
$tag = [string]$release.tag_name
if ($tag -notmatch '^v\d+\.\d+\.\d+(-rc\.\d+)?$') { throw "GitHub returned an invalid FLUX release tag." }
if ($requestedTag -and $tag -ne $requestedTag) { throw "GitHub returned $tag instead of requested version $requestedTag." }
$assetName = "flux-$tag-windows-x64.zip"
$releaseUrl = "https://github.com/$repository/releases/download/$tag"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "flux-install-$([guid]::NewGuid().ToString('N'))"
$programRoot = Join-Path $env:LOCALAPPDATA "Programs\FLUX"
$stage = Join-Path $programRoot "stage-$([guid]::NewGuid().ToString('N'))"
$versionRoot = Join-Path $programRoot "versions"
$launcherRoot = Join-Path $env:LOCALAPPDATA "FLUX\bin"

try {
  New-Item -ItemType Directory -Force -Path $tempRoot, $versionRoot, $launcherRoot | Out-Null
  $archive = Join-Path $tempRoot $assetName
  $checksums = Join-Path $tempRoot "SHA256SUMS.txt"
  Invoke-WebRequest -Uri "$releaseUrl/$assetName" -OutFile $archive
  Invoke-WebRequest -Uri "$releaseUrl/SHA256SUMS.txt" -OutFile $checksums
  $checksumLine = Get-Content -LiteralPath $checksums |
    Where-Object { ($_ -split '\s+')[-1] -eq $assetName } |
    Select-Object -First 1
  if (-not $checksumLine) { throw "The release checksum file does not list $assetName." }
  $expectedHash = ($checksumLine -split '\s+')[0].ToLowerInvariant()
  $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw "SHA-256 verification failed. FLUX was not installed." }

  Expand-Archive -LiteralPath $archive -DestinationPath $stage
  Push-Location $stage
  try {
    & bun install --production --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  $version = $tag.TrimStart("v")
  $versionDirectory = Join-Path $versionRoot "$version-$($actualHash.Substring(0, 8))"
  if (Test-Path -LiteralPath $versionDirectory) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  } else {
    Move-Item -LiteralPath $stage -Destination $versionDirectory
  }

  $currentFile = Join-Path $programRoot "current.txt"
  $currentTemporary = "$currentFile.$([guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($currentTemporary, "$version-$($actualHash.Substring(0, 8))`r`n", [Text.Encoding]::ASCII)
  Move-Item -LiteralPath $currentTemporary -Destination $currentFile -Force

  $launcher = @'
@echo off
set "FLUX_ROOT=%LOCALAPPDATA%\Programs\FLUX"
for /f "usebackq delims=" %%v in ("%FLUX_ROOT%\current.txt") do set "FLUX_VERSION=%%v"
if not defined FLUX_VERSION echo FLUX installation is incomplete. Rerun the installer. & exit /b 1
where bun >nul 2>nul
if errorlevel 1 echo Bun is not on PATH. Open a new terminal or reinstall Bun. & exit /b 1
bun run "%FLUX_ROOT%\versions\%FLUX_VERSION%\dist\src\cli.js" %*
'@
  [IO.File]::WriteAllText((Join-Path $launcherRoot "flux.cmd"), $launcher, [Text.Encoding]::ASCII)

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathEntries = @($userPath -split ";" | Where-Object { $_ })
  if (-not ($pathEntries | Where-Object { $_.TrimEnd("\") -ieq $launcherRoot.TrimEnd("\") })) {
    $updatedPath = (@($pathEntries) + $launcherRoot) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")
  }
  if ($env:Path -notlike "*$launcherRoot*") { $env:Path = "$launcherRoot;$env:Path" }

  Write-Host "FLUX $tag installed. Open a new terminal, run 'flux', and choose a model."
  Write-Host "To uninstall the application, remove '$programRoot' and '$launcherRoot'. Your configuration and sessions are kept under '$env:LOCALAPPDATA\FLUX'."
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
