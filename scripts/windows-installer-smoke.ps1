param(
  [string]$BaseInstaller,
  [string]$UpgradeInstaller,
  [string]$UpgradeVersion,
  [string]$SmokeRoot,
  [switch]$SkipOverlayInstall,
  [switch]$LeaveRunning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ReleaseRoot = Join-Path $WorkspaceRoot 'apps\desktop\release'
$SmokeDataRoot = Join-Path $WorkspaceRoot '.data'
$DefaultInstallerDir = Join-Path $ReleaseRoot 'installer'
$DefaultUpgradeInstallerDir = Join-Path $ReleaseRoot 'installer-smoke-upgrade'
$DefaultUpgradePortableDir = Join-Path $ReleaseRoot 'win-unpacked-smoke-upgrade'
$InstallerManifestName = 'installer-manifest.json'
$ExecutableName = 'SYNC-THINK.exe'
$UninstallerName = 'Uninstall SYNC-THINK.exe'
$IdentityMetadataName = 'runtime-identity.json'
$RuntimeReadyMarkers = @('runtime identity ready', 'pipe ready', 'database ready', 'hello accepted')
$DesktopProcess = $null
$LastLaunch = $null
$SmokeCompleted = $false

function Resolve-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Get-WorkspaceRelativePath([string]$Path) {
  $workspaceUri = [Uri]((Resolve-FullPath $WorkspaceRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar)
  $pathUri = [Uri](Resolve-FullPath $Path)
  return [Uri]::UnescapeDataString($workspaceUri.MakeRelativeUri($pathUri).ToString())
}

function Assert-SafeChildPath([string]$Parent, [string]$Candidate, [string]$Code) {
  $parentPath = (Resolve-FullPath $Parent).TrimEnd('\', '/')
  $candidatePath = Resolve-FullPath $Candidate
  $prefix = $parentPath + [System.IO.Path]::DirectorySeparatorChar
  if ($candidatePath.Equals($parentPath, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $candidatePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw $Code
  }
  return $candidatePath
}

function Read-InstallerManifest([string]$Directory) {
  $manifestPath = Join-Path $Directory $InstallerManifestName
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "installer_smoke.manifest_missing:$manifestPath"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.target -ne 'nsis' -or $manifest.platform -ne 'win32' -or $manifest.arch -ne 'x64') {
    throw "installer_smoke.manifest_invalid:$manifestPath"
  }
  if (@($manifest.files).Count -ne 1) {
    throw "installer_smoke.artifact_count_invalid:$manifestPath"
  }
  $artifactPath = Resolve-FullPath (Join-Path $Directory $manifest.files[0].path)
  Assert-SafeChildPath $Directory $artifactPath 'installer_smoke.artifact_outside_manifest_dir' | Out-Null
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "installer_smoke.artifact_missing:$artifactPath"
  }
  return [pscustomobject]@{
    ManifestPath = $manifestPath
    ArtifactPath = $artifactPath
    Version = [string]$manifest.version
    AppId = [string]$manifest.appId
    Signed = [bool]$manifest.signed
  }
}

function Get-DefaultUpgradeVersion([string]$Version) {
  if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$') {
    throw "installer_smoke.base_version_invalid:$Version"
  }
  $patch = [int]$Matches[3] + 1
  return "$($Matches[1]).$($Matches[2]).$patch-smoke"
}

function Invoke-NodeCommand([string[]]$Arguments) {
  & node @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "installer_smoke.node_command_failed:$LASTEXITCODE"
  }
}

function Invoke-Installer([string]$InstallerPath, [string]$Destination) {
  $arguments = @('/S', "/D=$Destination")
  $process = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "installer_smoke.install_failed:$($process.ExitCode):$InstallerPath"
  }
  $executable = Join-Path $Destination $ExecutableName
  $uninstaller = Join-Path $Destination $UninstallerName
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "installer_smoke.desktop_missing:$executable"
  }
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    throw "installer_smoke.uninstaller_missing:$uninstaller"
  }
  return $process.ExitCode
}

