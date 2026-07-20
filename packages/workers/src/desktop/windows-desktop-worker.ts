import { execFile } from 'node:child_process';
import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';

export type WindowsDesktopAction =
  | { kind: 'list-windows'; maxElements?: number }
  | { kind: 'snapshot'; windowTitle: string; maxElements?: number; maxDepth?: number }
  | { kind: 'invoke'; windowTitle: string; automationId?: string; name?: string }
  | { kind: 'fill'; windowTitle: string; automationId?: string; name?: string; text: string };

export interface WindowsDesktopWorkerInput extends WorkerJobInput {
  action: WindowsDesktopAction;
}

export interface WindowsDesktopWorkerOutput extends WorkerJobOutput {
  data?: unknown;
}

export class WindowsDesktopWorker implements Worker<WindowsDesktopWorkerInput> {
  readonly kind = 'desktop' as const;

  async *exec(input: WindowsDesktopWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (process.platform !== 'win32') {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'desktop.windows_required', message: 'Windows desktop tools require Windows' },
      };
      return;
    }
    try {
      validateAction(input.action);
      if (token.signal?.aborted) throw new Error('Desktop action was cancelled');
      if (token.beforeStart && !(await token.beforeStart())) {
        throw new Error('Desktop action execution fence is no longer current');
      }
      const data = await runPowerShellAction(input.action, token);
      yield {
        type: 'completed',
        output: {
          ok: true,
          message: `desktop ${input.action.kind} completed`,
          data,
        },
      };
    } catch (error) {
      yield {
        type: 'failed',
        failureClass: token.signal?.aborted ? 'timeout' : 'unknown',
        error: {
          code: token.signal?.aborted ? 'desktop.cancelled' : 'desktop.action_failed',
          message: error instanceof Error ? error.message : 'Desktop action failed',
        },
      };
    }
  }
}

function validateAction(action: WindowsDesktopAction): void {
  const bounded = (value: string | undefined, field: string, required = false) => {
    const normalized = value?.trim() ?? '';
    if ((required && !normalized) || normalized.length > 2_000) {
      throw new Error(`Desktop action has invalid ${field}`);
    }
  };
  if (action.kind !== 'list-windows') bounded(action.windowTitle, 'windowTitle', true);
  if (action.kind === 'invoke' || action.kind === 'fill') {
    bounded(action.automationId, 'automationId');
    bounded(action.name, 'name');
    if (!action.automationId?.trim() && !action.name?.trim()) {
      throw new Error('Desktop action requires automationId or name');
    }
  }
  if (action.kind === 'fill' && action.text.length > 32_000) {
    throw new Error('Desktop fill text is too large');
  }
}

function runPowerShellAction(
  action: WindowsDesktopAction,
  token: WorkerToken,
): Promise<unknown> {
  const encoded = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: token.timeoutMs,
        maxBuffer: token.maxOutputBytes ?? 24 * 1024,
        env: {
          ...process.env,
          SYNC_THINK_DESKTOP_ACTION: JSON.stringify(action),
        },
      },
      (error, stdout, stderr) => {
        token.signal?.removeEventListener('abort', abort);
        if (error) {
          reject(new Error(String(stderr || error.message).trim()));
          return;
        }
        const text = String(stdout).trim();
        if (!text) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('Desktop worker returned invalid JSON'));
        }
      },
    );
    const abort = () => child.kill();
    token.signal?.addEventListener('abort', abort, { once: true });
  });
}

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$action = $env:SYNC_THINK_DESKTOP_ACTION | ConvertFrom-Json
$root = [System.Windows.Automation.AutomationElement]::RootElement

function Get-Windows {
  $items = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $result = @()
  foreach ($item in $items) {
    if ($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and $item.Current.Name) {
      $result += $item
    }
  }
  return $result
}

function Find-Window([string]$title) {
  $matches = @(Get-Windows | Where-Object { $_.Current.Name -eq $title })
  if ($matches.Count -ne 1) { throw "Window title must match exactly one window: $title" }
  return $matches[0]
}

function Find-Control($window, $action) {
  if ($action.automationId) {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      [string]$action.automationId
    )
  } else {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      [string]$action.name
    )
  }
  $matches = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($matches.Count -ne 1) { throw 'Control selector must match exactly one element' }
  return $matches[0]
}

switch ([string]$action.kind) {
  'list-windows' {
    $limit = if ($action.maxElements) { [Math]::Min([int]$action.maxElements, 200) } else { 100 }
    $result = @(Get-Windows | Select-Object -First $limit | ForEach-Object {
      @{ name = $_.Current.Name; automationId = $_.Current.AutomationId; processId = $_.Current.ProcessId }
    })
  }
  'snapshot' {
    $window = Find-Window ([string]$action.windowTitle)
    $limit = if ($action.maxElements) { [Math]::Min([int]$action.maxElements, 500) } else { 200 }
    $maxDepth = if ($action.maxDepth) { [Math]::Min([int]$action.maxDepth, 8) } else { 4 }
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($window, 0))
    $result = @()
    while ($queue.Count -gt 0 -and $result.Count -lt $limit) {
      $entry = $queue.Dequeue()
      $element = $entry[0]
      $depth = [int]$entry[1]
      $rect = $element.Current.BoundingRectangle
      $result += @{
        name = $element.Current.Name
        automationId = $element.Current.AutomationId
        controlType = $element.Current.ControlType.ProgrammaticName
        enabled = $element.Current.IsEnabled
        depth = $depth
        bounds = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }
      }
      if ($depth -lt $maxDepth) {
        $children = $element.FindAll(
          [System.Windows.Automation.TreeScope]::Children,
          [System.Windows.Automation.Condition]::TrueCondition
        )
        foreach ($child in $children) { $queue.Enqueue(@($child, $depth + 1)) }
      }
    }
  }
  'invoke' {
    $control = Find-Control (Find-Window ([string]$action.windowTitle)) $action
    $pattern = $null
    if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
    } elseif ($control.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
      ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
    } else { throw 'Control does not support invoke or selection' }
    $result = @{ invoked = $true; name = $control.Current.Name; automationId = $control.Current.AutomationId }
  }
  'fill' {
    $control = Find-Control (Find-Window ([string]$action.windowTitle)) $action
    $pattern = $null
    if (-not $control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      throw 'Control does not support text value input'
    }
    $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
    if ($valuePattern.Current.IsReadOnly) { throw 'Control is read-only' }
    $valuePattern.SetValue([string]$action.text)
    $result = @{ filled = $true; name = $control.Current.Name; automationId = $control.Current.AutomationId }
  }
  default { throw 'Unsupported desktop action' }
}

if ([string]$action.kind -in @('list-windows', 'snapshot')) {
  ConvertTo-Json -InputObject ([object[]]$result) -Compress -Depth 8
} else {
  ConvertTo-Json -InputObject $result -Compress -Depth 8
}
`;
