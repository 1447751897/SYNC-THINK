import koffi from 'koffi';
import type {
  DesktopBounds,
  DesktopElementSnapshot,
  DesktopProbeResult,
  DesktopTreeLimits,
  DesktopWindowIdentity,
  DesktopWindowListResult,
} from './desktop-contract.js';
import { DesktopDriverError } from './desktop-host-runtime.js';
import type {
  WindowsUiaBackend,
  WindowsUiaElementLease,
  WindowsUiaInspection,
} from './koffi-uia-driver.js';

const COINIT_MULTITHREADED = 0;
const CLSCTX_INPROC_SERVER = 1;
const CUI_AUTOMATION = '{FF48DBA4-60EF-4201-AA87-54103EEF594E}';
const IUI_AUTOMATION = '{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}';
const DWMWA_CLOAKED = 14;
const MAX_WINDOWS = 256;
const MAX_WINDOW_TITLE_CODE_UNITS = 4_096;
const MAX_UIA_STRING_CODE_UNITS = 8_192;
const UIA_INVOKE_PATTERN_ID = 10_000;
const UIA_VALUE_PATTERN_ID = 10_002;

koffi.struct('SYNC_THINK_GUID', {
  Data1: 'uint32_t',
  Data2: 'uint16_t',
  Data3: 'uint16_t',
  Data4: koffi.array('uint8_t', 8),
});
koffi.struct('SYNC_THINK_RECT', {
  left: 'int32_t',
  top: 'int32_t',
  right: 'int32_t',
  bottom: 'int32_t',
});

koffi.proto('int __stdcall SyncThinkEnumWindowsProc(void *hwnd, intptr_t lParam)');
const release = koffi.proto('uint32_t __stdcall Release(void *self)');
const getRootElement = koffi.proto(
  'int32_t __stdcall GetRootElement(void *self, _Out_ void **element)',
);
const elementFromHandle = koffi.proto(
  'int32_t __stdcall ElementFromHandle(void *self, void *hwnd, _Out_ void **element)',
);
const getControlViewWalker = koffi.proto(
  'int32_t __stdcall GetControlViewWalker(void *self, _Out_ void **walker)',
);
const getFirstChildElement = koffi.proto(
  'int32_t __stdcall GetFirstChildElement(void *self, void *element, _Out_ void **child)',
);
const getNextSiblingElement = koffi.proto(
  'int32_t __stdcall GetNextSiblingElement(void *self, void *element, _Out_ void **sibling)',
);
const getBstrProperty = koffi.proto(
  'int32_t __stdcall GetBstrProperty(void *self, _Out_ void **value)',
);
const getInt32Property = koffi.proto(
  'int32_t __stdcall GetInt32Property(void *self, _Out_ int32_t *value)',
);
const getUint32Property = koffi.proto(
  'int32_t __stdcall GetUint32Property(void *self, _Out_ uint32_t *value)',
);
const getBoolProperty = koffi.proto(
  'int32_t __stdcall GetBoolProperty(void *self, _Out_ int32_t *value)',
);
const getRectProperty = koffi.proto(
  'int32_t __stdcall GetRectProperty(void *self, _Out_ SYNC_THINK_RECT *value)',
);
const getCurrentPattern = koffi.proto(
  'int32_t __stdcall GetCurrentPattern(void *self, int32_t patternId, _Out_ void **pattern)',
);
const setFocus = koffi.proto('int32_t __stdcall SetFocus(void *self)');
const invokePattern = koffi.proto('int32_t __stdcall Invoke(void *self)');
const setValuePattern = koffi.proto(
  'int32_t __stdcall SetValue(void *self, const char16_t *value)',
);

interface NativeQueueEntry {
  element: bigint;
  depth: number;
  parentIndex?: number;
}

interface TextBudget {
  remainingBytes: number;
  truncated: boolean;
}

export class KoffiWindowsUiaBackend implements WindowsUiaBackend {
  constructor() {
    assertWindows();
  }

