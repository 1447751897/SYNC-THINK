export type UiDesignNode =
  | { type: 'heading'; text: string; level?: 1 | 2 | 3 }
  | { type: 'text'; text: string }
  | { type: 'metric'; label: string; value: string; detail?: string; tone?: 'neutral' | 'positive' | 'warning' }
  | { type: 'card'; title: string; text?: string; accent?: string }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'form'; fields: { label: string; value?: string; kind?: 'text' | 'select' | 'toggle' }[]; submitLabel?: string };

export interface UiDesignArtifact {
  version: 1;
  type: 'ui-design';
  title: string;
  subtitle?: string;
  sidebar?: { title?: string; items: { label: string; active?: boolean; badge?: string }[] };
  nodes: UiDesignNode[];
}

const MAX_BYTES = 180_000;
const MAX_NODES = 40;
const MAX_ITEMS = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
}

function parseNode(value: unknown): UiDesignNode | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'heading' || value.type === 'text') {
    const content = text(value.text);
    if (!content) return undefined;
    if (value.type === 'text') return { type: 'text', text: content };
    const level = value.level === 1 || value.level === 2 || value.level === 3 ? value.level : 2;
    return { type: 'heading', text: content, level };
  }
  if (value.type === 'metric' || value.type === 'card') {
    const label = text(value.label ?? value.title);
    const valueText = value.type === 'metric' ? text(value.value) : undefined;
    if (!label || (value.type === 'metric' && !valueText)) return undefined;
    if (value.type === 'metric') {
      const tone = value.tone === 'positive' || value.tone === 'warning' ? value.tone : 'neutral';
      return { type: 'metric', label, value: valueText!, detail: text(value.detail), tone };
    }
    return { type: 'card', title: label, text: text(value.text), accent: text(value.accent, 32) };
  }
  if (value.type === 'list') {
    if (!Array.isArray(value.items)) return undefined;
    const items = value.items.map((item) => text(item, 180)).filter((item): item is string => Boolean(item)).slice(0, MAX_ITEMS);
    return items.length ? { type: 'list', title: text(value.title), items } : undefined;
  }
  if (value.type === 'table') {
    if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) return undefined;
    const columns = value.columns.map((item) => text(item, 80)).filter((item): item is string => Boolean(item)).slice(0, 12);
    const rows = value.rows.slice(0, MAX_ITEMS).map((row) =>
      Array.isArray(row) ? row.slice(0, columns.length).map((item) => text(item, 120) ?? '') : [],
    ).filter((row) => row.length === columns.length);
    return columns.length && rows.length ? { type: 'table', columns, rows } : undefined;
  }
  if (value.type === 'form') {
    if (!Array.isArray(value.fields)) return undefined;
    const fields = value.fields.slice(0, 12).map((field) => {
      if (!isRecord(field)) return undefined;
      const label = text(field.label, 100);
      if (!label) return undefined;
      const kind = field.kind === 'select' || field.kind === 'toggle' ? field.kind : 'text';
      return { label, value: text(field.value, 180), kind };
    }).filter((field): field is { label: string; value: string | undefined; kind: 'text' | 'select' | 'toggle' } => Boolean(field));
    return fields.length ? { type: 'form', fields, submitLabel: text(value.submitLabel, 80) } : undefined;
  }
  return undefined;
}

export function parseUiDesignArtifact(value: unknown): UiDesignArtifact | undefined {
  if (!isRecord(value) || value.version !== 1 || value.type !== 'ui-design') return undefined;
  const title = text(value.title, 160);
  if (!title || !Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) return undefined;
  const nodes = value.nodes.map(parseNode).filter((node): node is UiDesignNode => Boolean(node));
  if (nodes.length !== value.nodes.length) return undefined;
  const sidebarValue = value.sidebar;
  let sidebar: UiDesignArtifact['sidebar'];
  if (sidebarValue !== undefined) {
    if (!isRecord(sidebarValue) || !Array.isArray(sidebarValue.items)) return undefined;
    const items = sidebarValue.items.slice(0, MAX_ITEMS).map((item) => {
      if (!isRecord(item)) return undefined;
      const label = text(item.label, 100);
      return label ? { label, active: item.active === true, badge: text(item.badge, 24) } : undefined;
    }).filter((item): item is { label: string; active: boolean; badge: string | undefined } => Boolean(item));
    if (items.length !== sidebarValue.items.length) return undefined;
    sidebar = { title: text(sidebarValue.title, 100), items };
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return { version: 1, type: 'ui-design', title, subtitle: text(value.subtitle, 240), sidebar, nodes };
}

export function parseUiDesignJson(raw: string): UiDesignArtifact | undefined {
  try {
    const textValue = raw.trim().replace(/^```(?:design-ui|ui-design|json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return parseUiDesignArtifact(JSON.parse(textValue));
  } catch {
    return undefined;
  }
}