function Invoke-Uninstaller([string]$InstallDirectory) {
  $uninstaller = Join-Path $InstallDirectory $UninstallerName
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    throw "installer_smoke.uninstaller_missing:$uninstaller"
  }
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/currentuser', '/S') -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "installer_smoke.uninstall_failed:$($process.ExitCode)"
  }
  return $process.ExitCode
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$FailureCode) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $FailureCode
}

function Get-IdentitySnapshot(
  [string]$UserDataDirectory,
  [string]$DatabasePath,
  [switch]$SkipDatabaseHash
) {
  $metadataPath = Join-Path $UserDataDirectory $IdentityMetadataName
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "installer_smoke.identity_metadata_missing:$metadataPath"
  }
  $identity = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  $ciphertextPath = Join-Path $UserDataDirectory "secure-store\runtime-identity\$($identity.pipeSecretHandle).safe-storage"
  if (-not (Test-Path -LiteralPath $ciphertextPath -PathType Leaf)) {
    throw "installer_smoke.identity_ciphertext_missing:$ciphertextPath"
  }
  if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) {
    throw "installer_smoke.database_missing:$DatabasePath"
  }
  return [pscustomobject]@{
    InstallId = [string]$identity.installId
    PipeSecretHandle = [string]$identity.pipeSecretHandle
    MetadataPath = $metadataPath
    CiphertextPath = $ciphertextPath
    DatabasePath = $DatabasePath
    MetadataSha256 = (Get-FileHash -LiteralPath $metadataPath -Algorithm SHA256).Hash
    CiphertextSha256 = (Get-FileHash -LiteralPath $ciphertextPath -Algorithm SHA256).Hash
    DatabaseSha256 = if ($SkipDatabaseHash) { $null } else { (Get-FileHash -LiteralPath $DatabasePath -Algorithm SHA256).Hash }
    DatabaseBytes = (Get-Item -LiteralPath $DatabasePath).Length
  }
}

function Test-SnapshotContinuity($Expected, $Actual) {
  return [ordered]@{
    identityStable = $Actual.InstallId -eq $Expected.InstallId
    secretHandleStable = $Actual.PipeSecretHandle -eq $Expected.PipeSecretHandle
    metadataStable = $Actual.MetadataSha256 -eq $Expected.MetadataSha256
    ciphertextStable = $Actual.CiphertextSha256 -eq $Expected.CiphertextSha256
    databasePresent = Test-Path -LiteralPath $Actual.DatabasePath -PathType Leaf
  }
}

function Get-RuntimePid([string]$LocalAppDataDirectory, [string]$InstallId) {
  $pidPath = Join-Path $LocalAppDataDirectory "SYNC-THINK\runtime-$InstallId.pid"
  if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { return $null }
  $value = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$value) -and $value -gt 0) {
    return $value
  }
  return $null
}

