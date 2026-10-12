$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$EnvFile = Join-Path $RootDir ".env"
Set-Location $RootDir

function Show-DockerHelp {
    Write-Host "ERROR: Docker Desktop and Docker Compose are required." -ForegroundColor Red
    Write-Host "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Write-Host "Compose guide: https://docs.docker.com/compose/install/"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Show-DockerHelp
    exit 1
}
try {
    docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Compose is not available" }
} catch {
    Show-DockerHelp
    exit 1
}

if (-not (Test-Path $EnvFile)) {
    $Template = Join-Path $RootDir ".env.example"
    if (-not (Test-Path $Template)) { throw ".env.example is missing." }
    Copy-Item $Template $EnvFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
} else {
    Write-Host "Found existing .env; valid settings will be preserved."
}

function Get-EnvValue([string]$Name) {
    $Line = Get-Content $EnvFile | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') } | Select-Object -First 1
    if ($null -eq $Line) { return "" }
    return ($Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}
function Set-EnvValue([string]$Name, [string]$Value) {
    $Lines = [System.Collections.Generic.List[string]]::new()
    $Found = $false
    foreach ($Line in (Get-Content $EnvFile)) {
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
    $Password = $null; $Confirm = $null
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

$TsKey = Get-EnvValue "TS_AUTHKEY"
if ([string]::IsNullOrWhiteSpace($TsKey) -or $TsKey -match 'replace-with') {
    Write-Host "Create a reusable Tailscale auth key: https://login.tailscale.com/admin/settings/keys"
    Write-Host "Allow tag:selfmusic in your tailnet policy."
    $TsKey = Read-Secret "Paste Tailscale auth key (input hidden)"
    if ([string]::IsNullOrWhiteSpace($TsKey)) {
        Write-Host "TS_AUTHKEY is required for remote access. Re-run this script after creating a key." -ForegroundColor Red
        exit 1
    }
    Set-EnvValue "TS_AUTHKEY" $TsKey
    $TsKey = $null
} else {
    Write-Host "Keeping the existing Tailscale auth key." -ForegroundColor Green
}

$MusicHostDir = Get-EnvValue "MUSIC_HOST_DIR"
if ([string]::IsNullOrWhiteSpace($MusicHostDir)) { $MusicHostDir = "./music"; Set-EnvValue "MUSIC_HOST_DIR" $MusicHostDir }
$MusicPath = if ([System.IO.Path]::IsPathRooted($MusicHostDir)) { $MusicHostDir } else { Join-Path $RootDir $MusicHostDir }
New-Item -ItemType Directory -Force -Path $MusicPath, (Join-Path $RootDir "data") | Out-Null

Write-Host "`nBuilding and starting SelfMusic + Tailscale..." -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed. Check .env and Docker Desktop." }

Write-Host "`nSelfMusic containers started." -ForegroundColor Green
Write-Host "Install Tailscale on your phone and sign in to the same tailnet:"
Write-Host "https://tailscale.com/download"
Start-Sleep -Seconds 3
$TailIp = docker compose exec -T tailscale tailscale ip -4 2>$null | Select-Object -First 1
if ($TailIp) {
    Write-Host ("Open on your phone: http://" + $TailIp + ":8787") -ForegroundColor Green
    Write-Host "Or, if MagicDNS is enabled: http://selfmusic:8787"
} else {
    Write-Host "Tailscale is still connecting. Run .\selfmusic.sh status or docker compose logs -f tailscale" -ForegroundColor Yellow
}
Write-Host "Sign in with your SelfMusic password. Keep this computer running for remote playback."
Write-Host "For an app-like experience, open the address on your phone and choose Add to Home Screen / Install app."