  probe(): DesktopProbeResult {
    const startedAt = performance.now();
    const ole32 = koffi.load('ole32.dll');
    const clsidFromString = ole32.func(
      'int32_t __stdcall CLSIDFromString(const char16_t *text, _Out_ SYNC_THINK_GUID *guid)',
    );
    const coInitializeEx = ole32.func(
      'int32_t __stdcall CoInitializeEx(void *reserved, uint32_t flags)',
    );
    const coCreateInstance = ole32.func(
      'int32_t __stdcall CoCreateInstance(const SYNC_THINK_GUID *clsid, void *outer, uint32_t context, const SYNC_THINK_GUID *iid, _Out_ void **instance)',
    );
    const coUninitialize = ole32.func('void __stdcall CoUninitialize()');
    const initializeResult = Number(coInitializeEx(null, COINIT_MULTITHREADED));
    if (initializeResult < 0) {
      throw uiaUnavailable('Windows UI Automation COM initialization failed');
    }

    const automation: unknown[] = [null];
    const root: unknown[] = [null];
    try {
      const createResult = Number(
        coCreateInstance(
          guid(clsidFromString, CUI_AUTOMATION),
          null,
          CLSCTX_INPROC_SERVER,
          guid(clsidFromString, IUI_AUTOMATION),
          automation,
        ),
      );
      if (createResult < 0 || !automation[0]) {
        throw new Error(`CoCreateInstance failed: ${hresultHex(createResult)}`);
      }
      const rootResult = Number(
        koffi.call(slot(pointer(automation[0]), 5), getRootElement, automation[0], root),
      );
      if (rootResult < 0 || !root[0]) {
        throw new Error(`GetRootElement failed: ${hresultHex(rootResult)}`);
      }
      return {
        kind: 'probe',
        backend: 'uia-com',
        platform: process.platform,
        architecture: process.arch,
        rootAvailable: true,
        koffiVersion: koffi.version,
        napiVersion: process.versions.napi,
        elapsedMs: performance.now() - startedAt,
      };
    } finally {
      if (root[0]) releaseCom(pointer(root[0]));
      if (automation[0]) releaseCom(pointer(automation[0]));
      coUninitialize();
    }
  }

  listWindows(): DesktopWindowListResult {
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const enumWindows = user32.func(
      'int __stdcall EnumWindows(SyncThinkEnumWindowsProc *callback, intptr_t lParam)',
    );
    const isWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hwnd)');
    const getWindowTextLength = user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)');
    const getWindowText = user32.func(
      'int __stdcall GetWindowTextW(void *hwnd, _Out_ char16_t *buffer, int maxCount)',
    );
    const getWindowThreadProcessId = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *processId)',
    );
    const dwmGetWindowAttribute = dwmapi.func(
      'int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ int32_t *value, uint32_t valueSize)',
    );
    const windows: DesktopWindowIdentity[] = [];
    let truncated = false;
    let callbackError: unknown;

    const result = Number(
      enumWindows((hwnd: bigint | null) => {
        try {
          if (!hwnd || !Number(isWindowVisible(hwnd)) || isCloaked(dwmGetWindowAttribute, hwnd)) {
            return 1;
          }
          const title = readWindowTitle(
            hwnd,
            getWindowTextLength,
            getWindowText,
            MAX_WINDOW_TITLE_CODE_UNITS,
          );
          if (!title) return 1;
          const processIdSlot: unknown[] = [0];
          const threadId = Number(getWindowThreadProcessId(hwnd, processIdSlot));
          const processId = Number(processIdSlot[0]);
          if (!threadId || !Number.isSafeInteger(processId) || processId <= 0) return 1;
          if (windows.length >= MAX_WINDOWS) {
            truncated = true;
            return 0;
          }
          windows.push({
            processId,
            nativeWindowHandle: formatWindowHandle(hwnd),
            title,
          });
          return 1;
        } catch (error) {
          callbackError = error;
          return 0;
        }
      }, 0),
    );
    if (callbackError) throw callbackError;
    if (!result && !truncated) {
      throw new Error('EnumWindows failed');
    }
    return { kind: 'window-list', windows, truncated };
  }

  inspectWindow(window: DesktopWindowIdentity, limits: DesktopTreeLimits): WindowsUiaInspection {
    const session = openInspectionSession(window, limits);
    try {
      return session.inspection;
    } finally {
      session.dispose();
    }
  }

  acquireElement(
    window: DesktopWindowIdentity,
    limits: DesktopTreeLimits,
    elementIndex: number,
  ): WindowsUiaElementLease {
    const session = openInspectionSession(window, limits, elementIndex);
    const element = session.inspection.elements.find(
      (candidate) => candidate.index === elementIndex,
    );
    if (!element || !session.targetElement) {
      session.dispose();
      throw new DesktopDriverError(
        'desktop.element-not-found',
        'Desktop element index is not present in the exact accessibility snapshot',
        'acceptance',
      );
    }

    return {
      inspection: session.inspection,
      element,
      readValue: () =>
        readCurrentValue(session.targetElement!, session.sysStringLen, session.sysFreeString),
      focus: () => focusElement(session.targetElement!),
      invoke: () => invokeElement(session.targetElement!),
      setValue: (value) =>
        setElementValue(
          session.targetElement!,
          value,
          session.sysAllocStringLen,
          session.sysFreeString,
        ),
      dispose: session.dispose,
    };
  }
}

