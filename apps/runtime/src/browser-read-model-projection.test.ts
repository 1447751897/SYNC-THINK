import { describe, expect, it } from 'vitest';
import { foldToolOutputText, foldLongToolOutputsInMessages } from './chat-tools.js';

function largeRead() {
  return JSON.stringify({
    ok: true,
    commandId: 'calendar-read-command',
    profileId: 'bound-profile',
    url: 'https://fixture.test/calendar',
    title: 'Calendar fixture',
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    text: 'Real rendered visible content '.repeat(3000),
    controls: Array.from({ length: 80 }, (_, index) => ({
      name: index === 60 ? '' : 'Control ' + index,
      tag: 'button',
      role: 'button',
      selector: index === 60 ? '#topbar > button.calendar:nth-child(3)' : '#control-' + index,
      x: index === 60 ? 1370 : index * 10,
      y: 35,
      inViewport: index >= 45,
    })),
    links: Array.from({ length: 50 }, (_, index) => ({
      text: 'Link ' + index,
      href: 'https://fixture.test/link/' + index,
    })),
  });
}

describe('Browser read through public tool-output folding seams', () => {
  it('keeps valid bounded JSON, viewport and the wordless visible calendar locator through both folds', () => {
    const first = foldToolOutputText(largeRead()).text;
    const page = JSON.parse(first);
    expect(first.length).toBeLessThanOrEqual(8000);
    expect(page.commandId).toBe('calendar-read-command');
    expect(page.viewport).toEqual({ width: 1440, height: 900, devicePixelRatio: 2 });
    expect(page.controls.length).toBeLessThanOrEqual(24);
    expect(page.controls).toContainEqual({
      name: '',
      tag: 'button',
      role: 'button',
      selector: '#topbar > button.calendar:nth-child(3)',
      x: 1370,
      y: 35,
      inViewport: true,
    });
    expect(page.textTruncated).toBe(true);
    const second = foldLongToolOutputsInMessages(
      [
        { role: 'tool', toolCallId: 'read', content: first },
        ...Array.from({ length: 3 }, (_, index) => ({
          role: 'tool' as const,
          toolCallId: 'other-' + index,
          content: 'other output',
        })),
      ],
      { preserveBoundedSourcePages: true },
    ).messages;
    expect(JSON.parse(String(second[0]!.content))).toEqual(page);
    expect(second[0]!.content).not.toContain('tool output folded');
  });
  it('keeps actual CSS locators whole and does not expose off-viewport coordinates', () => {
    const read = JSON.parse(largeRead());
    read.controls = [
      {
        name: '',
        tag: 'button',
        role: 'button',
        selector: '#long-' + 'x'.repeat(3000),
        x: 10,
        y: 20,
        inViewport: true,
      },
      {
        name: 'Below page',
        tag: 'button',
        role: 'button',
        selector: '#below',
        x: 10,
        y: 2000,
        inViewport: false,
      },
    ];
    const page = JSON.parse(foldToolOutputText(JSON.stringify(read)).text);
    expect(page.controls[0]!.selector).toBe(read.controls[0]!.selector);
    expect(
      page.controls.find((item: { selector: string }) => item.selector === '#below'),
    ).not.toHaveProperty('x');
    expect(
      page.controls.find((item: { selector: string }) => item.selector === '#below'),
    ).not.toHaveProperty('y');
  });
});

it('keeps a visible aria-hidden icon locator even after many named navigation controls', () => {
  const raw = JSON.stringify({ ok: true, commandId: 'command-current', profileId: 'default', url: 'https://fixture.test/', text: '热榜内容'.repeat(10000), controls: [
    ...Array.from({length:40}, (_, i) => ({name: 'Navigation '+i, tag:'a',role:'link',selector:'#nav-'+i,x:20+i,y:20,inViewport:true})),
    {name:'svg',tag:'svg',role:'icon',selector:'#calendar-glyph',x:728,y:26,inViewport:true},
  ]});
  const projected = JSON.parse(foldToolOutputText(raw).text);
  expect(projected.controls).toEqual(expect.arrayContaining([expect.objectContaining({selector:'#calendar-glyph',x:728,y:26})]));
  expect(JSON.stringify(projected).length).toBeLessThanOrEqual(8000);
});
