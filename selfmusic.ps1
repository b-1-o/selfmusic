param(
    [ValidateSet("start", "stop", "off", "restart", "status", "logs", "open", "remote")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$EnvFile = Join-Path $RootDir ".env"
$DataDir = Join-Path $RootDir "data"
$PidFile = Join-Path $DataDir "selfmusic.pid"
$LogFile = Join-Path $DataDir "selfmusic.log"
$ErrorLogFile = Join-Path $DataDir "selfmusic-error.log"
$ServerScript = Join-Path $RootDir "server\index.js"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function Get-EnvValue([string]$Name) {
    if (-not (Test-Path $EnvFile)) { return "" }
    $Line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') } | Select-Object -First 1
    if ($null -eq $Line) { return "" }
    return (($Line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
}

$Port = Get-EnvValue "PORT"
if ([string]::IsNullOrWhiteSpace($Port)) { $Port = "8787" }
$LocalUrl = "http://127.0.0.1:$Port/api/health"
$BrowserUrl = "http://localhost:$Port"

function Test-SelfMusicHealth {
    try {
        $Response = Invoke-WebRequest -Uri $LocalUrl -UseBasicParsing -TimeoutSec 2
        return ($Response.StatusCode -eq 200 -and $Response.Content -match '"app"\s*:\s*"SelfMusic"')
    } catch {
        return $false
    }
}

function Get-SelfMusicProcess {
    if (-not (Test-Path $PidFile)) { return $null }
    $RawPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $ParsedPid = 0
    if (-not [int]::TryParse($RawPid, [ref]$ParsedPid)) {
        Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
        return $null
    }
    $Process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ParsedPid) -ErrorAction SilentlyContinue
    if ($null -ne $Process -and $Process.CommandLine -and $Process.CommandLine.IndexOf($ServerScript, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $Process
    }
    Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
    return $null
}

function Get-TailscaleExecutable {
    $Command = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($Command) { return $Command.Source }
    $KnownPath = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path $KnownPath) { return $KnownPath }
    return $null
}

function Show-Addresses {
    Write-Host "Local: $BrowserUrl"
    $Tailscale = Get-TailscaleExecutable
    if ($Tailscale) {
        try {
            $Ip = (& $Tailscale ip -4 2>$null | Select-Object -First 1)
            if ($LASTEXITCODE -eq 0 -and $Ip) {
                Write-Host "Private Tailscale address: http://$($Ip.Trim()):$Port"
                $ServeStatus = (& $Tailscale serve status 2>$null | Out-String)
                $Match = [regex]::Match($ServeStatus, 'https://[A-Za-z0-9.-]+(?::[0-9]+)?')
                if ($Match.Success) { Write-Host "Tailscale HTTPS address: $($Match.Value)" }
            }
        } catch { }
    }
    Write-Host "Do not port-forward this app directly to the public internet."
}

function Start-SelfMusic {
    if (Test-SelfMusicHealth) {
        Write-Host "SelfMusic is already running." -ForegroundColor Green
        Show-Addresses
        Start-Process $BrowserUrl
        return
    }
    if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
        throw "Dependencies are missing. Run install.ps1 first."
    }
    if (-not (Test-Path (Join-Path $RootDir "dist\index.html"))) {
        Write-Host "Building frontend..."
        Push-Location $RootDir
        try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." } }
        finally { Pop-Location }
    }
    $Node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $Node) { throw "Node.js is not installed or is not on PATH." }

    $OldNodeEnv = $env:NODE_ENV
    $OldPort = $env:PORT
    $env:NODE_ENV = "development"
    $env:PORT = "$Port"
    try {
        $Process = Start-Process -FilePath $Node.Source -ArgumentList ('"' + $ServerScript + '"') -WorkingDirectory $RootDir -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile -WindowStyle Hidden -PassThru
    } finally {
        if ($null -eq $OldNodeEnv) { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue } else { $env:NODE_ENV = $OldNodeEnv }
        if ($null -eq $OldPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $OldPort }
    }
    Set-Content -LiteralPath $PidFile -Value $Process.Id -NoNewline

    for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
        if (Test-SelfMusicHealth) {
            Write-Host "SelfMusic is running." -ForegroundColor Green
            Show-Addresses
            Start-Process $BrowserUrl
            return
        }
        $Process.Refresh()
        if ($Process.HasExited) {
            Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
            $Recent = @()
            if (Test-Path $LogFile) { $Recent += Get-Content $LogFile -Tail 30 }
            if (Test-Path $ErrorLogFile) { $Recent += Get-Content $ErrorLogFile -Tail 30 }
            throw "SelfMusic exited during startup: $($Recent -join '; ')"
        }
        Start-Sleep -Seconds 1
    }
    Write-Warning "SelfMusic is still starting. Check data\selfmusic.log and data\selfmusic-error.log."
    Show-Addresses
    Start-Process $BrowserUrl
}

function Stop-SelfMusic {
    $Process = Get-SelfMusicProcess
    if ($Process) {
        Stop-Process -Id $Process.ProcessId
        try { Wait-Process -Id $Process.ProcessId -Timeout 10 -ErrorAction Stop } catch { }
        Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
        Write-Host "SelfMusic stopped. Your music files are unchanged." -ForegroundColor Green
    } elseif (Test-SelfMusicHealth) {
        Write-Warning "SelfMusic is responding, but this launcher does not own its process ID. Stop the process that started it."
    } else {
        Write-Host "SelfMusic is not running."
    }
}

switch ($Action) {
    "start" { Start-SelfMusic }
    "stop" { Stop-SelfMusic }
    "off" { Stop-SelfMusic }
    "restart" {
        Stop-SelfMusic
        Start-SelfMusic
    }
    "status" {
        if (Test-SelfMusicHealth) { Write-Host "SelfMusic is responding." -ForegroundColor Green }
        else { Write-Host "SelfMusic is not responding." -ForegroundColor Yellow }
        $Process = Get-SelfMusicProcess
        if ($Process) { Write-Host "Process ID: $($Process.ProcessId)" }
        Show-Addresses
    }
    "logs" {
        if (Test-Path $LogFile) { Get-Content -LiteralPath $LogFile -Tail 60 -Wait }
        else { Write-Host "No log yet. Start SelfMusic first." }
    }
    "open" {
        if (Test-SelfMusicHealth) { Start-Process $BrowserUrl }
        else { throw "SelfMusic is not running. Run selfmusic start first." }
    }
    "remote" {
        $Tailscale = Get-TailscaleExecutable
        if (-not $Tailscale) { throw "Install Tailscale on this PC and your phone, then sign both into the same tailnet: https://tailscale.com/download" }
        if (-not (Test-SelfMusicHealth)) { Start-SelfMusic }
        Write-Host "Trying to enable private HTTPS with Tailscale Serve..."
        & $Tailscale serve --bg "$Port"
        if ($LASTEXITCODE -eq 0) { & $Tailscale serve status }
        else {
            Write-Warning "Tailscale Serve may require MagicDNS and HTTPS certificates to be enabled in the tailnet admin console."
            & $Tailscale ip -4
            Write-Host "HTTPS setup guide: https://tailscale.com/docs/how-to/set-up-https-certificates"
        }
    }
}