function Start-SmokeDesktop(
  [string]$InstallDirectory,
  [string]$UserDataDirectory,
  [string]$DatabasePath,
  [string]$LocalAppDataDirectory,
  [string]$Phase,
  [string]$LogsDirectory
) {
  $executable = Join-Path $InstallDirectory $ExecutableName
  $stdoutPath = Join-Path $LogsDirectory "$Phase.stdout.log"
  $stderrPath = Join-Path $LogsDirectory "$Phase.stderr.log"
  $savedDatabasePath = $env:SYNC_THINK_DB_PATH
  $savedForceRestart = $env:SYNC_THINK_RUNTIME_FORCE_RESTART
  $savedLocalAppData = $env:LOCALAPPDATA
  try {
    $env:SYNC_THINK_DB_PATH = $DatabasePath
    $env:SYNC_THINK_RUNTIME_FORCE_RESTART = '1'
    $env:LOCALAPPDATA = $LocalAppDataDirectory
    $process = Start-Process -FilePath $executable `
      -ArgumentList @("--user-data-dir=$UserDataDirectory") `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru
  } finally {
    $env:SYNC_THINK_DB_PATH = $savedDatabasePath
    $env:SYNC_THINK_RUNTIME_FORCE_RESTART = $savedForceRestart
    $env:LOCALAPPDATA = $savedLocalAppData
  }

  try {
    Wait-Until {
      if ($process.HasExited) {
        throw "installer_smoke.desktop_exited_early:${Phase}:$($process.ExitCode)"
      }
      if (-not (Test-Path -LiteralPath $stdoutPath -PathType Leaf)) { return $false }
      $log = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
      if ([string]::IsNullOrEmpty($log)) { return $false }
      foreach ($marker in $RuntimeReadyMarkers) {
        if (-not $log.Contains($marker)) { return $false }
      }
      return $true
    } 90 "installer_smoke.runtime_timeout:$Phase"

    $identity = Get-IdentitySnapshot $UserDataDirectory $DatabasePath -SkipDatabaseHash
    $runtimePid = Get-RuntimePid $LocalAppDataDirectory $identity.InstallId
    if ($null -eq $runtimePid -or $null -eq (Get-Process -Id $runtimePid -ErrorAction SilentlyContinue)) {
      throw "installer_smoke.runtime_pid_missing:$Phase"
    }
    return [pscustomobject]@{
      Phase = $Phase
      Process = $process
      DesktopPid = $process.Id
      RuntimePid = $runtimePid
      StdoutPath = $stdoutPath
      StderrPath = $stderrPath
      Identity = $identity
    }
  } catch {
    $runtimePid = $null
    try {
      $metadataPath = Join-Path $UserDataDirectory $IdentityMetadataName
      if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        $identity = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        $runtimePid = Get-RuntimePid $LocalAppDataDirectory ([string]$identity.installId)
      }
    } catch {}
    if ($null -ne $process -and -not $process.HasExited) {
      $null = $process.CloseMainWindow()
      if (-not $process.WaitForExit(10000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }
    }
    if ($null -ne $runtimePid) {
      Stop-Process -Id $runtimePid -Force -ErrorAction SilentlyContinue
    }
    $installPrefix = $InstallDirectory.TrimEnd([char]'\') + [IO.Path]::DirectorySeparatorChar
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ExecutablePath -and
        ([string]$_.ExecutablePath).StartsWith($installPrefix, [System.StringComparison]::OrdinalIgnoreCase)
      } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    throw
  }
}

function Stop-SmokeDesktop($Launch) {
  if ($null -eq $Launch -or $null -eq $Launch.Process) { return $false }
  $process = $Launch.Process
  if ($process.HasExited) { return $false }
  $null = $process.CloseMainWindow()
  if (-not $process.WaitForExit(20000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
    throw "installer_smoke.desktop_graceful_shutdown_timeout:$($Launch.Phase)"
  }
  Wait-Until {
    $null -eq (Get-Process -Id $Launch.RuntimePid -ErrorAction SilentlyContinue)
  } 20 "installer_smoke.runtime_shutdown_timeout:$($Launch.Phase)"
  return $true
}

function Get-InstalledPackageVersion([string]$InstallDirectory) {
  $packagePath = Join-Path $InstallDirectory 'resources\app\package.json'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { return $null }
  return [string](Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version
}

function Get-RegisteredVersion([string]$InstallDirectory) {
  $uninstallerPath = (Join-Path $InstallDirectory $UninstallerName).ToLowerInvariant()
  $root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (-not (Test-Path -LiteralPath $root)) { return $null }
  foreach ($key in Get-ChildItem -LiteralPath $root) {
    $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    $uninstallString = [string]$entry.UninstallString
    if ($uninstallString -and $uninstallString.ToLowerInvariant().Contains($uninstallerPath)) {
      return [string]$entry.DisplayVersion
    }
  }
  return $null
}

function Remove-SmokeShortcuts([string]$InstallDirectory) {
  $target = (Join-Path $InstallDirectory $ExecutableName).ToLowerInvariant()
  $shortcutCandidates = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SYNC-THINK.lnk'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\SYNC-THINK.lnk')
  )
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in $shortcutCandidates) {
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { continue }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ([string]$shortcut.TargetPath -and $shortcut.TargetPath.ToLowerInvariant() -eq $target) {
      Remove-Item -LiteralPath $shortcutPath -Force
    }
  }
}

