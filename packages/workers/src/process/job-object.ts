/**
 * Windows Job Object lifecycle for kernel subprocesses (design doc §8).
 *
 * JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE gives the OS-level guarantee that when the
 * host (runtime) exits, every assigned kernel process is killed — no orphaned
 * kernels, no reliance on taskkill during normal shutdown only.
 *
 * Implementation notes:
 * - Uses koffi FFI (same pattern as windows-uia-backend.ts) against kernel32.
 * - The runtime process may already be a member of Electron's job; on Win8+
 *   a process can belong to several jobs unless a job imposes UI restrictions,
 *   so assigning the kernel child to our own job works (verified by spike).
 * - On non-Windows / when koffi fails to load, returns null and the caller
 *   falls back to taskkill /T + parent-pid checks.
 */
import koffi from 'koffi';

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;

const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_SET_LIMIT = 0x2000;

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION layout (arch-aware via koffi structs).
koffi.struct('SyncThinkIoCounters', {
  ReadOperationCount: 'int64',
  WriteOperationCount: 'int64',
  OtherOperationCount: 'int64',
  ReadTransferCount: 'int64',
  WriteTransferCount: 'int64',
  OtherTransferCount: 'int64',
});
koffi.struct('SyncThinkBasicLimitInformation', {
  PerProcessUserTimeLimit: 'int64',
  PerJobUserTimeLimit: 'int64',
  LimitFlags: 'uint32',
  MinimumWorkingSetSize: 'intptr',
  MaximumWorkingSetSize: 'intptr',
  ActiveProcessLimit: 'uint32',
  Affinity: 'intptr',
  PriorityClass: 'uint32',
  SchedulingClass: 'uint32',
});
koffi.struct('SyncThinkExtendedLimitInformation', {
  BasicLimitInformation: 'SyncThinkBasicLimitInformation',
  IoInfo: 'SyncThinkIoCounters',
  ProcessMemoryLimit: 'intptr',
  JobMemoryLimit: 'intptr',
  PeakProcessMemoryUsed: 'intptr',
  PeakJobMemoryUsed: 'intptr',
});

export interface KernelJobObject {
  /** Assign a child process (by pid) to the job. Returns false on failure. */
  assign(pid: number): boolean;
  /**
   * Close the job handle. With KILL_ON_JOB_CLOSE this terminates every
   * assigned process; it also happens automatically when the host exits.
   */
  close(): void;
  readonly supported: true;
}

let cachedKernel32: ReturnType<typeof koffi.load> | undefined;
let cachedFunctions: Record<string, (...args: unknown[]) => unknown> | undefined;

function kernel32Functions(): Record<string, (...args: unknown[]) => unknown> {
  if (!cachedKernel32 || !cachedFunctions) {
    cachedKernel32 = koffi.load('kernel32.dll');
    const k = cachedKernel32;
    cachedFunctions = {
      createJobObjectW: k.func('void * __stdcall CreateJobObjectW(void *attributes, void *name)'),
      setInformationJobObject: k.func(
        'int __stdcall SetInformationJobObject(void *job, int infoClass, void *info, uint32_t infoLength)',
      ),
      assignProcessToJobObject: k.func(
        'int __stdcall AssignProcessToJobObject(void *job, void *process)',
      ),
      openProcess: k.func(
        'void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)',
      ),
      closeHandle: k.func('int __stdcall CloseHandle(void *handle)'),
    };
  }
  return cachedFunctions;
}

/** Create a Job Object with KILL_ON_JOB_CLOSE; null on non-Windows / failure. */
export function createKillOnCloseJob(): KernelJobObject | null {
  if (process.platform !== 'win32') return null;
  try {
    const functions = kernel32Functions();
    const job = functions.createJobObjectW(null, null) as unknown;
    if (!job) return null;
    const extendedInfo = koffi.alloc('SyncThinkExtendedLimitInformation', 1);
    // koffi.alloc returns a zero-initialized native pointer; only LimitFlags
    // needs writing. Its offset is 16 on both x86 and x64 (right after the two
    // LARGE_INTEGER fields of JOBOBJECT_BASIC_LIMIT_INFORMATION).
    koffi.encode(extendedInfo, 16, 'uint32', JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
    const setResult = functions.setInformationJobObject(
      job,
      JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
      extendedInfo,
      koffi.sizeof('SyncThinkExtendedLimitInformation'),
    ) as unknown as number;
    if (!setResult) {
      functions.closeHandle(job);
      return null;
    }
    return {
      supported: true,
      assign(pid: number): boolean {
        try {
          const processHandle = functions.openProcess(
            PROCESS_TERMINATE | PROCESS_SET_QUOTA | PROCESS_SET_LIMIT,
            0,
            pid,
          ) as unknown;
          if (!processHandle) return false;
          const assigned = (functions.assignProcessToJobObject(job, processHandle) as unknown as number) !== 0;
          functions.closeHandle(processHandle);
          return assigned;
        } catch {
          return false;
        }
      },
      close(): void {
        try {
          functions.closeHandle(job);
        } catch {
          // Best-effort; process exit closes remaining handles anyway.
        }
      },
    };
  } catch (error) {
    // koffi may be unavailable or the call ABI mismatch — fall back to taskkill.
    void error;
    return null;
  }
}