interface NativeInspectionSession {
  inspection: WindowsUiaInspection;
  targetElement?: bigint;
  sysStringLen: (...args: unknown[]) => unknown;
  sysAllocStringLen: (...args: unknown[]) => unknown;
  sysFreeString: (...args: unknown[]) => unknown;
  dispose(): void;
}

function openInspectionSession(
  window: DesktopWindowIdentity,
  limits: DesktopTreeLimits,
  targetIndex?: number,
): NativeInspectionSession {
  const nativeWindowHandle = parseWindowHandle(window.nativeWindowHandle);
  const user32 = koffi.load('user32.dll');
  const ole32 = koffi.load('ole32.dll');
  const oleaut32 = koffi.load('oleaut32.dll');
  const isWindow = user32.func('int __stdcall IsWindow(void *hwnd)');
  const getWindowTextLength = user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)');
  const getWindowText = user32.func(
    'int __stdcall GetWindowTextW(void *hwnd, _Out_ char16_t *buffer, int maxCount)',
  );
  const getWindowThreadProcessId = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *processId)',
  );
  const clsidFromString = ole32.func(
    'int32_t __stdcall CLSIDFromString(const char16_t *text, _Out_ SYNC_THINK_GUID *guid)',
  );
  const coInitializeEx = ole32.func(
    'int32_t __stdcall CoInitializeEx(void *reserved, uint32_t flags)',
  );
  const coCreateInstance = ole32.func(
    'int32_t __stdcall CoCreateInstance(const SYNC_THINK_GUID *clsid, void *outer, uint32_t context, const SYNC_THINK_GUID *iid, _Out_ void **instance)',
  );
  const coUninitialize = ole32.func('void __stdcall CoUninitialize()');
  const sysStringLen = oleaut32.func('uint32_t __stdcall SysStringLen(const char16_t *value)');
  const sysAllocStringLen = oleaut32.func(
    'void * __stdcall SysAllocStringLen(const char16_t *value, uint32_t length)',
  );
  const sysFreeString = oleaut32.func('void __stdcall SysFreeString(void *value)');

  assertWindowIdentity(
    window,
    nativeWindowHandle,
    isWindow,
    getWindowThreadProcessId,
    getWindowTextLength,
    getWindowText,
  );
  const initializeResult = Number(coInitializeEx(null, COINIT_MULTITHREADED));
  if (initializeResult < 0) {
    throw uiaUnavailable('Windows UI Automation COM initialization failed');
  }

  const automation: unknown[] = [null];
  const walker: unknown[] = [null];
  const root: unknown[] = [null];
  const queue: NativeQueueEntry[] = [];
  const elements: DesktopElementSnapshot[] = [];
  const textBudget: TextBudget = { remainingBytes: limits.maxTextBytes, truncated: false };
  let traversalTruncated = false;
  let targetElement: bigint | undefined;
  let disposed = false;
  let completed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const entry of queue) releaseCom(entry.element);
    queue.length = 0;
    if (targetElement) releaseCom(targetElement);
    targetElement = undefined;
    if (root[0]) releaseCom(pointer(root[0]));
    root[0] = null;
    if (walker[0]) releaseCom(pointer(walker[0]));
    walker[0] = null;
    if (automation[0]) releaseCom(pointer(automation[0]));
    automation[0] = null;
    coUninitialize();
  };

  try {
    const createResult = Number(
      coCreateInstance(
        guid(clsidFromString, CUI_AUTOMATION),
        null,
        CLSCTX_INPROC_SERVER,
        guid(clsidFromString, IUI_AUTOMATION),
        automation,
      ),
    );
    if (createResult < 0 || !automation[0]) {
      throw new Error(`CoCreateInstance failed: ${hresultHex(createResult)}`);
    }
    const rootResult = Number(
      koffi.call(
        slot(pointer(automation[0]), 6),
        elementFromHandle,
        automation[0],
        nativeWindowHandle,
        root,
      ),
    );
    if (rootResult < 0 || !root[0]) {
      assertWindowIdentity(
        window,
        nativeWindowHandle,
        isWindow,
        getWindowThreadProcessId,
        getWindowTextLength,
        getWindowText,
      );
      throw new Error(`ElementFromHandle failed: ${hresultHex(rootResult)}`);
    }
    const walkerResult = Number(
      koffi.call(slot(pointer(automation[0]), 14), getControlViewWalker, automation[0], walker),
    );
    if (walkerResult < 0 || !walker[0]) {
      throw new Error(`get_ControlViewWalker failed: ${hresultHex(walkerResult)}`);
    }
    queue.push({ element: pointer(root[0]), depth: 0 });
    root[0] = null;

    while (queue.length > 0 && elements.length < limits.maxNodes) {
      const current = queue.shift()!;
      try {
        const index = elements.length;
        elements.push(
          readElementSnapshot(
            current.element,
            index,
            current.parentIndex,
            window.processId,
            textBudget,
            sysStringLen,
            sysFreeString,
          ),
        );
        if (index === targetIndex) targetElement = current.element;

        if (current.depth >= limits.maxDepth) {
          const child = getRelatedElement(
            pointer(walker[0]),
            current.element,
            4,
            getFirstChildElement,
          );
          if (child) {
            traversalTruncated = true;
            releaseCom(child);
          }
          continue;
        }

        let child = getRelatedElement(pointer(walker[0]), current.element, 4, getFirstChildElement);
        while (child) {
          if (elements.length + queue.length >= limits.maxNodes) {
            traversalTruncated = true;
            releaseCom(child);
            break;
          }
          queue.push({ element: child, depth: current.depth + 1, parentIndex: index });
          child = getRelatedElement(pointer(walker[0]), child, 6, getNextSiblingElement);
        }
      } finally {
        if (current.element !== targetElement) releaseCom(current.element);
      }
    }
    if (queue.length > 0) traversalTruncated = true;

    assertWindowIdentity(
      window,
      nativeWindowHandle,
      isWindow,
      getWindowThreadProcessId,
      getWindowTextLength,
      getWindowText,
    );
    completed = true;
    return {
      inspection: {
        window: {
          ...window,
          nativeWindowHandle: formatWindowHandle(nativeWindowHandle),
        },
        elements,
        truncated: traversalTruncated || textBudget.truncated,
      },
      targetElement,
      sysStringLen,
      sysAllocStringLen,
      sysFreeString,
      dispose,
    };
  } finally {
    if (!completed) dispose();
  }
}

