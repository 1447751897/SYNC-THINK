import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import {
  Archive,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  CircleCheck,
  Lightbulb,
  Paperclip,
  Pin,
  Plus,
  Power,
  Target,
} from 'lucide-react';
import type { SkillVersionSummary } from '@sync-think/protocol';
import { BUILTIN_SLASH_COMMANDS, filterSlashCommands, type SlashCommand } from './compose-slash.js';
import { ComposerMenuHighlight } from './ComposerMenuHighlight.js';
import { useNewMaxPopoverPresence } from './NewMaxComposerFrame.js';

export const COMPOSER_SKILL_CATEGORIES = [
  'all',
  'development',
  'writing',
  'productivity',
  'research',
  'communication',
  'data',
  'creative',
  'other',
] as const;
export type ComposerSkillCategory = (typeof COMPOSER_SKILL_CATEGORIES)[number];
export type ComposerSkillMarketCategory = Exclude<ComposerSkillCategory, 'all'>;
export type ComposerSkillSort = 'name' | 'usage';
export type ComposerSkillSortDirection = 'asc' | 'desc';
type ComposerSkillSource = 'plugin' | 'project' | 'org' | 'user';

export type ComposerSlashMenuResolvedItem =
  { kind: 'command'; command: SlashCommand } | { kind: 'skill'; skill: SkillVersionSummary };

export type ComposerSlashMenuKeyboardAction =
  | { kind: 'change-category'; category: ComposerSkillCategory }
  | { kind: 'change-active-index'; index: number }
  | { kind: 'select'; index: number };

export function resolveComposerSlashMenuKeyboardAction(input: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  category: ComposerSkillCategory;
  activeIndex: number;
  itemCount: number;
  availableCategories?: readonly ComposerSkillCategory[];
}): ComposerSlashMenuKeyboardAction | null {
  if (input.key === 'Tab' || input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
    return {
      kind: 'change-category',
      category: nextComposerSkillCategory(
        input.category,
        input.key,
        input.key === 'Tab' && input.shiftKey,
        input.availableCategories,
      ),
    };
  }
  if (input.itemCount <= 0) return null;
  if (input.key === 'ArrowDown') {
    return {
      kind: 'change-active-index',
      index: input.activeIndex < 0 ? 0 : (input.activeIndex + 1) % input.itemCount,
    };
  }
  if (input.key === 'ArrowUp') {
    return {
      kind: 'change-active-index',
      index:
        input.activeIndex < 0
          ? input.itemCount - 1
          : (input.activeIndex - 1 + input.itemCount) % input.itemCount,
    };
  }
  if (
    input.key === 'Enter' &&
    !input.isComposing &&
    input.activeIndex >= 0 &&
    input.activeIndex < input.itemCount
  ) {
    return { kind: 'select', index: input.activeIndex };
  }
  return null;
}

const CATEGORY_LABELS: Record<ComposerSkillCategory, string> = {
  all: '全部',
  development: '开发',
  writing: '写作',
  productivity: '效率',
  research: '研究',
  communication: '沟通',
  data: '数据',
  creative: '创意',
  other: '其他',
};

const SKILL_SOURCE_LABELS: Readonly<Record<ComposerSkillSource, string | undefined>> = {
  plugin: '插件',
  project: '项目',
  org: '组织',
  user: undefined,
};

const PAGE_SIZE = 15;
const LOAD_MORE_THRESHOLD = 48;
const MAX_PINNED_SKILLS = 100;
const EMPTY_SKILL_USAGE: Readonly<Record<string, number>> = Object.freeze({});
const EMPTY_SKILL_CATEGORIES: Readonly<
  Record<string, ComposerSkillMarketCategory | undefined>
> = Object.freeze({});
export const COMPOSER_SKILL_PINS_STORAGE_KEY = 'sync-think.composer.slash-pins.v1';

type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(storage?: PinStorage): PinStorage | undefined {
  if (storage) return storage;
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function readPinnedComposerSkills(storage?: PinStorage): string[] {
  const target = browserStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(COMPOSER_SKILL_PINS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string'))]
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_PINNED_SKILLS);
  } catch {
    return [];
  }
}

