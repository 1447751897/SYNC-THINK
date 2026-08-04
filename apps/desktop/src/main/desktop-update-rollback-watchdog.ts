export const DESKTOP_UPDATE_ROLLBACK_WATCHDOG_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)][string]$IntentPath,
  [Parameter(Mandatory = $true)][string]$RecoveryRoot
)

$ErrorActionPreference = 'Stop'

function FullPath([string]$Value) {
  return [System.IO.Path]::GetFullPath($Value)
}

function IsWithin([string]$Root, [string]$Candidate) {
  $rootFull = (FullPath $Root).TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
  $candidateFull = FullPath $Candidate
  return $candidateFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function WriteAtomicJson([string]$Path, [object]$Value) {
  $parent = [System.IO.Path]::GetDirectoryName($Path)
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
  $temporary = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
  try {
    [System.IO.File]::Move($temporary, $Path)
  } catch [System.IO.IOException] {
    if (-not [System.IO.File]::Exists($Path)) { throw }
    [System.IO.File]::Replace($temporary, $Path, $null)
  }
}

function RecordOutcome([object]$Intent, [string]$Status, [bool]$Attempted, [string]$Reason, [Nullable[int]]$ExitCode) {
  WriteAtomicJson $Intent.outcomePath ([ordered]@{
    schemaVersion = 1
    intentId = [string]$Intent.intentId
    previousVersion = [string]$Intent.previousVersion
    targetVersion = [string]$Intent.targetVersion
    recordedAt = [DateTime]::UtcNow.ToString('o')
    status = $Status
    automaticRollbackAttempted = $Attempted
    reason = if ($Reason) { $Reason } else { $null }
    installerExitCode = $ExitCode
  })
}

function ClearActiveIntent([object]$Intent) {
  $activePath = Join-Path $RecoveryRoot 'active-intent.json'
  if (-not (Test-Path -LiteralPath $activePath)) { return }
  try {
    $active = Get-Content -Raw -LiteralPath $activePath | ConvertFrom-Json
    if ([string]$active.intentId -eq [string]$Intent.intentId) {
      Remove-Item -LiteralPath $activePath -Force
    }
  } catch {}
}

function ProcessRunningFromPath([string]$Path) {
  $full = FullPath $Path
  $matches = @(Get-CimInstance Win32_Process -Filter "Name='$([System.IO.Path]::GetFileName($full).Replace("'", "''"))'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and (FullPath ([string]$_.ExecutablePath)) -eq $full
  })
  return $matches.Count -gt 0
}

function CreateOneShotFence([string]$Path, [object]$Value) {
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path)) | Out-Null
  try {
    $fence = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $payload = [System.Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json))
      $fence.Write($payload, 0, $payload.Length)
    } finally {
      $fence.Dispose()
    }
    return $true
  } catch [System.IO.IOException] {
    return $false
  }
}

