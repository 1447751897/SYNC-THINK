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