export function writePinnedComposerSkills(
  skillNames: readonly string[],
  storage?: PinStorage,
): string[] {
  const next = [...new Set(skillNames.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    MAX_PINNED_SKILLS,
  );
  try {
    browserStorage(storage)?.setItem(COMPOSER_SKILL_PINS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Pinning remains usable for this render when browser persistence is unavailable.
  }
  return next;
}

export function nextComposerSkillCategory(
  current: ComposerSkillCategory,
  key: 'Tab' | 'ArrowLeft' | 'ArrowRight',
  shiftKey = false,
  availableCategories: readonly ComposerSkillCategory[] = COMPOSER_SKILL_CATEGORIES,
): ComposerSkillCategory {
  const categories: readonly ComposerSkillCategory[] =
    availableCategories.length > 0 ? availableCategories : ['all'];
  const currentIndex = Math.max(0, categories.indexOf(current));
  const backwards = key === 'ArrowLeft' || (key === 'Tab' && shiftKey);
  const delta = backwards ? -1 : 1;
  return categories[(currentIndex + delta + categories.length) % categories.length]!;
}

function isComposerSkillMarketCategory(value: unknown): value is ComposerSkillMarketCategory {
  return (
    typeof value === 'string' &&
    value !== 'all' &&
    COMPOSER_SKILL_CATEGORIES.includes(value as ComposerSkillCategory)
  );
}

function inferredSkillCategory(skill: SkillVersionSummary): ComposerSkillMarketCategory {
  const category = (skill as SkillVersionSummary & { category?: unknown }).category;
  return isComposerSkillMarketCategory(category) ? category : 'other';
}

function resolveComposerSkillSource(skill: SkillVersionSummary): ComposerSkillSource {
  const extended = skill as SkillVersionSummary & {
    location?: unknown;
    sourceType?: unknown;
  };
  const explicit = extended.location ?? extended.sourceType;
  if (explicit === 'plugin' || explicit === 'project' || explicit === 'org' || explicit === 'user') {
    return explicit;
  }
  const origin = skill.originRef?.trim().toLocaleLowerCase() ?? '';
  if (origin.startsWith('plugin://')) return 'plugin';
  if (origin.startsWith('project://') || origin.startsWith('workspace://')) return 'project';
  if (origin.startsWith('org://') || origin.startsWith('organization://')) return 'org';
  return 'user';
}

export function resolveAvailableComposerSkillCategories(
  skills: readonly SkillVersionSummary[],
  categoryBySkillVersionId: Readonly<
    Record<string, ComposerSkillMarketCategory | undefined>
  > = EMPTY_SKILL_CATEGORIES,
): readonly ComposerSkillCategory[] {
  const categoriesInUse = new Set<ComposerSkillMarketCategory>();
  for (const skill of skills) {
    if (skill.enabled === false) continue;
    categoriesInUse.add(
      categoryBySkillVersionId[skill.skillVersionId] ?? inferredSkillCategory(skill),
    );
  }
  return [
    'all',
    ...COMPOSER_SKILL_CATEGORIES.filter(
      (category): category is ComposerSkillMarketCategory =>
        category !== 'all' && categoriesInUse.has(category),
    ),
  ];
}

function commandIcon(command: SlashCommand) {
  const props = { size: 14, strokeWidth: 1.8, 'aria-hidden': true as const };
  if (command.id === 'help') return <Lightbulb {...props} />;
  if (command.id === 'plan') return <CircleCheck {...props} />;
  if (command.id === 'goal') return <Target {...props} />;
  if (command.id === 'compact') return <Archive {...props} />;
  if (command.id === 'mcp') return <Paperclip {...props} />;
  return <BookOpen {...props} />;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export interface ComposerSlashMenuProps {
  open?: boolean;
  commands?: readonly SlashCommand[];
  skills: readonly SkillVersionSummary[];
  loading: boolean;
  query: string;
  selectedSkillVersionIds: readonly string[];
  activeIndex: number;
  onActiveIndexChange(index: number): void;
  onCommand(command: SlashCommand): void;
  onSkill(skill: SkillVersionSummary): void;
  onCreateSkill(): void;
  className?: string;
  style?: CSSProperties;
  placement?: 'above' | 'below';
  testId?: string;
  menuRef?: Ref<HTMLDivElement>;
  listRef?: Ref<HTMLDivElement>;
  usageBySkillVersionId?: Readonly<Record<string, number>>;
  categoryBySkillVersionId?: Readonly<
    Record<string, ComposerSkillMarketCategory | undefined>
  >;
  category?: ComposerSkillCategory;
  onCategoryChange?(category: ComposerSkillCategory): void;
  onAvailableCategoriesChange?(categories: readonly ComposerSkillCategory[]): void;
  onResolvedItemsChange?(items: readonly ComposerSlashMenuResolvedItem[]): void;
  pinStorage?: PinStorage;
}

export function ComposerSlashMenu({
  open = true,
  commands = BUILTIN_SLASH_COMMANDS,
  skills,
  loading,
  query,
  selectedSkillVersionIds,
  activeIndex,
  onActiveIndexChange,
  onCommand,
  onSkill,
  onCreateSkill,
  className,
  style,
  placement = 'above',
  testId = 'composer-slash-menu',
  menuRef,
  listRef,
  usageBySkillVersionId = EMPTY_SKILL_USAGE,
  categoryBySkillVersionId = EMPTY_SKILL_CATEGORIES,
  category,
  onCategoryChange,
  onAvailableCategoriesChange,
  onResolvedItemsChange,
  pinStorage,
}: ComposerSlashMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const menuPresence = useNewMaxPopoverPresence(open);
  const [internalCategory, setInternalCategory] = useState<ComposerSkillCategory>('all');
  const [sortMode, setSortMode] = useState<ComposerSkillSort>('name');
  const [sortDirection, setSortDirection] = useState<ComposerSkillSortDirection>('asc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [pinnedSkillNames, setPinnedSkillNames] = useState<string[]>(() =>
    readPinnedComposerSkills(pinStorage),
  );
  const [visibleSkillLimit, setVisibleSkillLimit] = useState(PAGE_SIZE);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const skillRevision = skills.map((item) => item.skillVersionId).join('\u0000');
  const availableCategories = useMemo(
    () => resolveAvailableComposerSkillCategories(skills, categoryBySkillVersionId),
    [categoryBySkillVersionId, skills],
  );
  const requestedCategory = category ?? internalCategory;
  const activeCategory = availableCategories.includes(requestedCategory) ? requestedCategory : 'all';

  const filteredCommands = useMemo(() => filterSlashCommands(query, commands), [commands, query]);

  const sortedSkills = useMemo(() => {
    const pinOrder = new Map(pinnedSkillNames.map((name, index) => [name, index]));
    const filtered = skills.filter((item) => {
      // Older Runtime payloads omit `enabled`; only an explicit false disables a Skill.
      if (item.enabled === false) return false;
      const categoryForSkill =
        categoryBySkillVersionId[item.skillVersionId] ?? inferredSkillCategory(item);
      if (!normalizedQuery && activeCategory !== 'all' && categoryForSkill !== activeCategory) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [item.name, item.description, item.skillId, item.version]
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
    return filtered.sort((left, right) => {
      const leftPin = pinOrder.get(left.name);
      const rightPin = pinOrder.get(right.name);
      if (leftPin !== undefined || rightPin !== undefined) {
        if (leftPin === undefined) return 1;
        if (rightPin === undefined) return -1;
        if (leftPin !== rightPin) return leftPin - rightPin;
      }
      let comparison = 0;
      if (sortMode === 'usage') {
        comparison =
          (usageBySkillVersionId[left.name] ??
            usageBySkillVersionId[left.skillVersionId] ??
            0) -
          (usageBySkillVersionId[right.name] ??
            usageBySkillVersionId[right.skillVersionId] ??
            0);
      } else {
        comparison = left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'base' });
      }
      if (comparison === 0) comparison = left.skillVersionId.localeCompare(right.skillVersionId);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [
    activeCategory,
    categoryBySkillVersionId,
    normalizedQuery,
    pinnedSkillNames,
    skills,
    sortDirection,
    sortMode,
    usageBySkillVersionId,
  ]);

  const visibleCommands = filteredCommands;
  const visibleSkills = useMemo(
    () => sortedSkills.slice(0, visibleSkillLimit),
    [sortedSkills, visibleSkillLimit],
  );
  const resolvedItems = useMemo<readonly ComposerSlashMenuResolvedItem[]>(
    () => [
      ...visibleCommands.map((command) => ({ kind: 'command' as const, command })),
      ...visibleSkills.map((skill) => ({ kind: 'skill' as const, skill })),
    ],
    [visibleCommands, visibleSkills],
  );

  useEffect(() => {
    setVisibleSkillLimit(PAGE_SIZE);
  }, [activeCategory, normalizedQuery, skillRevision, sortDirection, sortMode]);

  useEffect(() => {
    if (open) return;
    setSortMenuOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    onResolvedItemsChange?.(resolvedItems);
  }, [onResolvedItemsChange, open, resolvedItems]);

  useEffect(() => {
    if (!open) return;
    onAvailableCategoriesChange?.(availableCategories);
  }, [availableCategories, onAvailableCategoriesChange, open]);

  useEffect(() => {
    if (requestedCategory === activeCategory) return;
    if (category === undefined) setInternalCategory(activeCategory);
    onCategoryChange?.(activeCategory);
  }, [activeCategory, category, onCategoryChange, requestedCategory]);

  useEffect(() => {
    if (!open) return;
    onActiveIndexChange(0);
  }, [activeCategory, normalizedQuery, onActiveIndexChange, open]);

  const changeCategory = useCallback(
    (next: ComposerSkillCategory) => {
      if (category === undefined) setInternalCategory(next);
      onCategoryChange?.(next);
    },
    [category, onCategoryChange],
  );

  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      assignRef(menuRef, node);
    },
    [menuRef],
  );
  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      assignRef(listRef, node);
    },
    [listRef],
  );

  const togglePin = useCallback(
    (skillName: string) => {
      setPinnedSkillNames((current) => {
        const next = current.includes(skillName)
          ? current.filter((item) => item !== skillName)
          : [...current, skillName];
        return writePinnedComposerSkills(next, pinStorage);
      });
      onActiveIndexChange(-1);
    },
    [onActiveIndexChange, pinStorage],
  );

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight > LOAD_MORE_THRESHOLD) return;
    setVisibleSkillLimit((current) => Math.min(sortedSkills.length, current + PAGE_SIZE));
  };

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!open) return;
      if (event.target !== event.currentTarget) return;
      const nativeEvent = event.nativeEvent as KeyboardEvent;
      const action = resolveComposerSlashMenuKeyboardAction({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: nativeEvent.isComposing || nativeEvent.keyCode === 229,
        category: activeCategory,
        activeIndex,
        itemCount: resolvedItems.length,
        availableCategories,
      });
      if (!action) return;
      event.preventDefault();
      if (action.kind === 'change-category') {
        changeCategory(action.category);
        return;
      }
      if (action.kind === 'change-active-index') {
        onActiveIndexChange(action.index);
        return;
      }
      const item = resolvedItems[action.index];
      if (item?.kind === 'command') onCommand(item.command);
      else if (item?.kind === 'skill') onSkill(item.skill);
    },
    [
      activeCategory,
      activeIndex,
      availableCategories,
      changeCategory,
      onActiveIndexChange,
      onCommand,
      open,
      onSkill,
      resolvedItems,
    ],
  );

  const categoryTabs = (
    <div
      className={`shell-composer-slash-menu__categories shell-composer-slash-menu__categories--${placement}`}
      role="group"
      aria-label="Skill 分类"
      data-category-position={placement === 'below' ? 'before-list' : 'footer'}
    >
      {availableCategories.map((item) => (
        <button
          key={item}
          type="button"
          className={item === activeCategory ? 'is-active' : ''}
          aria-pressed={item === activeCategory}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => changeCategory(item)}
        >
          {CATEGORY_LABELS[item]}
        </button>
      ))}
    </div>
  );

  if (!menuPresence.rendered) return null;

  return (
    <div
      ref={setRoot}
      className={[
        'shell-mention-pop',
        'shell-slash-pop',
        'shell-composer-slash-menu',
        `shell-composer-slash-menu--${placement}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-testid={testId}
      data-placement={placement}
      data-motion-state={menuPresence.phase}
      role="listbox"
      aria-label="斜杠命令与 Skill"
      aria-hidden={menuPresence.phase === 'exiting' ? 'true' : undefined}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) menuPresence.completeMotion();
      }}
    >
      <div
        ref={setScroller}
        className="shell-composer-slash-menu__scroll"
        data-testid="composer-slash-scroll"
        onScroll={onScroll}
      >
        <ComposerMenuHighlight containerRef={scrollRef} activeIndex={activeIndex} />
        {visibleCommands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            data-command={command.command}
            data-composer-menu-index={index}
            className={`shell-mention-pop__item shell-slash-pop__item ${
              index === activeIndex ? 'is-active' : ''
            }`}
            onMouseEnter={() => onActiveIndexChange(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommand(command)}
          >
            <span className="shell-slash-pop__icon">{commandIcon(command)}</span>
            <span className="shell-slash-pop__meta">
              <span className="shell-slash-pop__identity">
                <span className="shell-slash-pop__label">{command.label}</span>
                <span className="shell-slash-pop__command-tag">{command.command}</span>
              </span>
              <span className="shell-slash-pop__desc">{command.description}</span>
            </span>
          </button>
        ))}

        <div className="shell-composer-slash-menu__skills-head">
          <span className="shell-composer-slash-menu__skills-title">
            Skills {availableCategories.length > 1 ? <small>Tab/←→ 切分类</small> : null}
          </span>
          <span className="shell-composer-slash-menu__skills-actions">
            <span className="shell-composer-slash-menu__sort-control">
              <button
                type="button"
                className="shell-composer-slash-menu__sort-trigger"
                aria-label="排序 Skill"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  setSortMenuOpen((current) => !current);
                }}
              >
                <ArrowUpDown size={14} aria-hidden="true" />
                <span>{sortMode === 'name' ? '按名称' : '按常用'}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {sortMenuOpen ? (
                <div
                  className="shell-composer-slash-menu__sort-menu"
                  role="menu"
                  aria-label="Skill 排序"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {(
                    [
                      ['name', '按名称'],
                      ['usage', '按常用'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortMode === value}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSortMode(value);
                        setSortMenuOpen(false);
                        onActiveIndexChange(-1);
                      }}
                    >
                      <span>{label}</span>
                      {sortMode === value ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                  ))}
                  <span className="shell-composer-slash-menu__sort-divider" role="separator" />
                  {(
                    [
                      ['asc', '正序'],
                      ['desc', '倒序'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortDirection === value}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSortDirection(value);
                        setSortMenuOpen(false);
                        onActiveIndexChange(-1);
                      }}
                    >
                      <span>{label}</span>
                      {sortDirection === value ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
            <button
              type="button"
              className="shell-composer-slash-menu__create"
              aria-label="创建 Skill"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onCreateSkill}
            >
              <Plus size={13} aria-hidden="true" />
              <span>创建 Skill</span>
            </button>
          </span>
        </div>

        {placement === 'below' ? categoryTabs : null}

        {loading ? <div className="shell-mention-pop__empty">正在读取已启用 Skill…</div> : null}
        {!loading && visibleSkills.length === 0 ? (
          <div className="shell-mention-pop__empty">
            {normalizedQuery ? '无匹配命令或 Skill' : '当前分类没有 Skill'}
          </div>
        ) : null}
        {visibleSkills.map((item, skillIndex) => {
          const index = visibleCommands.length + skillIndex;
          const selected = selectedSkillVersionIds.includes(item.skillVersionId);
          const pinned = pinnedSkillNames.includes(item.name);
          const source = resolveComposerSkillSource(item);
          const sourceLabel = SKILL_SOURCE_LABELS[source];
          return (
            <div
              key={item.skillVersionId}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              data-composer-menu-index={index}
              data-testid={`composer-skill-option-${item.skillVersionId}`}
              data-skill-name={item.name}
              data-skill-source={source}
              data-selected={selected ? 'true' : 'false'}
              className={`shell-mention-pop__item shell-slash-pop__item shell-composer-slash-menu__skill ${
                index === activeIndex ? 'is-active' : ''
              }`}
              onMouseEnter={() => onActiveIndexChange(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSkill(item)}
            >
              <span className="shell-slash-pop__icon">
                {source === 'plugin' ? (
                  <Power size={16} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                )}
              </span>
              <span className="shell-slash-pop__meta">
                <span className="shell-slash-pop__identity">
                  <span className="shell-slash-pop__cmd">/{item.name}</span>
                  {sourceLabel ? <span className="shell-slash-pop__badge">{sourceLabel}</span> : null}
                </span>
                <span className="shell-slash-pop__desc">
                  {item.description || `v${item.version}`}
                </span>
              </span>
              {selected ? (
                <span className="shell-composer-slash-menu__enabled">已启用</span>
              ) : null}
              <button
                type="button"
                className={`shell-composer-slash-menu__pin${pinned ? ' is-pinned' : ''}`}
                aria-label={`${pinned ? '取消置顶' : '置顶'} Skill ${item.name}`}
                title={pinned ? '取消置顶' : '置顶'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  togglePin(item.name);
                }}
              >
                <Pin size={12} fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {placement === 'above' ? categoryTabs : null}
    </div>
  );
}