function readElementSnapshot(
  element: bigint,
  index: number,
  parentIndex: number | undefined,
  fallbackProcessId: number,
  textBudget: TextBudget,
  sysStringLen: (...args: unknown[]) => unknown,
  sysFreeString: (...args: unknown[]) => unknown,
): DesktopElementSnapshot {
  const name = budgetText(readBstrProperty(element, 23, sysStringLen, sysFreeString), textBudget);
  const automationId = budgetText(
    readBstrProperty(element, 29, sysStringLen, sysFreeString),
    textBudget,
  );
  const controlTypeId = readInt32Property(element, 21);
  const processId = readUint32Property(element, 20) ?? fallbackProcessId;
  const enabled = readBoolProperty(element, 28) ?? false;
  const offscreen = readBoolProperty(element, 38) ?? true;
  const isPassword = readBoolProperty(element, 35) ?? false;
  const bounds = readBoundsProperty(element, 43);
  const supportedPatterns: string[] = [];
  if (supportsPattern(element, UIA_INVOKE_PATTERN_ID)) supportedPatterns.push('Invoke');
  if (supportsPattern(element, UIA_VALUE_PATTERN_ID)) supportedPatterns.push('Value');

  return {
    index,
    ...(parentIndex === undefined ? {} : { parentIndex }),
    ...(name ? { name } : {}),
    ...(automationId ? { automationId } : {}),
    controlType: controlTypeName(controlTypeId),
    processId,
    enabled,
    offscreen,
    isPassword,
    ...(bounds ? { bounds } : {}),
    supportedPatterns,
  };
}

