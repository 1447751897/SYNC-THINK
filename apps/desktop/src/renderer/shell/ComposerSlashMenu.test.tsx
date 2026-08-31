/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillVersionSummary } from '@sync-think/protocol';
import { BUILTIN_SLASH_COMMANDS } from './compose-slash.js';
import {
  COMPOSER_SKILL_CATEGORIES,
  ComposerSlashMenu,
  type ComposerSlashMenuResolvedItem,
  nextComposerSkillCategory,
  readPinnedComposerSkills,
  writePinnedComposerSkills,
} from './ComposerSlashMenu.js';
import { NEWMAX_POPOVER_TRANSITION_MS } from './NewMaxComposerFrame.js';

function skill(
  index: number,
  options: Partial<SkillVersionSummary> & { name?: string } = {},
): SkillVersionSummary {
  return {
    skillVersionId: options.skillVersionId ?? `skill-${index}`,
    skillId: options.skillId ?? `family-${index}`,
    name: options.name ?? `Skill ${String(index).padStart(2, '0')}`,
    description: options.description ?? `Description ${index}`,
    version: options.version ?? '1.0.0',
    allowedTools: options.allowedTools ?? [],
    contentFingerprint: options.contentFingerprint ?? `fingerprint-${index}`,
    hasScripts: options.hasScripts ?? false,
    warnings: options.warnings ?? [],
    enabled: options.enabled ?? true,
    originType: options.originType ?? 'local',
    originRef: options.originRef,
    derivedFromSkillVersionId: options.derivedFromSkillVersionId,
    createdAt: options.createdAt ?? '2026-08-30T00:00:00.000Z',
  };
}

const noop = () => undefined;

function renderMenu(overrides: Partial<React.ComponentProps<typeof ComposerSlashMenu>> = {}) {
  const props: React.ComponentProps<typeof ComposerSlashMenu> = {
    commands: BUILTIN_SLASH_COMMANDS,
    skills: [],
    loading: false,
    query: '',
    selectedSkillVersionIds: [],
    activeIndex: -1,
    onActiveIndexChange: noop,
    onCommand: noop,
    onSkill: noop,
    onCreateSkill: noop,
    ...overrides,
  };
  return render(<ComposerSlashMenu {...props} />);
}

