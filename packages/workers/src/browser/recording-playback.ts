import {
  BROWSER_RECORDING_MAX_LOCATOR_CHARS,
  type BrowserRecordingLocator,
  type BrowserRecordingStepInput,
} from '@sync-think/shared';
import type { BrowserAction } from './browser-host.js';

/**
 * Replay translation for recorded browser automation steps.
 *
 * Recording steps are captured as high-level locator + intent (test-id, role,
 * label, ...). The BrowserHost execution layer consumes CSS-selector based
 * `BrowserAction`s. This module translates one to the other so a published
 * Workflow Version can be replayed against the same Profile page.
 *
 * Not every recorded step kind maps to an executable action today:
 *   - navigate / click / fill  -> native BrowserAction
 *   - select / check / press   -> recorded but not yet executable by the host
 *                                  (returned as `ok:false` instead of guessing)
 *   - secret input values      -> never replayed (never stored in plaintext)
 */

export interface RecordingStepPlayback {
  ok: true;
  action: BrowserAction;
  /** Origin (scheme://host) the action targets, when derivable. */
  origin?: string;
}

export interface RecordingStepPlaybackFailure {
  ok: false;
  kind: 'failure';
  code: string;
  error: string;
}

export interface RecordingStepPlaybackVariable {
  ok: false;
  kind: 'variable';
  name: string;
  selector?: string;
}

export type RecordingStepPlaybackResult =
  | RecordingStepPlayback
  | RecordingStepPlaybackVariable
  | RecordingStepPlaybackFailure;

/** The set of variables referenced by a step list, in first-appearance order. */
export function collectStepVariables(steps: readonly BrowserRecordingStepInput[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.kind !== 'fill' && step.kind !== 'select') continue;
    if (step.value.kind !== 'variable') continue;
    const name = step.value.name.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** Translate a single recorded step into a replayable BrowserAction. */
export function recordingStepToBrowserAction(
  step: BrowserRecordingStepInput,
  variables?: Readonly<Record<string, string>>,
): RecordingStepPlaybackResult {
  switch (step.kind) {
    case 'navigate':
      return { ok: true, action: { kind: 'navigate', url: step.url }, origin: originOf(step.url) };
    case 'click': {
      const selector = browserLocatorToSelector(step.locator);
      if (!selector) return locatorFailure(step.locator);
      return { ok: true, action: { kind: 'click', selector } };
    }
    case 'fill': {
      if (step.value.kind === 'secret') {
        return {
          ok: false,
          kind: 'failure',
          code: 'browser.replay-secret-value',
          error:
            'This recorded step contains a secret input value (password/code) and cannot be replayed automatically.',
        };
      }
      const selector = browserLocatorToSelector(step.locator);
      if (!selector) return locatorFailure(step.locator);
      if (step.value.kind === 'variable') {
        const resolved = variables?.[step.value.name];
        if (resolved === undefined) {
          return {
            ok: false,
            kind: 'variable',
            name: step.value.name,
            ...(selector ? { selector } : {}),
          };
        }
        return {
          ok: true,
          action: { kind: 'fill', selector, text: resolved },
        };
      }
      return {
        ok: true,
        action: { kind: 'fill', selector, text: step.value.value },
      };
    }
    case 'select':
      return {
        ok: false,
        kind: 'failure',
        code: 'browser.replay-unsupported-step',
        error:
          'The recorded step is a dropdown select which is not yet replayable. Edit the Workflow to replace it with a click or fill step.',
      };
    case 'check':
      return {
        ok: false,
        kind: 'failure',
        code: 'browser.replay-unsupported-step',
        error:
          'The recorded step is a checkbox toggle which is not yet replayable. Edit the Workflow to replace it with a click step.',
      };
    case 'press':
      return {
        ok: false,
        kind: 'failure',
        code: 'browser.replay-unsupported-step',
        error:
          'The recorded step presses the Enter key which is not yet replayable. Edit the Workflow to replace it with a click step.',
      };
  }
}

/** Collect the set of origins a step list will touch, for permission scoping. */
export function collectStepOrigins(steps: readonly BrowserRecordingStepInput[]): string[] {
  const origins: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.kind !== 'navigate') continue;
    const origin = originOf(step.url);
    if (origin && !seen.has(origin)) {
      seen.add(origin);
      origins.push(origin);
    }
  }
  return origins;
}

/**
 * Translate a recorded locator into a CSS selector the BrowserHost accepts.
 * Returns undefined when the locator strategy cannot be expressed safely as
 * CSS (the caller decides whether to fail the step or attempt a coordinate).
 */
export function browserLocatorToSelector(locator: BrowserRecordingLocator): string | undefined {
  switch (locator.strategy) {
    case 'test-id':
      return attrSelector('data-testid', locator.value);
    case 'id':
      return `#${cssEscape(locator.value)}`;
    case 'name':
      return attrSelector('name', locator.value);
    case 'placeholder':
      return attrSelector('placeholder', locator.value);
    case 'css':
      return sanitizeCssSelector(locator.value);
    case 'role': {
      const roleSelector = attrSelector('role', locator.role);
      if (!locator.name) return roleSelector;
      // Aria-label is the closest CSS-expressible approximation of an
      // accessible name for buttons/inputs.
      return `${roleSelector}[aria-label="${cssEscapeString(locator.name)}"]`;
    }
    case 'label':
      // Labels cannot be expressed as pure CSS association; fall back to
      // aria-label which most accessible forms populate alongside labels.
      return attrSelector('aria-label', locator.value);
  }
}

export function locatorToDescription(locator: BrowserRecordingLocator): string {
  if (locator.strategy === 'role') {
    return locator.name ? `${locator.role} "${locator.name}"` : locator.role;
  }
  return `${locator.strategy}:${locator.value}`;
}

function attrSelector(attr: string, value: string): string {
  return `[${attr}="${cssEscapeString(value)}"]`;
}

function sanitizeCssSelector(value: string): string | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.length > BROWSER_RECORDING_MAX_LOCATOR_CHARS) return undefined;
  // Reject selectors with obvious injection or control characters.
  if (/[\0\r\n]/.test(trimmed)) return undefined;
  return trimmed;
}

function cssEscapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssEscape(value: string): string {
  const escaped = cssEscapeString(value);
  // Escape leading digits so an id like "123abc" stays a valid selector.
  return /^\d/u.test(escaped) ? `\\3${escaped[0]} ${escaped.slice(1)}` : escaped;
}

function locatorFailure(locator: BrowserRecordingLocator): RecordingStepPlaybackFailure {
  return {
    ok: false,
    kind: 'failure',
    code: 'browser.replay-locator-invalid',
    error: `Recorded step locator (${locatorToDescription(locator)}) could not be expressed as a CSS selector.`,
  };
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin.toLowerCase();
  } catch {
    return undefined;
  }
}