function readBstrProperty(
  element: bigint,
  vtableIndex: number,
  sysStringLen: (...args: unknown[]) => unknown,
  sysFreeString: (...args: unknown[]) => unknown,
): string | undefined {
  const value: unknown[] = [null];
  const result = Number(koffi.call(slot(element, vtableIndex), getBstrProperty, element, value));
  if (result < 0 || !value[0]) return undefined;
  const bstr = pointer(value[0]);
  try {
    const length = Math.min(Number(sysStringLen(bstr)), MAX_UIA_STRING_CODE_UNITS);
    return length > 0 ? koffi.decode.string16(bstr, length) : undefined;
  } finally {
    sysFreeString(bstr);
  }
}

function readInt32Property(element: bigint, vtableIndex: number): number | undefined {
  const value: unknown[] = [0];
  const result = Number(koffi.call(slot(element, vtableIndex), getInt32Property, element, value));
  return result >= 0 ? Number(value[0]) : undefined;
}

function readUint32Property(element: bigint, vtableIndex: number): number | undefined {
  const value: unknown[] = [0];
  const result = Number(koffi.call(slot(element, vtableIndex), getUint32Property, element, value));
  return result >= 0 ? Number(value[0]) : undefined;
}

function readBoolProperty(element: bigint, vtableIndex: number): boolean | undefined {
  const value: unknown[] = [0];
  const result = Number(koffi.call(slot(element, vtableIndex), getBoolProperty, element, value));
  return result >= 0 ? Number(value[0]) !== 0 : undefined;
}