function Assert-AllTrue($Checks, [string]$Prefix) {
  foreach ($entry in $Checks.GetEnumerator()) {
    if (-not [bool]$entry.Value) {
      throw "$Prefix.$($entry.Key)"
    }
  }
}

if ($env:OS -ne 'Windows_NT') {
  throw 'installer_smoke.windows_only'
}

$baseManifest = Read-InstallerManifest $DefaultInstallerDir
if ($BaseInstaller) {
  $BaseInstaller = Assert-SafeChildPath $ReleaseRoot $BaseInstaller 'installer_smoke.base_installer_unsafe'
} else {
  $BaseInstaller = $baseManifest.ArtifactPath
}
if (-not (Test-Path -LiteralPath $BaseInstaller -PathType Leaf)) {
  throw "installer_smoke.base_installer_missing:$BaseInstaller"
}

if (-not $UpgradeVersion) {
  $UpgradeVersion = Get-DefaultUpgradeVersion $baseManifest.Version
}
if (-not $UpgradeInstaller) {
  Invoke-NodeCommand @(
    (Join-Path $WorkspaceRoot 'scripts\windows-portable-release.mjs'),
    'stage',
    '--out', $DefaultUpgradePortableDir,
    '--version', $UpgradeVersion
  )
  Invoke-NodeCommand @(
    (Join-Path $WorkspaceRoot 'scripts\windows-installer-release.mjs'),
    'build',
    '--out', $DefaultUpgradeInstallerDir,
    '--prepackaged', $DefaultUpgradePortableDir,
    '--version', $UpgradeVersion
  )
  $upgradeManifest = Read-InstallerManifest $DefaultUpgradeInstallerDir
  $UpgradeInstaller = $upgradeManifest.ArtifactPath
} else {
  $UpgradeInstaller = Assert-SafeChildPath $ReleaseRoot $UpgradeInstaller 'installer_smoke.upgrade_installer_unsafe'
  $upgradeManifest = Read-InstallerManifest (Split-Path -Path $UpgradeInstaller -Parent)
}
if ($upgradeManifest.Version -eq $baseManifest.Version) {
  throw 'installer_smoke.upgrade_version_not_changed'
}
if ($upgradeManifest.Version -ne $UpgradeVersion) {
  throw "installer_smoke.upgrade_version_mismatch:$($upgradeManifest.Version):$UpgradeVersion"
}

if ($SmokeRoot) {
  $SmokeRoot = Assert-SafeChildPath $SmokeDataRoot $SmokeRoot 'installer_smoke.root_unsafe'
} else {
  $SmokeRoot = Join-Path $SmokeDataRoot ("installer-smoke-" + [Guid]::NewGuid().ToString('N'))
}
if (Test-Path -LiteralPath $SmokeRoot) {
  throw "installer_smoke.root_exists:$SmokeRoot"
}

$InstallDirectory = Join-Path $SmokeRoot 'install'
$UserDataDirectory = Join-Path $SmokeRoot 'user-data'
$RuntimeDataDirectory = Join-Path $SmokeRoot 'runtime-data'
$DatabasePath = Join-Path $RuntimeDataDirectory 'sync-think.db'
$LocalAppDataDirectory = Join-Path $SmokeRoot 'local-app-data'
$LogsDirectory = Join-Path $SmokeRoot 'logs'
$ResultPath = Join-Path $SmokeRoot 'smoke-result.json'
New-Item -ItemType Directory -Path $InstallDirectory, $UserDataDirectory, $RuntimeDataDirectory, $LocalAppDataDirectory, $LogsDirectory -Force | Out-Null

$result = [ordered]@{
  schemaVersion = 1
  ok = $false
  baseVersion = $baseManifest.Version
  upgradeVersion = $upgradeManifest.Version
  baseInstaller = Get-WorkspaceRelativePath $BaseInstaller
  upgradeInstaller = Get-WorkspaceRelativePath $UpgradeInstaller
  smokeRoot = Get-WorkspaceRelativePath $SmokeRoot
  install = $null
  overlay = $null
  upgrade = $null
  uninstall = $null
  reinstall = $null
  error = $null
}

