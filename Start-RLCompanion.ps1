param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dashboardPort = 4176
$helperPort = 49125
$dashboardOrigin = "http://127.0.0.1:$dashboardPort"
$dashboardUrl = "$dashboardOrigin/"
$mutex = $null
$ownsMutex = $false
$dashboardProcess = $null
$helperProcess = $null
# The per-launch token protects the loopback shutdown endpoints from other local callers.
$shutdownToken = [Guid]::NewGuid().ToString("N")
$launcherExitCode = 0

function Test-LocalPortInUse([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-LocalPortReady([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Start-CompanionService([string]$NodePath, [string]$ScriptPath, [string]$Arguments) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $NodePath
    $startInfo.Arguments = ('"{0}" {1}' -f $ScriptPath, $Arguments)
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    # Keep services attached to this console so closing it cannot leave them running.
    $startInfo.CreateNoWindow = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables["RL_COMPANION_SHUTDOWN_TOKEN"] = $shutdownToken

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Windows could not start Node.js service '$([System.IO.Path]::GetFileName($ScriptPath))'."
    }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return $process
}

function Wait-ForService([System.Diagnostics.Process]$Process, [int]$Port, [string]$ServiceName) {
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    while ([DateTime]::UtcNow -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "$ServiceName exited during startup (exit code $($Process.ExitCode)). Check the project files and Node.js installation."
        }
        if (Test-LocalPortReady $Port) {
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw "$ServiceName did not start listening on 127.0.0.1:$Port within 12 seconds."
}

function Request-ServiceShutdown([int]$Port) {
    $request = $null
    $response = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/__shutdown")
        $request.Method = "POST"
        $request.Proxy = $null
        $request.Timeout = 1500
        $request.Headers.Add("X-RL-Companion-Token", $shutdownToken)
        $response = $request.GetResponse()
    } catch {
        Write-Host "Could not send the graceful shutdown request to port $Port."
    } finally {
        if ($response) {
            $response.Close()
        }
    }
}

function Stop-StartedService([System.Diagnostics.Process]$Process, [int]$Port) {
    if (-not $Process) {
        return
    }
    $Process.Refresh()
    if (-not $Process.HasExited) {
        Request-ServiceShutdown $Port
        if (-not $Process.WaitForExit(5000)) {
            Write-Host "A launcher-owned service did not stop in time; closing that process."
            $Process.Kill()
            $Process.WaitForExit()
        }
    }
    $Process.Dispose()
}

try {
    # A named mutex makes an accidental second click a no-op.
    $mutex = New-Object System.Threading.Mutex($false, "Local\RLCompanionOneClickLauncher")
    try {
        $ownsMutex = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        Write-Host "RL COMPANION is already running. Use its launcher window to close it."
        exit 0
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js is required but was not found. Install the current Node.js LTS release, then double-click this launcher again."
    }

    foreach ($port in @($dashboardPort, $helperPort)) {
        if (Test-LocalPortInUse $port) {
            $name = if ($port -eq $dashboardPort) { "dashboard" } else { "MMR helper" }
            throw "The $name port 127.0.0.1:$port is already in use. Close the other app using that port, then try again."
        }
    }

    $dashboardScript = Join-Path $projectRoot "dashboard-server.js"
    $helperScript = Join-Path $projectRoot "mmr-helper.js"
    if (-not (Test-Path -LiteralPath $dashboardScript) -or -not (Test-Path -LiteralPath $helperScript)) {
        throw "A required RL COMPANION service file is missing from '$projectRoot'."
    }

    Write-Host "Starting RL COMPANION..."
    $dashboardProcess = Start-CompanionService $node.Source $dashboardScript ""
    Wait-ForService $dashboardProcess $dashboardPort "Dashboard server"

    $env:RL_MMR_HELPER_PORT = "$helperPort"
    $helperProcess = Start-CompanionService $node.Source $helperScript "--origin $dashboardOrigin"
    Wait-ForService $helperProcess $helperPort "MMR helper"

    Start-Process $dashboardUrl
    Write-Host "Dashboard: $dashboardUrl"
    Write-Host "MMR helper: http://127.0.0.1:$helperPort (loopback only)"
    Write-Host "Close this launcher window to stop both RL COMPANION services."

    while ($true) {
        Start-Sleep -Milliseconds 500
        foreach ($service in @(
            @{ Process = $dashboardProcess; Name = "Dashboard server" },
            @{ Process = $helperProcess; Name = "MMR helper" }
        )) {
            $service.Process.Refresh()
            if ($service.Process.HasExited) {
                if ($service.Process.ExitCode -eq 0) {
                    throw "$($service.Name) stopped. The other service will be shut down too."
                }
                throw "$($service.Name) stopped unexpectedly (exit code $($service.Process.ExitCode)). The other service will be shut down too."
            }
        }
    }
} catch {
    $launcherExitCode = 1
    Write-Host ""
    Write-Host "RL COMPANION: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    try { Stop-StartedService $helperProcess $helperPort } catch {
        $launcherExitCode = 1
        Write-Host "Could not stop the launcher-owned MMR helper: $($_.Exception.Message)" -ForegroundColor Red
    }
    try { Stop-StartedService $dashboardProcess $dashboardPort } catch {
        $launcherExitCode = 1
        Write-Host "Could not stop the launcher-owned dashboard server: $($_.Exception.Message)" -ForegroundColor Red
    }
    if ($mutex) {
        if ($ownsMutex -and $mutex.SafeWaitHandle -and -not $mutex.SafeWaitHandle.IsClosed) {
            try { $mutex.ReleaseMutex() } catch {}
        }
        $mutex.Dispose()
    }
    if ($helperProcess -or $dashboardProcess) {
        Write-Host "RL COMPANION services stopped."
    }
}

exit $launcherExitCode
