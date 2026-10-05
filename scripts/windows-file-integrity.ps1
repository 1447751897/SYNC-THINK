param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
# Read only the mandatory label (LABEL_SECURITY_INFORMATION), not the privileged
# audit SACL. No ACL, token, policy, or system environment changes are made.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SyncThinkFileLabel {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, EntryPoint="GetNamedSecurityInfoW")]
  public static extern uint Read(string name, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, EntryPoint="ConvertSecurityDescriptorToStringSecurityDescriptorW", SetLastError=true)]
  public static extern bool Convert(IntPtr descriptor, uint revision, uint info, out IntPtr text, out uint length);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LocalFree(IntPtr pointer);
}
"@
$full = [IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $full)) { throw "installer.integrity_path_missing:$full" }
$owner = $group = $dacl = $sacl = $descriptor = $text = [IntPtr]::Zero
try {
  $status = [SyncThinkFileLabel]::Read($full, 1, 0x10, [ref]$owner, [ref]$group, [ref]$dacl, [ref]$sacl, [ref]$descriptor)
  if ($status -ne 0) { throw "installer.integrity_read_failed:$status" }
  $length = [uint32]0
  if (-not [SyncThinkFileLabel]::Convert($descriptor, 1, 0x10, [ref]$text, [ref]$length)) {
    throw "installer.integrity_convert_failed:$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  @{ path = $full; sddl = [Runtime.InteropServices.Marshal]::PtrToStringUni($text) } | ConvertTo-Json -Compress
} finally {
  if ($text -ne [IntPtr]::Zero) { [SyncThinkFileLabel]::LocalFree($text) | Out-Null }
  if ($descriptor -ne [IntPtr]::Zero) { [SyncThinkFileLabel]::LocalFree($descriptor) | Out-Null }
}