function readBoundsProperty(element: bigint, vtableIndex: number): DesktopBounds | undefined {
  const value: Record<string, unknown> = {};
  const result = Number(koffi.call(slot(element, vtableIndex), getRectProperty, element, value));
  if (result < 0) return undefined;
  const left = Number(value.left);
  const top = Number(value.top);
  const right = Number(value.right);
  const bottom = Number(value.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function supportsPattern(element: bigint, patternId: number): boolean {
  const pattern: unknown[] = [null];
  const result = Number(
    koffi.call(slot(element, 16), getCurrentPattern, element, patternId, pattern),
  );
  if (result < 0 || !pattern[0]) return false;
  releaseCom(pointer(pattern[0]));
  return true;
}

function readCurrentValue(
  element: bigint,
  sysStringLen: (...args: unknown[]) => unknown,
  sysFreeString: (...args: unknown[]) => unknown,
): string {
  const pattern = requirePattern(element, UIA_VALUE_PATTERN_ID, 'ValuePattern');
  const value: unknown[] = [null];
  try {
    const result = Number(koffi.call(slot(pattern, 4), getBstrProperty, pattern, value));
    if (result < 0) throw actionFailed('read the desktop element value');
    if (!value[0]) return '';
    const bstr = pointer(value[0]);
    try {
      const length = Math.min(Number(sysStringLen(bstr)), MAX_UIA_STRING_CODE_UNITS);
      return length > 0 ? koffi.decode.string16(bstr, length) : '';
    } finally {
      sysFreeString(bstr);
    }
  } finally {
    releaseCom(pattern);
  }
}

function focusElement(element: bigint): void {
  const result = Number(koffi.call(slot(element, 3), setFocus, element));
  if (result < 0) throw actionFailed('focus the desktop element');
}

function invokeElement(element: bigint): void {
  const pattern = requirePattern(element, UIA_INVOKE_PATTERN_ID, 'InvokePattern');
  try {
    const result = Number(koffi.call(slot(pattern, 3), invokePattern, pattern));
    if (result < 0) throw actionFailed('invoke the desktop element');
  } finally {
    releaseCom(pattern);
  }
}

function setElementValue(
  element: bigint,
  value: string,
  sysAllocStringLen: (...args: unknown[]) => unknown,
  sysFreeString: (...args: unknown[]) => unknown,
): void {
  const pattern = requirePattern(element, UIA_VALUE_PATTERN_ID, 'ValuePattern');
  let bstr: bigint | undefined;
  try {
    const readOnly: unknown[] = [0];
    const readOnlyResult = Number(koffi.call(slot(pattern, 5), getBoolProperty, pattern, readOnly));
    if (readOnlyResult < 0) throw actionFailed('check whether the desktop value is read-only');
    if (Number(readOnly[0]) !== 0) {
      throw new DesktopDriverError(
        'desktop.value-read-only',
        'Desktop ValuePattern is read-only',
        'acceptance',
      );
    }

    const allocated = sysAllocStringLen(value, value.length);
    if (!allocated) throw actionFailed('allocate the desktop value');
    bstr = pointer(allocated);
    const result = Number(koffi.call(slot(pattern, 3), setValuePattern, pattern, bstr));
    if (result < 0) throw actionFailed('set the desktop element value');
  } finally {
    if (bstr) sysFreeString(bstr);
    releaseCom(pattern);
  }
}

function requirePattern(element: bigint, patternId: number, patternName: string): bigint {
  const pattern: unknown[] = [null];
  const result = Number(
    koffi.call(slot(element, 16), getCurrentPattern, element, patternId, pattern),
  );
  if (result < 0 || !pattern[0]) {
    throw new DesktopDriverError(
      'desktop.pattern-unsupported',
      `Desktop element does not expose ${patternName}`,
      'acceptance',
    );
  }
  return pointer(pattern[0]);
}

function actionFailed(operation: string): DesktopDriverError {
  return new DesktopDriverError(
    'desktop.action-failed',
    `Windows UI Automation could not ${operation}`,
    'acceptance',
  );
}

function getRelatedElement(
  walker: bigint,
  element: bigint,
  vtableIndex: number,
  prototype: typeof getFirstChildElement,
): bigint | undefined {
  const related: unknown[] = [null];
  const result = Number(koffi.call(slot(walker, vtableIndex), prototype, walker, element, related));
  return result >= 0 && related[0] ? pointer(related[0]) : undefined;
}

function budgetText(value: string | undefined, budget: TextBudget): string | undefined {
  if (!value) return undefined;
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (byteLength <= budget.remainingBytes) {
    budget.remainingBytes -= byteLength;
    return value;
  }
  budget.truncated = true;
  if (budget.remainingBytes <= 0) return undefined;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= budget.remainingBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let end = low;
  if (end > 0 && end < value.length) {
    const lastCodeUnit = value.charCodeAt(end - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1;
  }
  const sliced = value.slice(0, end);
  budget.remainingBytes -= Buffer.byteLength(sliced, 'utf8');
  return sliced || undefined;
}

function assertWindowIdentity(
  expected: DesktopWindowIdentity,
  hwnd: bigint,
  isWindow: (...args: unknown[]) => unknown,
  getWindowThreadProcessId: (...args: unknown[]) => unknown,
  getWindowTextLength: (...args: unknown[]) => unknown,
  getWindowText: (...args: unknown[]) => unknown,
): void {
  if (!Number(isWindow(hwnd))) throw staleWindow();
  const processIdSlot: unknown[] = [0];
  const threadId = Number(getWindowThreadProcessId(hwnd, processIdSlot));
  if (!threadId || Number(processIdSlot[0]) !== expected.processId) throw staleWindow();
  if (expected.title !== undefined) {
    const title = readWindowTitle(
      hwnd,
      getWindowTextLength,
      getWindowText,
      MAX_WINDOW_TITLE_CODE_UNITS,
    );
    if (title !== expected.title) throw staleWindow();
  }
}

function readWindowTitle(
  hwnd: bigint,
  getWindowTextLength: (...args: unknown[]) => unknown,
  getWindowText: (...args: unknown[]) => unknown,
  maxCodeUnits: number,
): string | undefined {
  const reportedLength = Number(getWindowTextLength(hwnd));
  if (reportedLength <= 0) return undefined;
  const maxCount = Math.min(reportedLength, maxCodeUnits) + 1;
  const buffer = Buffer.alloc(maxCount * 2);
  const written = Number(getWindowText(hwnd, buffer, maxCount));
  if (written <= 0) return undefined;
  return buffer.subarray(0, written * 2).toString('utf16le');
}

function isCloaked(dwmGetWindowAttribute: (...args: unknown[]) => unknown, hwnd: bigint): boolean {
  const value: unknown[] = [0];
  const result = Number(dwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, value, 4));
  return result >= 0 && Number(value[0]) !== 0;
}

function guid(
  clsidFromString: (...args: unknown[]) => unknown,
  text: string,
): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  const result = Number(clsidFromString(text, value));
  if (result < 0) throw new Error(`CLSIDFromString failed: ${hresultHex(result)}`);
  return value;
}

function slot(instance: bigint, index: number): bigint {
  const vtable = pointer(koffi.decode(instance, 'void *'));
  return pointer(koffi.decode(vtable, index * koffi.sizeof('void *'), 'void *'));
}

function releaseCom(instance: bigint): void {
  koffi.call(slot(instance, 2), release, instance);
}

function pointer(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return koffi.address(value);
}

function parseWindowHandle(value: string): bigint {
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > 0xffffffffffffffffn) throw staleWindow();
  return parsed;
}