function KeyboardMenu({
  skills = [],
  onCommand = noop,
  onSkill = noop,
}: {
  skills?: SkillVersionSummary[];
  onCommand?: React.ComponentProps<typeof ComposerSlashMenu>['onCommand'];
  onSkill?: React.ComponentProps<typeof ComposerSlashMenu>['onSkill'];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  return (
    <ComposerSlashMenu
      commands={BUILTIN_SLASH_COMMANDS}
      skills={skills}
      loading={false}
      query=""
      selectedSkillVersionIds={[]}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onCommand={onCommand}
      onSkill={onSkill}
      onCreateSkill={noop}
    />
  );
}

function ResolvedItemsHarness({ skills }: { skills: SkillVersionSummary[] }) {
  const [resolvedItems, setResolvedItems] = useState<readonly ComposerSlashMenuResolvedItem[]>([]);
  return (
    <>
      <output data-testid="resolved-item-count">{resolvedItems.length}</output>
      <ComposerSlashMenu
        commands={BUILTIN_SLASH_COMMANDS}
        skills={skills}
        loading={false}
        query=""
        selectedSkillVersionIds={[]}
        activeIndex={0}
        onActiveIndexChange={noop}
        onCommand={noop}
        onSkill={noop}
        onCreateSkill={noop}
        onResolvedItemsChange={setResolvedItems}
      />
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ComposerSlashMenu', () => {
  it('keeps default lookup maps stable when resolved items update parent state', () => {
    render(<ResolvedItemsHarness skills={[skill(1)]} />);

    expect(screen.getByTestId('resolved-item-count').textContent).toBe('6');
    expect(screen.getAllByRole('option')).toHaveLength(6);
  });

  it('renders the exact NewMax built-ins with icons and forwards selection', () => {
    const onCommand = vi.fn();
    renderMenu({ onCommand, className: 'fixture-menu', style: { width: 744 }, placement: 'below' });

    const menu = screen.getByRole('listbox', { name: '斜杠命令与 Skill' });
    const options = within(menu).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('data-command'))).toEqual([
      '/help',
      '/plan',
      '/goal',
      '/compact',
      '/mcp',
    ]);
    expect(options.every((option) => option.querySelector('svg'))).toBe(true);
    expect(menu.classList.contains('fixture-menu')).toBe(true);
    expect(menu.getAttribute('data-placement')).toBe('below');
    expect((menu as HTMLElement).style.width).toBe('744px');
    expect(within(menu).queryByText('命令')).toBeNull();
    expect(
      options[options.length - 1]?.compareDocumentPosition(screen.getByText('Skills')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(within(menu).getByRole('option', { name: /规划模式/ }));
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plan', command: '/plan' }),
    );
  });

  it('moves category selection with Tab, Shift+Tab and horizontal arrows', () => {
    expect(COMPOSER_SKILL_CATEGORIES).toEqual([
      'all',
      'development',
      'writing',
      'productivity',
      'research',
      'communication',
      'data',
      'creative',
      'other',
    ]);
    const available = ['all', 'development', 'research'] as const;
    expect(nextComposerSkillCategory('all', 'Tab', false, available)).toBe('development');
    expect(nextComposerSkillCategory('all', 'Tab', true, available)).toBe('research');
    expect(nextComposerSkillCategory('development', 'ArrowRight', false, available)).toBe(
      'research',
    );
    expect(nextComposerSkillCategory('development', 'ArrowLeft', false, available)).toBe('all');
    expect(nextComposerSkillCategory('research', 'ArrowRight', false, available)).toBe('all');
  });

  it('selects the first item when the menu opens or its category changes', () => {
    const onActiveIndexChange = vi.fn();
    renderMenu({
      skills: [skill(1)],
      categoryBySkillVersionId: { 'skill-1': 'development' },
      onActiveIndexChange,
    });
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(0);

    onActiveIndexChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '开发' }));
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('applies NewMax keyboard navigation and ignores Enter during IME composition', () => {
    const onCommand = vi.fn();
    const onSkill = vi.fn();
    render(
      <KeyboardMenu
        skills={[
          skill(1, { name: 'Code Review' }),
          skill(2, { name: 'Research Review' }),
        ]}
        onCommand={onCommand}
        onSkill={onSkill}
      />,
    );

    const menu = screen.getByRole('listbox', { name: '斜杠命令与 Skill' });
    expect(
      within(menu)
        .getByRole('option', { name: /引导帮助/ })
        .getAttribute('aria-selected'),
    ).toBe('true');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(
      within(menu)
        .getByRole('option', { name: /规划模式/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(
      within(menu)
        .getByRole('option', { name: /引导帮助/ })
        .getAttribute('aria-selected'),
    ).toBe('true');

    fireEvent.keyDown(menu, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onCommand).not.toHaveBeenCalled();
    expect(onSkill).not.toHaveBeenCalled();

    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'help' }));

    // With only uncategorized Skills, the visible category cycle is 全部 ↔ 其他.
    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '其他' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(menu).getByRole('option', { name: /引导帮助/ })).toBeTruthy();
    expect(screen.getByText('/Code Review')).toBeTruthy();
    expect(screen.getByText('/Research Review')).toBeTruthy();

    fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: '其他' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('reports the actual selectable items after category filtering and sorting', () => {
    const onResolvedItemsChange =
      vi.fn<(items: readonly ComposerSlashMenuResolvedItem[]) => void>();
    renderMenu({
      skills: [
        skill(1, { name: 'Zulu' }),
        skill(2, { name: 'Alpha' }),
        skill(4, { name: 'Legacy', enabled: undefined }),
        skill(3, { name: 'Hidden', enabled: false }),
      ],
      categoryBySkillVersionId: {
        'skill-1': 'writing',
        'skill-2': 'development',
        'skill-4': 'writing',
      },
      onResolvedItemsChange,
    });

    expect(onResolvedItemsChange).toHaveBeenLastCalledWith([
      ...BUILTIN_SLASH_COMMANDS.map((command) => ({ kind: 'command', command })),
      { kind: 'skill', skill: expect.objectContaining({ skillVersionId: 'skill-2' }) },
      { kind: 'skill', skill: expect.objectContaining({ skillVersionId: 'skill-4' }) },
      { kind: 'skill', skill: expect.objectContaining({ skillVersionId: 'skill-1' }) },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '写作' }));
    expect(onResolvedItemsChange).toHaveBeenLastCalledWith([
      ...BUILTIN_SLASH_COMMANDS.map((command) => ({ kind: 'command', command })),
      { kind: 'skill', skill: expect.objectContaining({ skillVersionId: 'skill-4' }) },
      { kind: 'skill', skill: expect.objectContaining({ skillVersionId: 'skill-1' }) },
    ]);
  });

  it('shows only categories used by Skills while query searches every category', () => {
    const skills = [
      skill(1, { name: 'Code Review' }),
      skill(2, { name: 'Research Review' }),
    ];
    const onAvailableCategoriesChange = vi.fn();
    const categoryBySkillVersionId = {
      'skill-1': 'development' as const,
      'skill-2': 'research' as const,
    };
    const view = renderMenu({
      skills,
      categoryBySkillVersionId,
      onAvailableCategoriesChange,
    });

    expect(onAvailableCategoriesChange).toHaveBeenLastCalledWith([
      'all',
      'development',
      'research',
    ]);
    expect(screen.getAllByRole('button', { name: /^(全部|开发|研究)$/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '其他' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '开发' }));
    expect(screen.getByText('/Code Review')).toBeTruthy();
    expect(screen.queryByText('/Research Review')).toBeNull();
    expect(screen.getByRole('option', { name: /引导帮助/ })).toBeTruthy();

    view.rerender(
      <ComposerSlashMenu
        commands={BUILTIN_SLASH_COMMANDS}
        skills={skills}
        loading={false}
        query="research"
        selectedSkillVersionIds={[]}
        categoryBySkillVersionId={categoryBySkillVersionId}
        activeIndex={-1}
        onActiveIndexChange={noop}
        onCommand={noop}
        onSkill={noop}
        onCreateSkill={noop}
      />,
    );
    expect(screen.getByText('/Research Review')).toBeTruthy();
  });

  it('places categories before Skills below the composer and in the footer above it', () => {
    const props = {
      skills: [skill(1)],
      categoryBySkillVersionId: { 'skill-1': 'creative' as const },
    };
    const view = renderMenu({ ...props, placement: 'below' });
    const menu = screen.getByRole('listbox', { name: '斜杠命令与 Skill' });
    const categories = within(menu).getByRole('group', { name: 'Skill 分类' });
    const skillOption = screen.getByTestId('composer-skill-option-skill-1');
    expect(categories.getAttribute('data-category-position')).toBe('before-list');
    expect(categories.compareDocumentPosition(skillOption) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    view.rerender(
      <ComposerSlashMenu
        commands={BUILTIN_SLASH_COMMANDS}
        skills={props.skills}
        categoryBySkillVersionId={props.categoryBySkillVersionId}
        loading={false}
        query=""
        selectedSkillVersionIds={[]}
        activeIndex={-1}
        onActiveIndexChange={noop}
        onCommand={noop}
        onSkill={noop}
        onCreateSkill={noop}
        placement="above"
      />,
    );
    const footerCategories = screen.getByRole('group', { name: 'Skill 分类' });
    expect(footerCategories.getAttribute('data-category-position')).toBe('footer');
    expect(
      screen
        .getByTestId('composer-skill-option-skill-1')
        .compareDocumentPosition(footerCategories) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders NewMax Skill source meta, source icons, and enabled wording', () => {
    renderMenu({
      skills: [
        skill(1, { name: 'Plugin Skill', originRef: 'plugin://review/skill' }),
        skill(2, { name: 'Project Skill', originRef: 'project://current/skill' }),
        skill(3, { name: 'Org Skill', originRef: 'org://shared/skill' }),
        skill(4, { name: 'User Skill', originRef: 'user://library/skill' }),
      ],
      selectedSkillVersionIds: ['skill-1', 'skill-4'],
    });

    const plugin = screen.getByTestId('composer-skill-option-skill-1');
    const project = screen.getByTestId('composer-skill-option-skill-2');
    const org = screen.getByTestId('composer-skill-option-skill-3');
    const user = screen.getByTestId('composer-skill-option-skill-4');
    expect(plugin.getAttribute('data-skill-source')).toBe('plugin');
    expect(plugin.querySelector('.lucide-power')).toBeTruthy();
    expect(project.querySelector('.lucide-book-open')).toBeTruthy();
    expect(within(plugin).getByText('插件')).toBeTruthy();
    expect(within(project).getByText('项目')).toBeTruthy();
    expect(within(org).getByText('组织')).toBeTruthy();
    expect(within(user).queryByText(/个人|用户/)).toBeNull();
    expect(screen.getAllByText('已启用')).toHaveLength(2);
    expect(screen.queryByText('已选')).toBeNull();
  });

  it('sorts from one NewMax control and persists pins by Skill name', () => {
    const skills = [skill(1, { name: 'Beta' }), skill(2, { name: 'Alpha' })];
    const view = renderMenu({ skills, usageBySkillVersionId: { Beta: 12, Alpha: 3 } });

    const names = () =>
      screen
        .getAllByTestId(/composer-skill-option-/)
        .map((node) => node.getAttribute('data-skill-name'));
    expect(names()).toEqual(['Alpha', 'Beta']);

    const sortTrigger = screen.getByRole('button', { name: '排序 Skill' });
    expect(sortTrigger.textContent).toContain('按名称');
    expect(sortTrigger.querySelector('.lucide-arrow-up-down')).toBeTruthy();
    expect(sortTrigger.querySelector('.lucide-chevron-down')).toBeTruthy();
    fireEvent.click(sortTrigger);
    expect(screen.getByRole('menu', { name: 'Skill 排序' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemradio', { name: '按常用' }));
    expect(screen.getByRole('button', { name: '排序 Skill' }).textContent).toContain('按常用');
    expect(names()).toEqual(['Alpha', 'Beta']);

    fireEvent.click(screen.getByRole('button', { name: '排序 Skill' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '倒序' }));
    expect(names()).toEqual(['Beta', 'Alpha']);

    fireEvent.click(screen.getByRole('button', { name: '置顶 Skill Alpha' }));
    expect(names()).toEqual(['Alpha', 'Beta']);
    expect(readPinnedComposerSkills()).toEqual(['Alpha']);

    view.rerender(
      <ComposerSlashMenu
        commands={BUILTIN_SLASH_COMMANDS}
        skills={[skill(20, { skillVersionId: 'skill-new-alpha', name: 'Alpha' })]}
        loading={false}
        query=""
        selectedSkillVersionIds={[]}
        activeIndex={-1}
        onActiveIndexChange={noop}
        onCommand={noop}
        onSkill={noop}
        onCreateSkill={noop}
        usageBySkillVersionId={{ Alpha: 3 }}
      />,
    );
    expect(screen.getByRole('button', { name: '取消置顶 Skill Alpha' })).toBeTruthy();
  });

  it('keeps pin storage bounded, unique, and tolerant of corrupt JSON', () => {
    writePinnedComposerSkills([
      'one',
      'one',
      '',
      ...Array.from({ length: 120 }, (_, i) => `s-${i}`),
    ]);
    const pinned = readPinnedComposerSkills();
    expect(pinned[0]).toBe('one');
    expect(new Set(pinned).size).toBe(pinned.length);
    expect(pinned).toHaveLength(100);

    window.localStorage.setItem('sync-think.composer.slash-pins.v1', '{bad');
    expect(readPinnedComposerSkills()).toEqual([]);
  });

  it('renders 15 Skills initially and adds 15 near the scroll boundary', () => {
    const onResolvedItemsChange =
      vi.fn<(items: readonly ComposerSlashMenuResolvedItem[]) => void>();
    renderMenu({
      skills: Array.from({ length: 34 }, (_, index) => skill(index + 1)),
      onResolvedItemsChange,
    });
    expect(screen.getAllByTestId(/composer-skill-option-/)).toHaveLength(15);
    expect(onResolvedItemsChange.mock.lastCall?.[0]).toHaveLength(20);

    const scroller = screen.getByTestId('composer-slash-scroll');
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 260 },
    });
    fireEvent.scroll(scroller);
    expect(screen.getAllByTestId(/composer-skill-option-/)).toHaveLength(30);

    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 300 });
    fireEvent.scroll(scroller);
    expect(screen.getAllByTestId(/composer-skill-option-/)).toHaveLength(34);
    expect(onResolvedItemsChange.mock.lastCall?.[0]).toHaveLength(39);
  });

  it('shows selection/loading state and exposes Skill/create callbacks', () => {
    const onSkill = vi.fn();
    const onCreateSkill = vi.fn();
    const onActiveIndexChange = vi.fn();
    renderMenu({
      skills: [skill(1, { name: 'Review' })],
      loading: true,
      selectedSkillVersionIds: ['skill-1'],
      activeIndex: 5,
      onSkill,
      onCreateSkill,
      onActiveIndexChange,
    });

    expect(screen.getByText('正在读取已启用 Skill…')).toBeTruthy();
    const option = screen.getByTestId('composer-skill-option-skill-1');
    expect(option.getAttribute('data-selected')).toBe('true');
    expect(within(option).getByText('已启用')).toBeTruthy();
    fireEvent.mouseEnter(option);
    expect(onActiveIndexChange).toHaveBeenCalledWith(5);
    fireEvent.click(option);
    expect(onSkill).toHaveBeenCalledWith(expect.objectContaining({ skillVersionId: 'skill-1' }));

    fireEvent.click(screen.getByRole('button', { name: '创建 Skill' }));
    expect(onCreateSkill).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicitly closed menu mounted through the 150ms exit phase', () => {
    vi.useFakeTimers();
    const props: React.ComponentProps<typeof ComposerSlashMenu> = {
      open: true,
      commands: BUILTIN_SLASH_COMMANDS,
      skills: [],
      loading: false,
      query: '',
      selectedSkillVersionIds: [],
      activeIndex: 0,
      onActiveIndexChange: noop,
      onCommand: noop,
      onSkill: noop,
      onCreateSkill: noop,
    };
    const view = render(<ComposerSlashMenu {...props} />);
    const menu = screen.getByTestId('composer-slash-menu');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');

    act(() => vi.advanceTimersByTime(NEWMAX_POPOVER_TRANSITION_MS));
    expect(menu.getAttribute('data-motion-state')).toBe('stable');

    view.rerender(<ComposerSlashMenu {...props} open={false} />);
    expect(menu.getAttribute('data-motion-state')).toBe('exiting');
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(NEWMAX_POPOVER_TRANSITION_MS - 1));
    expect(screen.getByTestId('composer-slash-menu')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('composer-slash-menu')).toBeNull();
  });
});
