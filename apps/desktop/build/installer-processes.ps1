param(
    [string]$InstallDirectory = '',
    [ValidateSet('Check', 'Stop')][string]$Mode = 'Check',
    [int]$InstallerProcessId = 0,
    [ValidateRange(1, 40)][int]$TimeoutSeconds = 25
)

# Invoked by NSIS with data arguments (-File), never interpolated PowerShell code.
# Normal Desktop exit deliberately leaves the scheduled-task owner alive. An
# install/uninstall is a separate lifecycle boundary and must close that owner.
function Get-SyncThinkInstallRoot {
    param([string]$Directory)
    if ([string]::IsNullOrWhiteSpace($Directory) -or -not [IO.Path]::IsPathRooted($Directory)) {
        throw 'An absolute installation directory is required.'
    }
    $full = [IO.Path]::GetFullPath($Directory).TrimEnd([char[]]'\/')
    $volume = [IO.Path]::GetPathRoot($full).TrimEnd([char[]]'\/')
    if (-not $full -or $full.Equals($volume, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A volume root is not an installation directory.'
    }
    return $full
}

function Test-SyncThinkImagePath {
    param([string]$Actual, [string]$Expected)
    if ([string]::IsNullOrWhiteSpace($Actual)) { return $false }
    try {
        return [IO.Path]::GetFullPath($Actual).Equals($Expected, [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Test-SyncThinkEntryArgument {
    param([string]$CommandLine, [string]$Entry)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    # Require an entire argv token: main.js.extra or an unrelated script whose
    # argument happens to contain the entry filename is not an execution owner.
    $command = $CommandLine.Replace('/', '\')
    $entryPattern = [regex]::Escape($Entry)
    return $command -match ('(?i)^\s*(?:"[^"]*"|[^\s"]+)\s+(?:"' + $entryPattern + '"|' + $entryPattern + ')(?=$|\s)')
}

function Get-SyncThinkInstallTargets {
    param(
        [string]$InstallDirectory,
        [AllowEmptyCollection()][object[]]$Processes,
        [int]$InstallerProcessId = 0
    )
    $root = Get-SyncThinkInstallRoot $InstallDirectory
    $desktop = Join-Path $root 'SYNC-THINK.exe'
    $node = Join-Path $root 'resources\node\node.exe'
    $daemonEntry = Join-Path $root 'resources\runtime\dist\daemon\index.js'
    $runtimeEntry = Join-Path $root 'resources\runtime\dist\main.js'
    foreach ($candidate in $Processes) {
        if ($candidate.ProcessId -eq $InstallerProcessId) { continue }
        $role = $null
        if (Test-SyncThinkImagePath $candidate.ExecutablePath $desktop) { $role = 'desktop' }
        elseif (Test-SyncThinkImagePath $candidate.ExecutablePath $node) {
            if (Test-SyncThinkEntryArgument $candidate.CommandLine $daemonEntry) { $role = 'daemon' }
            elseif (Test-SyncThinkEntryArgument $candidate.CommandLine $runtimeEntry) { $role = 'runtime' }
        }
        if ($role) {
            [pscustomobject]@{
                ProcessId = [int]$candidate.ProcessId
                ParentProcessId = [int]$candidate.ParentProcessId
                ExecutablePath = $candidate.ExecutablePath
                Role = $role
                Snapshot = $candidate
            }
        }
    }
}

function Get-SyncThinkInstallerAncestors {
    param([int]$InstallerProcessId, [AllowEmptyCollection()][object[]]$Processes)
    $protected = New-Object 'System.Collections.Generic.HashSet[int]'
    $byId = @{}
    foreach ($candidate in $Processes) { $byId[[int]$candidate.ProcessId] = $candidate }
    $current = $InstallerProcessId
    while ($current -gt 0 -and $protected.Add($current)) {
        if (-not $byId.ContainsKey($current)) { break }
        $current = [int]$byId[$current].ParentProcessId
    }
    return ,$protected
}

function Get-SyncThinkProcessSnapshot {
    # An inspection error is a failure, not proof that no process is running.
    return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
}

function Stop-SyncThinkInstallTree {
    param([object]$Target, [string]$InstallDirectory, [int]$InstallerProcessId)
    $fresh = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $Target.ProcessId) -ErrorAction Stop)
    if ($fresh.Count -eq 0) { return }
    $validated = @(Get-SyncThinkInstallTargets -InstallDirectory $InstallDirectory -Processes $fresh -InstallerProcessId $InstallerProcessId)
    if ($validated.Count -ne 1 -or $fresh[0].CreationDate -ne $Target.Snapshot.CreationDate) {
        # PID reuse must never turn a checked process into a different target.
        return
    }
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $output = & $taskkill /PID ([string]$Target.ProcessId) /T /F 2>&1
    if ($LASTEXITCODE -ne 0) {
        $left = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $Target.ProcessId) -ErrorAction Stop)
        if ($left.Count -gt 0) { throw ('Process ' + $Target.ProcessId + ': ' + ($output | Out-String).Trim()) }
    }
}

function Invoke-SyncThinkInstallerClosure {
    param([string]$InstallDirectory, [string]$Mode, [int]$InstallerProcessId, [int]$TimeoutSeconds)
    $root = Get-SyncThinkInstallRoot $InstallDirectory
    $snapshot = @(Get-SyncThinkProcessSnapshot)
    $targets = @(Get-SyncThinkInstallTargets -InstallDirectory $root -Processes $snapshot -InstallerProcessId $InstallerProcessId)
    if ($Mode -eq 'Check') {
        return [pscustomobject]@{ok=($targets.Count -eq 0); exitCode=$(if ($targets.Count) {10} else {0}); remaining=@($targets | Select-Object ProcessId, ParentProcessId, Role, ExecutablePath); errors=@()}
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $errors = @()
    $stopped = @()
    $emptyChecks = 0
    # Best-effort window close first. Tray close can merely hide the window, so
    # it is not accepted as successful shutdown without a fresh process check.
    $askedToClose = $false
    foreach ($target in $targets) {
        if ($target.Role -ne 'desktop') { continue }
        try {
            $process = Get-Process -Id $target.ProcessId -ErrorAction Stop
            if ($process.MainWindowHandle -ne 0) {
                $askedToClose = $process.CloseMainWindow() -or $askedToClose
            }
        } catch { }
    }
    if ($askedToClose) { Start-Sleep -Milliseconds 1500 }
    do {
        $snapshot = @(Get-SyncThinkProcessSnapshot)
        $targets = @(Get-SyncThinkInstallTargets -InstallDirectory $root -Processes $snapshot -InstallerProcessId $InstallerProcessId)
        if ($targets.Count -eq 0) {
            $emptyChecks++
            if ($emptyChecks -ge 2) {
                return [pscustomobject]@{ok=$true; exitCode=0; remaining=@(); stopped=@($stopped); errors=@($errors)}
            }
        } else {
            $emptyChecks = 0
            $protected = Get-SyncThinkInstallerAncestors -InstallerProcessId $InstallerProcessId -Processes $snapshot
            $ids = @{}
            foreach ($target in $targets) { $ids[$target.ProcessId] = $true }
            # Stop a daemon's OUTER supervisor as one tree, never its worker
            # first (which would immediately be respawned). Desktop roots go
            # first so their own daemon restart handlers are also gone.
            $roots = @($targets | Where-Object { -not $ids.ContainsKey($_.ParentProcessId) } | Sort-Object @{Expression={switch ($_.Role) {'desktop' {0} 'daemon' {1} default {2}}}})
            foreach ($target in $roots) {
                if ($protected.Contains($target.ProcessId)) { continue }
                try {
                    Stop-SyncThinkInstallTree -Target $target -InstallDirectory $root -InstallerProcessId $InstallerProcessId
                    $stopped += $target.ProcessId
                } catch { $errors += $_.Exception.Message }
            }
        }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    $remaining = @(Get-SyncThinkInstallTargets -InstallDirectory $root -Processes @(Get-SyncThinkProcessSnapshot) -InstallerProcessId $InstallerProcessId)
    return [pscustomobject]@{ok=($remaining.Count -eq 0); exitCode=$(if ($remaining.Count) {20} else {0}); remaining=@($remaining | Select-Object ProcessId, ParentProcessId, Role, ExecutablePath); stopped=@($stopped); errors=@($errors | Select-Object -Unique)}
}

# Dot sourcing only loads the classifiers for non-destructive snapshot tests.
if ($MyInvocation.InvocationName -eq '.') { return }
$ProgressPreference = 'SilentlyContinue'
try {
    $result = Invoke-SyncThinkInstallerClosure -InstallDirectory $InstallDirectory -Mode $Mode -InstallerProcessId $InstallerProcessId -TimeoutSeconds $TimeoutSeconds
    $result | ConvertTo-Json -Depth 6 -Compress
    exit $result.exitCode
} catch {
    [pscustomobject]@{ok=$false; exitCode=30; remaining=@(); error=$_.Exception.Message} | ConvertTo-Json -Depth 4 -Compress
    exit 30
}
