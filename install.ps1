$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$EnvFile = Join-Path $RootDir ".env"
Set-Location $RootDir

$Node = Get-Command node -ErrorAction SilentlyContinue
$Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $Node -or -not $Npm) {
    Write-Host "Node.js 20.19+ and npm are required for native SelfMusic." -ForegroundColor Red
    Write-Host "Install the LTS/current Node.js release from https://nodejs.org/, then reopen PowerShell."
    exit 1
}
$NodeVersionText = (& $Node.Source --version).Trim().TrimStart('v')
try { $NodeVersion = [version]$NodeVersionText } catch { throw "Could not detect Node.js version: $NodeVersionText" }
if ($NodeVersion -lt [version]"20.19.0") {
    throw "Detected Node.js $NodeVersionText; SelfMusic requires Node.js 20.19 or later."
}

if (-not (Test-Path $EnvFile)) {
    $Template = Join-Path $RootDir ".env.example"
    if (-not (Test-Path $Template)) { throw ".env.example is missing." }
    Copy-Item $Template $EnvFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
} else {
    Write-Host "Found existing .env; existing settings will be preserved."
}

function Get-EnvValue([string]$Name) {
    $Line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') } | Select-Object -First 1
    if ($null -eq $Line) { return "" }
    return (($Line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
}

function Set-EnvValue([string]$Name, [string]$Value) {
    $Lines = [System.Collections.Generic.List[string]]::new()
    $Found = $false
    foreach ($Line in (Get-Content -LiteralPath $EnvFile)) {
        if ($Line.StartsWith($Name + "=")) {
            if (-not $Found) { $Lines.Add($Name + "=" + $Value); $Found = $true }
        } else {
            $Lines.Add($Line)
        }
    }
    if (-not $Found) { $Lines.Add($Name + "=" + $Value) }
    [System.IO.File]::WriteAllText($EnvFile, (($Lines -join [Environment]::NewLine) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Read-Secret([string]$Prompt) {
    $Secure = Read-Host $Prompt -AsSecureString
    $Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr) }
}

function Is-Placeholder([string]$Value, [int]$MinLength) {
    return ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -lt $MinLength -or $Value -match 'replace-with')
}

$Password = Get-EnvValue "SELF_MUSIC_PASSWORD"
if (Is-Placeholder $Password 12) {
    do {
        $Password = Read-Secret "Choose SelfMusic password (12+ characters; input hidden)"
        $Confirm = Read-Secret "Confirm password"
        if ($Password -ne $Confirm) { Write-Host "Passwords did not match." -ForegroundColor Yellow }
        elseif ($Password.Length -lt 12) { Write-Host "Use at least 12 characters." -ForegroundColor Yellow }
    } while ($Password -ne $Confirm -or $Password.Length -lt 12)
    Set-EnvValue "SELF_MUSIC_PASSWORD" $Password
    $Password = $null
    $Confirm = $null
} else {
    Write-Host "Keeping the existing SelfMusic password." -ForegroundColor Green
}

$SessionSecret = Get-EnvValue "SESSION_SECRET"
if (Is-Placeholder $SessionSecret 32) {
    $Bytes = New-Object byte[] 32
    $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
    $SessionSecret = (($Bytes | ForEach-Object { $_.ToString("x2") }) -join "")
    Set-EnvValue "SESSION_SECRET" $SessionSecret
    Write-Host "Generated a new SESSION_SECRET." -ForegroundColor Green
} else {
    Write-Host "Keeping the existing SESSION_SECRET." -ForegroundColor Green
}
$SessionSecret = $null

$MusicDir = Get-EnvValue "MUSIC_DIR"
if ([string]::IsNullOrWhiteSpace($MusicDir)) {
    $MusicDir = "./music"
    Set-EnvValue "MUSIC_DIR" $MusicDir
}
$MusicPath = if ([System.IO.Path]::IsPathRooted($MusicDir)) { $MusicDir } else { Join-Path $RootDir $MusicDir }
New-Item -ItemType Directory -Force -Path $MusicPath, (Join-Path $RootDir "data") | Out-Null

Write-Host ([Environment]::NewLine + "Installing Node dependencies...") -ForegroundColor Cyan
& $Npm.Source install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
Write-Host ([Environment]::NewLine + "Building SelfMusic...") -ForegroundColor Cyan
& $Npm.Source run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }

$LauncherPath = Join-Path $RootDir "selfmusic.ps1"
$ToolsDir = Join-Path $env:LOCALAPPDATA "Programs\SelfMusic"
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
$Quote = [char]34
$CmdBody = '@echo off' + [Environment]::NewLine +
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + $Quote + $LauncherPath + $Quote + ' %*' + [Environment]::NewLine
$CmdPath = Join-Path $ToolsDir "selfmusic.cmd"
[System.IO.File]::WriteAllText($CmdPath, $CmdBody, [System.Text.Encoding]::ASCII)

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ([string]::IsNullOrWhiteSpace($UserPath)) { $UserPath = "" }
$PathEntries = $UserPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if (-not ($PathEntries | Where-Object { $_.TrimEnd('\') -ieq $ToolsDir.TrimEnd('\') })) {
    $NewUserPath = if ($UserPath) { "$UserPath;$ToolsDir" } else { $ToolsDir }
    [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
}
if (($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $ToolsDir.TrimEnd('\') }).Count -eq 0) {
    $env:Path = "$env:Path;$ToolsDir"
}

$DesktopDir = [Environment]::GetFolderPath("Desktop")
if (-not [string]::IsNullOrWhiteSpace($DesktopDir)) {
    $Shell = New-Object -ComObject WScript.Shell
    $ShortcutPath = Join-Path $DesktopDir "SelfMusic.lnk"
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + $Quote + $LauncherPath + $Quote + " start"
    $Shortcut.WorkingDirectory = $RootDir
    $Shortcut.Description = "Start SelfMusic and open the music player"
    $Shortcut.Save()
    Write-Host "Created desktop shortcut: $ShortcutPath" -ForegroundColor Green
}

Write-Host ([Environment]::NewLine + "Native setup complete. Docker is not required.") -ForegroundColor Green
Write-Host "Click the SelfMusic desktop shortcut, or open a NEW PowerShell window and run: selfmusic"
Write-Host "Available commands: selfmusic stop | status | logs | open | remote"
Write-Host "For remote access, install Tailscale on this PC and your phone and sign both into the same tailnet:"
Write-Host "https://tailscale.com/download"
Write-Host "Then run 'selfmusic remote' to try enabling private HTTPS. The tailnet must have MagicDNS and HTTPS certificates enabled."
Write-Host "Keep the PC awake and connected to the internet while listening remotely."
