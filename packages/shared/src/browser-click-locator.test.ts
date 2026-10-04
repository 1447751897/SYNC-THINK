import { describe, expect, it } from 'vitest';
import { parseBrowserClickLocator, resolveBrowserClickTarget } from './browser-click-locator.js';

describe('parseBrowserClickLocator', () => {
  it('keeps ordinary CSS selectors', () => {
    expect(parseBrowserClickLocator('#go')).toEqual({ css: '#go' });
    expect(parseBrowserClickLocator('a.game')).toEqual({ css: 'a.game' });
  });

  it('splits Playwright :has-text locators', () => {
    expect(parseBrowserClickLocator('a:has-text("造梦西游online")')).toEqual({
      css: 'a',
      text: '造梦西游online',
    });
    expect(parseBrowserClickLocator(':has-text(\'Start\')')).toEqual({ text: 'Start' });
  });

  it('supports exact text and repeated text conditions in selector lists', () => {
    expect(parseBrowserClickLocator('button:text-is("继续"), [role="button"]:text-is("继续")')).toEqual({ css: 'button, [role="button"]', text: '继续', exact: true });
    expect(parseBrowserClickLocator('main > button:text-is("Next, please")')).toEqual({ css: 'main > button', text: 'Next, please', exact: true });
    expect(parseBrowserClickLocator('button[data-kind="a,b"]:has-text("go")')).toEqual({ css: 'button[data-kind="a,b"]', text: 'go' });
    expect(parseBrowserClickLocator('text=Next, please')).toEqual({ text: 'Next, please' });
  });

  it('accepts text= locators', () => {
    expect(parseBrowserClickLocator('text=Open game')).toEqual({ text: 'Open game' });
    expect(parseBrowserClickLocator('text="造梦西游"')).toEqual({ text: '造梦西游' });
  });
});

describe('resolveBrowserClickTarget', () => {
  it('prefers an explicit text argument on a CSS selector', () => {
    expect(resolveBrowserClickTarget({ selector: 'a.card', text: '造梦西游' })).toEqual({
      css: 'a.card',
      text: '造梦西游',
    });
  });

  it('does not send :has-text() to querySelector', () => {
    expect(resolveBrowserClickTarget({ selector: 'a:has-text("造梦西游online")' })).toEqual({
      css: 'a',
      text: '造梦西游online',
    });
  });
});