$intent = $null
try {
  if (-not (IsWithin $RecoveryRoot $IntentPath)) { throw 'intent-path-outside-root' }
  $intent = Get-Content -Raw -LiteralPath $IntentPath | ConvertFrom-Json
  if ([int]$intent.schemaVersion -ne 1) { throw 'intent-schema-invalid' }
  if (-not (IsWithin $RecoveryRoot ([string]$intent.healthMarkerPath))) { throw 'health-path-outside-root' }
  if (-not (IsWithin $RecoveryRoot ([string]$intent.watchdogReadyPath))) { throw 'watchdog-ready-path-outside-root' }
  if (-not (IsWithin $RecoveryRoot ([string]$intent.relaunchFencePath))) { throw 'relaunch-path-outside-root' }
  if (-not (IsWithin $RecoveryRoot ([string]$intent.attemptFencePath))) { throw 'attempt-path-outside-root' }
  if (-not (IsWithin $RecoveryRoot ([string]$intent.outcomePath))) { throw 'outcome-path-outside-root' }
  $installer = [string]$intent.previousRelease.installer.path
  if (-not (IsWithin (Join-Path $RecoveryRoot 'installers') $installer)) { throw 'installer-path-outside-root' }
  $targetExecutable = FullPath ([string]$intent.targetExecutablePath)
  if (-not [System.IO.Path]::IsPathRooted($targetExecutable)) { throw 'target-executable-path-invalid' }
  $targetPackage = Join-Path ([System.IO.Path]::GetDirectoryName($targetExecutable)) 'resources\app\package.json'
  WriteAtomicJson ([string]$intent.watchdogReadyPath) ([ordered]@{
    schemaVersion = 1
    intentId = [string]$intent.intentId
    readyAt = [DateTime]::UtcNow.ToString('o')
  })

  $deadline = [DateTime]::Parse([string]$intent.deadlineAt).ToUniversalTime()
  $relaunchAttempted = Test-Path -LiteralPath ([string]$intent.relaunchFencePath)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath ([string]$intent.healthMarkerPath)) {
      try {
        $marker = Get-Content -Raw -LiteralPath ([string]$intent.healthMarkerPath) | ConvertFrom-Json
        if ([int]$marker.schemaVersion -eq 1 -and [string]$marker.intentId -eq [string]$intent.intentId -and [string]$marker.targetVersion -eq [string]$intent.targetVersion) {
          RecordOutcome $intent 'healthy' $false '' $null
          ClearActiveIntent $intent
          exit 0
        }
      } catch {}
    }
    if (-not $relaunchAttempted -and (Test-Path -LiteralPath $targetExecutable) -and (Test-Path -LiteralPath $targetPackage)) {
      try {
        $targetProjection = Get-Content -Raw -LiteralPath $targetPackage | ConvertFrom-Json
        $installerRunning = $false
        if ([string]$intent.targetDownloadedFile) {
          $installerRunning = ProcessRunningFromPath ([string]$intent.targetDownloadedFile)
        }
        if ([string]$targetProjection.version -eq [string]$intent.targetVersion -and -not $installerRunning -and -not (ProcessRunningFromPath $targetExecutable)) {
          $relaunchAttempted = CreateOneShotFence ([string]$intent.relaunchFencePath) ([ordered]@{
            schemaVersion = 1
            intentId = [string]$intent.intentId
            attemptedAt = [DateTime]::UtcNow.ToString('o')
            targetVersion = [string]$intent.targetVersion
          })
          if ($relaunchAttempted) {
            try {
              Start-Process -FilePath $targetExecutable -ArgumentList @('--updated') -WorkingDirectory ([System.IO.Path]::GetDirectoryName($targetExecutable)) | Out-Null
            } catch {}
          }
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 500
  }

  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName([string]$intent.attemptFencePath)) | Out-Null
  try {
    $fence = [System.IO.File]::Open([string]$intent.attemptFencePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $payloadText = (@{ schemaVersion = 1; intentId = [string]$intent.intentId; attemptedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json)
      $payload = [System.Text.Encoding]::UTF8.GetBytes($payloadText)
      $fence.Write($payload, 0, $payload.Length)
    } finally {
      $fence.Dispose()
    }
  } catch [System.IO.IOException] {
    RecordOutcome $intent 'rejected' $false 'attempt-already-recorded' $null
    ClearActiveIntent $intent
    exit 12
  }

  $item = Get-Item -LiteralPath $installer
  if ([int64]$item.Length -ne [int64]$intent.previousRelease.installer.bytes) { throw 'installer-bytes-mismatch' }
  $hash = (Get-FileHash -Algorithm SHA512 -LiteralPath $installer).Hash.ToLowerInvariant()
  if ($hash -ne ([string]$intent.previousRelease.installer.sha512).ToLowerInvariant()) { throw 'installer-hash-mismatch' }

  if ([bool]$intent.allowUnsignedFixture) {
    if ([string]$intent.previousRelease.installer.signature.status -ne 'unsigned-fixture') { throw 'fixture-signature-projection-invalid' }
  } else {
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ([string]$signature.Status -ne 'Valid') { throw 'installer-signature-invalid' }
    if ($null -eq $signature.SignerCertificate) { throw 'installer-signer-missing' }
    if ($null -eq $signature.TimeStamperCertificate) { throw 'installer-timestamp-missing' }
    $thumbprint = ([string]$signature.SignerCertificate.Thumbprint).Replace(' ', '').ToUpperInvariant()
    $expected = ([string]$intent.previousRelease.installer.signature.signerThumbprint).Replace(' ', '').ToUpperInvariant()
    if (-not $expected -or $thumbprint -ne $expected) { throw 'installer-signer-mismatch' }
  }

  $process = Start-Process -FilePath $installer -ArgumentList @('/S', '--updated', '--force-run') -PassThru -Wait -WindowStyle Hidden
  $exitCode = [int]$process.ExitCode
  if ($exitCode -eq 0) {
    RecordOutcome $intent 'rolled-back' $true '' $exitCode
    ClearActiveIntent $intent
    exit 0
  }
  RecordOutcome $intent 'rollback-failed' $true 'installer-exit-nonzero' $exitCode
  ClearActiveIntent $intent
  exit 20
} catch {
  try {
    if ($null -ne $intent) {
      RecordOutcome $intent 'rejected' (Test-Path -LiteralPath ([string]$intent.attemptFencePath)) $_.Exception.Message $null
      ClearActiveIntent $intent
    }
  } catch {}
  exit 30
}
`;
