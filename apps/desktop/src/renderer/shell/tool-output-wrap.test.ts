/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readToolOutputWrap,
  resetToolOutputWrapForTests,
  subscribeToolOutputWrap,
  writeToolOutputWrap,
} from './tool-output-wrap.js';

const STORAGE_KEY = 'sync-think:tool-output-wrap';

describe('tool-output-wrap preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetToolOutputWrapForTests();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetToolOutputWrapForTests();
  });

  it('defaults to wrapping when nothing has been stored', () => {
    expect(readToolOutputWrap()).toBe(true);
  });

  it('restores an explicit opt-out from storage', () => {
    window.localStorage.setItem(STORAGE_KEY, 'false');
    resetToolOutputWrapForTests();
    expect(readToolOutputWrap()).toBe(false);
  });

  it('falls back to wrapping when the stored value is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY, 'maybe');
    resetToolOutputWrapForTests();
    expect(readToolOutputWrap()).toBe(true);
  });

  it('persists the choice and notifies subscribers only on a real change', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeToolOutputWrap(() => seen.push(readToolOutputWrap()));

    writeToolOutputWrap(false);
    expect(readToolOutputWrap()).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(seen).toEqual([false]);

    // 重复写入同一个值不应再通知，避免所有输出块无谓重渲染。
    writeToolOutputWrap(false);
    expect(seen).toEqual([false]);

    writeToolOutputWrap(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(seen).toEqual([false, true]);

    unsubscribe();
    writeToolOutputWrap(false);
    expect(seen).toEqual([false, true]);
  });
});