try {
  $installExit = Invoke-Installer $BaseInstaller $InstallDirectory
  $LastLaunch = Start-SmokeDesktop $InstallDirectory $UserDataDirectory $DatabasePath $LocalAppDataDirectory 'clean-install' $LogsDirectory
  $DesktopProcess = $LastLaunch.Process
  $cleanIdentity = $LastLaunch.Identity
  Stop-SmokeDesktop $LastLaunch | Out-Null
  $DesktopProcess = $null
  $cleanIdentity = Get-IdentitySnapshot $UserDataDirectory $DatabasePath
  $result.install = [ordered]@{
    installerExit = $installExit
    installedVersion = Get-InstalledPackageVersion $InstallDirectory
    registryVersion = Get-RegisteredVersion $InstallDirectory
    desktopPid = $LastLaunch.DesktopPid
    runtimePid = $LastLaunch.RuntimePid
    installId = $cleanIdentity.InstallId
    pipeSecretHandle = $cleanIdentity.PipeSecretHandle
    metadataSha256 = $cleanIdentity.MetadataSha256
    ciphertextSha256 = $cleanIdentity.CiphertextSha256
    databaseSha256 = $cleanIdentity.DatabaseSha256
    databaseBytes = $cleanIdentity.DatabaseBytes
    runtimeReady = $true
  }
  Assert-AllTrue ([ordered]@{
    installerExit = $installExit -eq 0
    installedVersion = $result.install.installedVersion -eq $baseManifest.Version
    registryVersion = $result.install.registryVersion -eq $baseManifest.Version
  }) 'installer_smoke.clean_install'

  if (-not $SkipOverlayInstall) {
    $overlayExit = Invoke-Installer $BaseInstaller $InstallDirectory
    $LastLaunch = Start-SmokeDesktop $InstallDirectory $UserDataDirectory $DatabasePath $LocalAppDataDirectory 'overlay-install' $LogsDirectory
    $DesktopProcess = $LastLaunch.Process
    $overlayContinuity = Test-SnapshotContinuity $cleanIdentity $LastLaunch.Identity
    Stop-SmokeDesktop $LastLaunch | Out-Null
    $DesktopProcess = $null
    $result.overlay = [ordered]@{
      installerExit = $overlayExit
      installedVersion = Get-InstalledPackageVersion $InstallDirectory
      registryVersion = Get-RegisteredVersion $InstallDirectory
      desktopPid = $LastLaunch.DesktopPid
      runtimePid = $LastLaunch.RuntimePid
      runtimeReady = $true
      identityStable = $overlayContinuity.identityStable
      secretHandleStable = $overlayContinuity.secretHandleStable
      metadataStable = $overlayContinuity.metadataStable
      ciphertextStable = $overlayContinuity.ciphertextStable
      databasePresent = $overlayContinuity.databasePresent
    }
    Assert-AllTrue $overlayContinuity 'installer_smoke.overlay'
  }

  $upgradeExit = Invoke-Installer $UpgradeInstaller $InstallDirectory
  $LastLaunch = Start-SmokeDesktop $InstallDirectory $UserDataDirectory $DatabasePath $LocalAppDataDirectory 'upgrade' $LogsDirectory
  $DesktopProcess = $LastLaunch.Process
  $upgradeContinuity = Test-SnapshotContinuity $cleanIdentity $LastLaunch.Identity
  Stop-SmokeDesktop $LastLaunch | Out-Null
  $DesktopProcess = $null
  $result.upgrade = [ordered]@{
    installerExit = $upgradeExit
    installedVersion = Get-InstalledPackageVersion $InstallDirectory
    registryVersion = Get-RegisteredVersion $InstallDirectory
    desktopPid = $LastLaunch.DesktopPid
    runtimePid = $LastLaunch.RuntimePid
    runtimeReady = $true
    identityStable = $upgradeContinuity.identityStable
    secretHandleStable = $upgradeContinuity.secretHandleStable
    metadataStable = $upgradeContinuity.metadataStable
    ciphertextStable = $upgradeContinuity.ciphertextStable
    databasePresent = $upgradeContinuity.databasePresent
  }
  Assert-AllTrue $upgradeContinuity 'installer_smoke.upgrade'
  Assert-AllTrue ([ordered]@{
    installedVersion = $result.upgrade.installedVersion -eq $upgradeManifest.Version
    registryVersion = $result.upgrade.registryVersion -eq $upgradeManifest.Version
  }) 'installer_smoke.upgrade_version'

  $uninstallExit = Invoke-Uninstaller $InstallDirectory
  Wait-Until {
    -not (Test-Path -LiteralPath (Join-Path $InstallDirectory $ExecutableName) -PathType Leaf)
  } 30 'installer_smoke.executable_not_removed'
  $uninstallChecks = [ordered]@{
    executableRemoved = -not (Test-Path -LiteralPath (Join-Path $InstallDirectory $ExecutableName) -PathType Leaf)
    userDataPreserved = Test-Path -LiteralPath $UserDataDirectory -PathType Container
    metadataPreserved = Test-Path -LiteralPath $cleanIdentity.MetadataPath -PathType Leaf
    ciphertextPreserved = Test-Path -LiteralPath $cleanIdentity.CiphertextPath -PathType Leaf
    databasePreserved = Test-Path -LiteralPath $DatabasePath -PathType Leaf
  }
  $result.uninstall = [ordered]@{
    uninstallerExit = $uninstallExit
    executableRemoved = $uninstallChecks.executableRemoved
    userDataPreserved = $uninstallChecks.userDataPreserved
    metadataPreserved = $uninstallChecks.metadataPreserved
    ciphertextPreserved = $uninstallChecks.ciphertextPreserved
    databasePreserved = $uninstallChecks.databasePreserved
  }
  Assert-AllTrue $uninstallChecks 'installer_smoke.uninstall'

  $reinstallExit = Invoke-Installer $UpgradeInstaller $InstallDirectory
  $LastLaunch = Start-SmokeDesktop $InstallDirectory $UserDataDirectory $DatabasePath $LocalAppDataDirectory 'reinstall' $LogsDirectory
  $DesktopProcess = $LastLaunch.Process
  $reinstallContinuity = Test-SnapshotContinuity $cleanIdentity $LastLaunch.Identity
  $result.reinstall = [ordered]@{
    installerExit = $reinstallExit
    installedVersion = Get-InstalledPackageVersion $InstallDirectory
    registryVersion = Get-RegisteredVersion $InstallDirectory
    desktopPid = $LastLaunch.DesktopPid
    runtimePid = $LastLaunch.RuntimePid
    runtimeReady = $true
    identityStable = $reinstallContinuity.identityStable
    secretHandleStable = $reinstallContinuity.secretHandleStable
    metadataStable = $reinstallContinuity.metadataStable
    ciphertextStable = $reinstallContinuity.ciphertextStable
    databasePresent = $reinstallContinuity.databasePresent
  }
  Assert-AllTrue $reinstallContinuity 'installer_smoke.reinstall'
  Assert-AllTrue ([ordered]@{
    installedVersion = $result.reinstall.installedVersion -eq $upgradeManifest.Version
    registryVersion = $result.reinstall.registryVersion -eq $upgradeManifest.Version
  }) 'installer_smoke.reinstall_version'

  if (-not $LeaveRunning) {
    Stop-SmokeDesktop $LastLaunch | Out-Null
    $DesktopProcess = $null
  }
  $result.ok = $true
  $SmokeCompleted = $true
} catch {
  $result.error = $_.Exception.Message
  throw
} finally {
  if (-not $SmokeCompleted -and $null -ne $LastLaunch) {
    try {
      Stop-SmokeDesktop $LastLaunch | Out-Null
    } catch {
      if ($null -ne $DesktopProcess -and -not $DesktopProcess.HasExited) {
        Stop-Process -Id $DesktopProcess.Id -Force -ErrorAction SilentlyContinue
      }
      if ($null -ne $LastLaunch.RuntimePid) {
        Stop-Process -Id $LastLaunch.RuntimePid -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Remove-SmokeShortcuts $InstallDirectory
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  Write-Output ($result | ConvertTo-Json -Depth 8)
  Write-Output "[installer-smoke] result: $ResultPath"
}