function formatWindowHandle(value: bigint): string {
  return `0x${value.toString(16).padStart(16, '0')}`;
}

function controlTypeName(controlTypeId: number | undefined): string {
  return CONTROL_TYPE_NAMES.get(controlTypeId ?? -1) ?? `ControlType:${controlTypeId ?? 0}`;
}

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new DesktopDriverError(
      'desktop.platform-unsupported',
      'Windows UI Automation requires Windows',
      'acceptance',
    );
  }
}

function staleWindow(): DesktopDriverError {
  return new DesktopDriverError(
    'desktop.window-stale',
    'Desktop window identity is stale or no longer matches the target',
    'acceptance',
  );
}

function uiaUnavailable(message: string): DesktopDriverError {
  return new DesktopDriverError('desktop.uia-unavailable', message, 'crashed');
}

function hresultHex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

const CONTROL_TYPE_NAMES = new Map<number, string>([
  [50_000, 'Button'],
  [50_001, 'Calendar'],
  [50_002, 'CheckBox'],
  [50_003, 'ComboBox'],
  [50_004, 'Edit'],
  [50_005, 'Hyperlink'],
  [50_006, 'Image'],
  [50_007, 'ListItem'],
  [50_008, 'List'],
  [50_009, 'Menu'],
  [50_010, 'MenuBar'],
  [50_011, 'MenuItem'],
  [50_012, 'ProgressBar'],
  [50_013, 'RadioButton'],
  [50_014, 'ScrollBar'],
  [50_015, 'Slider'],
  [50_016, 'Spinner'],
  [50_017, 'StatusBar'],
  [50_018, 'Tab'],
  [50_019, 'TabItem'],
  [50_020, 'Text'],
  [50_021, 'ToolBar'],
  [50_022, 'ToolTip'],
  [50_023, 'Tree'],
  [50_024, 'TreeItem'],
  [50_025, 'Custom'],
  [50_026, 'Group'],
  [50_027, 'Thumb'],
  [50_028, 'DataGrid'],
  [50_029, 'DataItem'],
  [50_030, 'Document'],
  [50_031, 'SplitButton'],
  [50_032, 'Window'],
  [50_033, 'Pane'],
  [50_034, 'Header'],
  [50_035, 'HeaderItem'],
  [50_036, 'Table'],
  [50_037, 'TitleBar'],
  [50_038, 'Separator'],
  [50_039, 'SemanticZoom'],
  [50_040, 'AppBar'],
]);
