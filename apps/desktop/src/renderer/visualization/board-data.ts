import { BOARD_DATA_TYPES, BOARD_DATA_KIT_VERSION } from '@sync-think/shared';
import { createBoardDataCatalog } from './board-data-catalog.js';

/** Runs only in the isolated guest. Keep all executable dependencies inside this function. */
export function mountBoardData(
  catalog: Record<string, string>,
  version: string,
  catalogFactory = createBoardDataCatalog,
): void {
  type Row = Record<string, unknown>;
  const ns = 'http://www.w3.org/2000/svg';
  const palette = [
    'var(--bd-blue)',
    'var(--bd-purple)',
    'var(--bd-green)',
    'var(--bd-yellow)',
    'var(--bd-cyan)',
    'var(--bd-pink)',
  ];
  let id = 0;
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const object = (value: unknown): Row =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Row)
      : fail('数据配置应为 JSON 对象。');
  const text = (value: unknown): string =>
    value == null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value).slice(0, 2048)
        : String(value).slice(0, 2048);
  const number = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const rows = (value: unknown, max = 2000): Row[] => {
    if (!Array.isArray(value) || !value.length)
      return fail('缺少可展示的数据，请提供真实数据或标明示例数据。');
    if (value.length > max) return fail('数据量超过当前展示上限，请分批或明确汇总口径。');
    return value.map(object);
  };
  const valueOf = (row: Row, key: string): unknown =>
    Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
  const formatters = new Map<string, Intl.NumberFormat>();
  const formatter = (locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
    const key = locale + JSON.stringify(options);
    let cached = formatters.get(key);
    if (!cached) {
      cached = new Intl.NumberFormat(locale, options);
      formatters.set(key, cached);
    }
    return cached;
  };
  const fmt = (value: unknown, unit?: unknown): string => {
    const n = number(value);
    const label =
      n === null
        ? value == null
          ? '—'
          : text(value)
        : formatter('zh-CN', { maximumFractionDigits: 2 }).format(n);
    return text(unit) ? label + ' ' + text(unit) : label;
  };
  const formattedValue = (value: unknown, config: Row): string => {
    const n = number(value);
    if (config.format === 'currency' && n !== null)
      return formatter(text(config.currency) === 'CNY' ? 'zh-CN' : 'en-US', {
        style: 'currency',
        currency: text(config.currency) || 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(n);
    return config.format === 'percent' && n !== null
      ? formatter('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(n)
      : fmt(value, config.unit);
  };
  const compact = (value: number): string =>
    new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = '',
    content?: unknown,
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (content !== undefined) e.textContent = text(content);
    return e;
  }
  function svg<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, unknown> = {},
    content?: unknown,
  ): SVGElementTagNameMap[K] {
    const e = document.createElementNS(ns, tag);
    for (const [key, val] of Object.entries(attrs)) e.setAttribute(key, String(val));
    if (content !== undefined) e.textContent = text(content);
    return e;
  }
  const svgRoot = (width: number, height: number, title: string): SVGSVGElement => {
    const e = svg('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width,
      height,
      role: 'img',
      'aria-label': title,
      tabindex: 0,
    });
    e.append(svg('title', {}, title));
    return e;
  };
  const color = (i: number): string => palette[i % palette.length]!;
  const button = (label: string, cls = 'bd-button'): HTMLButtonElement => {
    const e = el('button', cls, label);
    e.type = 'button';
    return e;
  };
  function delta(value: unknown): HTMLElement | undefined {
    if (value == null) return;
    const n = number(value);
    const s = text(value);
    const e = el(
      'span',
      'bd-delta',
      n !== null ? (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n)) + '%' : s,
    );
    e.dataset.direction =
      n !== null
        ? n > 0
          ? 'up'
          : n < 0
            ? 'down'
            : 'flat'
        : s.startsWith('+')
          ? 'up'
          : s.startsWith('-')
            ? 'down'
            : 'flat';
    return e;
  }
  function caption(target: HTMLElement, config: Row): void {
    const parts = [
      config.unit ? '单位：' + text(config.unit) : '',
      config.source ? '来源：' + text(config.source) : '',
      config.timeRange ? text(config.timeRange) : '',
    ].filter(Boolean);
    if (parts.length) target.append(el('p', 'bd-caption', parts.join(' · ')));
  }
  function legend(target: HTMLElement, items: Array<{ label: string; color: string }>): void {
    const box = el('div', 'bd-legend');
    for (const item of items) {
      const e = el('span', 'bd-legend-item');
      const dot = el('i', 'bd-swatch');
      dot.style.background = item.color;
      e.append(dot, document.createTextNode(item.label));
      box.append(e);
    }
    target.append(box);
  }
  function error(target: HTMLElement, message: string): void {
    const box = el('section', 'bd-error');
    box.setAttribute('role', 'alert');
    box.append(el('strong', '', '数据展示需要调整'), el('p', '', message));
    target.append(box);
  }
  function table(target: HTMLElement, config: Row, interactive = true): void {
    const data = rows(config.rows ?? config.data, 5000),
      columns = rows(config.columns, 32);
    for (const column of columns)
      if (!text(column.key) || !text(column.label)) fail('表格列需要 key 与 label。');
    let query = '',
      sortKey = '',
      ascending = true,
      page = 0;
    const pageSize = Math.max(1, Math.min(100, number(config.pageSize) ?? 20));
    const tools = el('div', 'bd-table-tools');
    const input = el('input', 'bd-search');
    input.type = 'search';
    input.placeholder = '搜索表格…';
    input.setAttribute('aria-label', '搜索 ' + text(config.title));
    const exportButton = button('导出 CSV');
    const wrap = el('div', 'bd-table-wrap');
    const t = el('table');
    t.setAttribute('aria-label', text(config.title));
    const head = el('thead'),
      body = el('tbody');
    t.append(head, body);
    wrap.append(t);
    const footer = el('div', 'bd-pagination');
    const formatCell = (r: Row, c: Row): string => {
      const v = valueOf(r, text(c.key));
      if (c.format === 'percent' && number(v) !== null)
        return new Intl.NumberFormat('zh-CN', {
          style: 'percent',
          maximumFractionDigits: 2,
        }).format(v as number);
      return c.format === 'number' || c.format === 'currency'
        ? formattedValue(v, c)
        : text(v == null ? '—' : v);
    };
    function filtered(): Row[] {
      const q = query.trim().toLocaleLowerCase();
      const list = data
        .map((r, index) => ({ r, index }))
        .filter(
          ({ r }) => !q || columns.some((c) => formatCell(r, c).toLocaleLowerCase().includes(q)),
        );
      if (sortKey)
        list.sort((a, b) => {
          const av = valueOf(a.r, sortKey),
            bv = valueOf(b.r, sortKey);
          if (av == null && bv == null) return a.index - b.index;
          if (av == null) return 1;
          if (bv == null) return -1;
          const an = number(av),
            bn = number(bv);
          const comparison =
            an !== null && bn !== null
              ? an - bn
              : text(av).localeCompare(text(bv), 'zh-CN', { numeric: true });
          return (ascending ? comparison : -comparison) || a.index - b.index;
        });
      return list.map((item) => item.r);
    }
    function render(): void {
      head.replaceChildren();
      const hr = el('tr');
      for (const c of columns) {
        const th = el('th');
        th.scope = 'col';
        if (c.format === 'number' || c.format === 'percent') th.dataset.align = 'number';
        if (interactive && c.sortable !== false) {
          const sort = button(text(c.label), 'bd-sort');
          const active = sortKey === text(c.key);
          th.setAttribute('aria-sort', active ? (ascending ? 'ascending' : 'descending') : 'none');
          sort.dataset.active = String(active);
          sort.dataset.ascending = String(active && ascending);
          const chevron = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': true });
          chevron.append(
            svg('path', {
              d: 'M12.7071 15.2929C12.3166 15.6834 11.6834 15.6834 11.2929 15.2929L7.70711 11.7071C7.07714 11.0771 7.52331 10 8.41421 10H15.5858C16.4767 10 16.9229 11.0771 16.2929 11.7071L12.7071 15.2929Z',
              fill: 'currentColor',
            }),
          );
          sort.append(chevron);
          sort.addEventListener('click', () => {
            ascending = sortKey === text(c.key) ? !ascending : true;
            sortKey = text(c.key);
            page = 0;
            render();
          });
          th.append(sort);
        } else th.textContent = text(c.label);
        hr.append(th);
      }
      head.append(hr);
      const list = filtered(),
        pages = Math.max(1, Math.ceil(list.length / pageSize));
      page = Math.min(page, pages - 1);
      body.replaceChildren();
      for (const r of list.slice(page * pageSize, (page + 1) * pageSize)) {
        const tr = el('tr');
        for (const c of columns) {
          const td = el('td', '', formatCell(r, c));
          if (c.format === 'number' || c.format === 'percent') td.dataset.align = 'number';
          tr.append(td);
        }
        body.append(tr);
      }
      if (!list.length) {
        const td = el('td', 'bd-no-results', '没有匹配的数据');
        td.colSpan = columns.length;
        const tr = el('tr');
        tr.append(td);
        body.append(tr);
      }
      footer.replaceChildren(
        el(
          'span',
          '',
          query
            ? '筛选结果 ' + list.length + ' / ' + data.length + ' 项'
            : '共 ' + data.length + ' 项',
        ),
      );
      const actions = el('div');
      const prev = button('上一页'),
        next = button('下一页');
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
      prev.addEventListener('click', () => {
        page--;
        render();
      });
      next.addEventListener('click', () => {
        page++;
        render();
      });
      if (pages > 1 || interactive) {
        actions.append(prev);
        const numbers = el('div', 'bd-page-numbers');
        const indices = new Set([0, pages - 1, page - 1, page, page + 1]);
        let last = -1;
        for (const index of [...indices].filter((i) => i >= 0 && i < pages).sort((a, b) => a - b)) {
          if (last >= 0 && index > last + 1) numbers.append(el('span', '', '…'));
          const b = button(String(index + 1), 'bd-page-number');
          b.setAttribute('aria-label', '第 ' + (index + 1) + ' 页');
          if (index === page) b.setAttribute('aria-current', 'page');
          b.addEventListener('click', () => {
            page = index;
            render();
          });
          numbers.append(b);
          last = index;
        }
        actions.append(numbers, next);
      }
      footer.append(actions);
    }
    input.addEventListener('input', () => {
      query = input.value;
      page = 0;
      render();
    });
    exportButton.addEventListener('click', () => {
      const csvCell = (v: unknown) => {
        let s = v == null ? '' : text(v);
        if (typeof v === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
        return '"' + s.replaceAll('"', '""') + '"';
      };
      const content = [
        columns.map((c) => csvCell(c.label)).join(','),
        ...filtered().map((r) => columns.map((c) => csvCell(valueOf(r, text(c.key)))).join(',')),
      ].join('\r\n');
      const url = URL.createObjectURL(
        new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }),
      );
      const a = el('a');
      a.href = url;
      a.download = (text(config.title) || 'data').replace(/[\\/:*?"<>|]/g, '-') + '.csv';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    if (interactive) {
      tools.append(input, exportButton);
      const header = target.querySelector('.bd-header');
      if (header) header.append(tools);
      else target.append(tools);
    }
    target.append(wrap);
    if (interactive) target.append(footer);
    render();
  }
  // Fixed, local vector glyphs: data only selects a known identifier, never SVG markup.
  function statIcon(name: string): SVGSVGElement {
    const paths: Record<string, string> = {
      users:
        'M2 22C2 17.5817 5.58172 14 10 14C14.4183 14 18 17.5817 18 22H16C16 18.6863 13.3137 16 10 16C6.68629 16 4 18.6863 4 22H2ZM10 13C6.685 13 4 10.315 4 7C4 3.685 6.685 1 10 1C13.315 1 16 3.685 16 7C16 10.315 13.315 13 10 13ZM10 11C12.21 11 14 9.21 14 7C14 4.79 12.21 3 10 3C7.79 3 6 4.79 6 7C6 9.21 7.79 11 10 11ZM18.2837 14.7028C21.0644 15.9561 23 18.752 23 22H21C21 19.564 19.5483 17.4671 17.4628 16.5271L18.2837 14.7028ZM17.5962 3.41321C19.5944 4.23703 21 6.20361 21 8.5C21 11.3702 18.8042 13.7252 16 13.9776V11.9646C17.6967 11.7222 19 10.264 19 8.5C19 7.11935 18.2016 5.92603 17.041 5.35635L17.5962 3.41321Z',
      orders: 'M7 4V2H17V4H21V22H3V4H7ZM5 6V20H19V6H17V8H15V6H9V8H7V6H5ZM9 4H15V3H9V4Z',
      views:
        'M12 4C7 4 3 7 1 12C3 17 7 20 12 20C17 20 21 17 23 12C21 7 17 4 12 4ZM12 6C16 6 19 8 20.8 12C19 16 16 18 12 18C8 18 5 16 3.2 12C5 8 8 6 12 6ZM12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8Z',
      revenue:
        'M14.0049 2.00281C18.4232 2.00281 22.0049 5.58453 22.0049 10.0028C22.0049 13.2474 20.0733 16.0409 17.2973 17.296C16.0422 20.0718 13.249 22.0028 10.0049 22.0028C5.5866 22.0028 2.00488 18.4211 2.00488 14.0028C2.00488 10.7587 3.9359 7.96554 6.71122 6.71012C7.96681 3.93438 10.7603 2.00281 14.0049 2.00281ZM11.0049 9.00281H9.00488V10.0028C7.62417 10.0028 6.50488 11.1221 6.50488 12.5028C6.50488 13.8283 7.53642 14.9128 8.84051 14.9975L9.00488 15.0028H11.0049L11.0948 15.0109C11.328 15.0532 11.5049 15.2573 11.5049 15.5028C11.5049 15.7483 11.328 15.9524 11.0948 15.9948L11.0049 16.0028H7.00488V18.0028H9.00488V19.0028H11.0049V18.0028C12.3856 18.0028 13.5049 16.8835 13.5049 15.5028C13.5049 14.1773 12.4733 13.0928 11.1693 13.0081L11.0049 13.0028H9.00488L8.91501 12.9948C8.68176 12.9524 8.50488 12.7483 8.50488 12.5028C8.50488 12.2573 8.68176 12.0532 8.91501 12.0109L9.00488 12.0028H13.0049V10.0028H11.0049V9.00281ZM14.0049 4.00281C12.2214 4.00281 10.6196 4.78097 9.52064 6.01629C9.68133 6.00764 9.84254 6.00281 10.0049 6.00281C14.4232 6.00281 18.0049 9.58453 18.0049 14.0028C18.0049 14.1655 18 14.327 17.9905 14.4873C19.2265 13.3885 20.0049 11.7866 20.0049 10.0028C20.0049 6.6891 17.3186 4.00281 14.0049 4.00281Z',
      trend: 'M3 20H21V22H1V2H3V20ZM6 15L11 10L15 14L21 7L19.5 5.7L15 11L11 7L4.5 13.5L6 15Z',
      info: 'M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM11 11V17H13V11H11ZM11 7V9H13V7H11Z',
    };
    const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': true });
    icon.append(svg('path', { d: paths[name] || paths.trend, fill: 'currentColor' }));
    return icon;
  }
  function stats(target: HTMLElement, config: Row): void {
    const group = el('section', 'bd-stat-group');
    group.setAttribute('aria-label', text(config.title));
    group.dataset.template = text(config.type);
    group.append(
      el('h3', config.showTitle === true ? 'bd-section-heading' : 'bd-sr-only', config.title),
    );
    const items = rows(config.items, 12);
    group.style.setProperty('--bd-stat-columns', String(Math.min(4, items.length)));
    group.style.setProperty('--bd-stat-mobile-columns', String(Math.min(2, items.length)));
    for (const item of items) {
      if (!text(item.label) || item.value == null) fail('统计卡片需要 label 和 value。');
      const footer = config.variant === 'footer';
      const card = el('article', 'bd-stat');
      card.dataset.variant = footer ? 'footer' : 'plain';
      card.dataset.tone = text(item.tone) || 'blue';
      const icon = el('span', 'bd-stat-icon');
      const label = text(item.label).toLowerCase();
      const iconName =
        text(item.icon) ||
        (/收入|营收|revenue|earn/.test(label)
          ? 'revenue'
          : /用户|customer|user/.test(label)
            ? 'users'
            : /订单|order/.test(label)
              ? 'orders'
              : /浏览|访问|view|visit/.test(label)
                ? 'views'
                : 'trend');
      icon.dataset.icon = iconName;
      icon.append(statIcon(iconName));
      const top = el('div', 'bd-stat-top');
      if (footer) {
        top.append(icon);
        if (item.hint) {
          const info = button('', 'bd-info');
          info.append(statIcon('info'));
          info.title = text(item.hint);
          info.setAttribute('aria-label', text(item.hint));
          top.append(info);
        }
        card.append(top);
      } else card.append(icon);
      const identity = el('div', 'bd-stat-identity');
      identity.append(el('h4', 'bd-title', item.label));
      const h = el('div', 'bd-headline');
      h.append(el('strong', 'bd-value', formattedValue(item.value, item)));
      const d = delta(item.delta);
      if (d && item.deltaColor)
        d.dataset.direction =
          item.deltaColor === 'lime' ? 'up' : item.deltaColor === 'rose' ? 'down' : 'flat';
      if (!footer && d) h.append(d);
      identity.append(h);
      card.append(identity);
      if (footer) {
        const band = el('div', 'bd-stat-footer');
        band.append(el('span', '', item.caption ?? item.description ?? ''));
        if (d) {
          const arrow = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': true });
          const direction = d.dataset.direction;
          arrow.append(
            svg('path', {
              fill: 'currentColor',
              'fill-rule': 'evenodd',
              d:
                direction === 'down'
                  ? 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2ZM11 8H13V12H16L12 16L8 12H11V8Z'
                  : 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2ZM13 12H16L12 8L8 12H11V16H13V12Z',
            }),
          );
          d.prepend(arrow);
          band.append(d);
        }
        card.append(band);
      }
      group.append(card);
      if (!footer && item.description) card.title = text(item.description);
    }
    caption(group, config);
    target.append(group);
  }
  function dataDetails(target: HTMLElement, config: Row, data: Row[], series: Row[]): void {
    const details = el('details', 'bd-chart-data');
    details.append(el('summary', '', '查看数据'));
    const box = el('div');
    const labelKey = text(config.labelKey) || 'label';
    let made = false;
    details.addEventListener('toggle', () => {
      if (details.open && !made) {
        made = true;
        table(box, {
          title: config.title,
          columns: [
            { key: labelKey, label: config.xLabel || '项目' },
            ...series.map((s) => ({
              key: s.key,
              label: s.label,
              format: 'number',
              unit: s.unit ?? config.unit,
            })),
          ],
          rows: data,
        });
      }
    });
    details.append(box);
    target.append(details);
  }
  function seriesOf(config: Row): Row[] {
    const list = rows(config.series ?? [{ key: 'value', label: config.yLabel || config.title }], 8);
    for (const s of list) if (!text(s.key) || !text(s.label)) fail('图表系列需要 key 与 label。');
    return list;
  }
  function tooltip(plot: HTMLElement): HTMLElement {
    const box = el('div', 'bd-tooltip');
    box.setAttribute('role', 'tooltip');
    box.hidden = true;
    plot.append(box);
    return box;
  }
  function showTip(
    box: HTMLElement,
    title: string,
    items: Array<{ label: string; value: unknown; unit?: unknown; color: string }>,
    x: number,
    width: number,
  ): void {
    box.replaceChildren(el('strong', '', title));
    for (const item of items) {
      const row = el('p');
      const dot = el('i', 'bd-swatch');
      dot.style.background = item.color;
      row.append(dot, el('span', '', item.label), el('span', '', fmt(item.value, item.unit)));
      box.append(row);
    }
    box.style.left = Math.max(6, Math.min(x - 50, width - 190)) + 'px';
    box.style.top = '8px';
    box.hidden = false;
  }
  function linePath(points: Array<[number, number] | null>, smooth: boolean): string {
    // Monotone cubic interpolation (Steffen slopes), rather than an S-curve at every point.
    const segments: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    for (const point of points) {
      if (point) current.push(point);
      else if (current.length) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length) segments.push(current);
    return segments
      .map((p) => {
        let result = 'M' + p[0]![0] + ',' + p[0]![1];
        if (!smooth || p.length < 3)
          return (
            result +
            p
              .slice(1)
              .map((v) => 'L' + v[0] + ',' + v[1])
              .join('')
          );
        const slopes = p.slice(1).map((v, i) => (v[1] - p[i]![1]) / (v[0] - p[i]![0] || 1));
        const tangents = p.map((_, i) => {
          if (!i || i === p.length - 1) return 0;
          const h0 = p[i]![0] - p[i - 1]![0],
            h1 = p[i + 1]![0] - p[i]![0];
          const s0 = slopes[i - 1]!,
            s1 = slopes[i]!,
            weighted = (s0 * h1 + s1 * h0) / (h0 + h1);
          return (
            (Math.sign(s0) + Math.sign(s1)) *
            Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(weighted))
          );
        });
        tangents[0] = (3 * slopes[0]! - tangents[1]!) / 2;
        tangents[p.length - 1] = (3 * slopes.at(-1)! - tangents.at(-2)!) / 2;
        p.slice(1).forEach((v, i) => {
          const prev = p[i]!,
            dx = (v[0] - prev[0]) / 3;
          result +=
            'C' +
            (prev[0] + dx) +
            ',' +
            (prev[1] + dx * tangents[i]!) +
            ' ' +
            (v[0] - dx) +
            ',' +
            (v[1] - dx * tangents[i + 1]!) +
            ' ' +
            v[0] +
            ',' +
            v[1];
        });
        return result;
      })
      .join('');
  }
  function cartesian(plot: HTMLElement, config: Row, kind: string, width: number): SVGSVGElement {
    const data = rows(config.data),
      series = seriesOf(config),
      labelKey = text(config.labelKey) || 'label';
    const bars = kind === 'bar' || kind === 'combo';
    const dual = series.some((s) => s.axis === 'right');
    if (kind === 'bar' && dual && config.stacked === true)
      fail('不同轴或单位的系列请分组展示，不合并堆叠。');
    const w = bars ? Math.max(width, data.length * series.length * 9 + 100) : width,
      h = Math.max(
        100,
        Math.floor(plot.getBoundingClientRect().height || plot.clientHeight || 221),
      ),
      left = kind === 'bar' ? 40 : 44,
      right = dual ? 58 : 6,
      top = config.yLabel || config.rightLabel ? 32 : 4,
      bottom = config.xLabel ? 49 : 30,
      pw = w - left - right,
      ph = h - top - bottom;
    const root = svgRoot(
      w,
      h,
      text(config.title) +
        '；' +
        text(config.xLabel || '项目') +
        ' / ' +
        text(config.yLabel || config.unit || '数值'),
    );
    const domains = (axis: string): [number, number] => {
      const items = series.filter((s) => (s.axis === 'right' ? 'right' : 'left') === axis);
      let vals = items
        .flatMap((s) => data.map((r) => number(valueOf(r, text(s.key)))))
        .filter((v): v is number => v !== null);
      if (!vals.length) fail('图表没有有效数值；数值应为数字，缺失项请使用 null。');
      if (config.stacked === true && kind === 'bar')
        vals = data.flatMap((r) => [
          items.reduce((n, s) => n + Math.max(0, number(valueOf(r, text(s.key))) ?? 0), 0),
          items.reduce((n, s) => n + Math.min(0, number(valueOf(r, text(s.key))) ?? 0), 0),
        ]);
      let min = Math.min(0, ...vals),
        max = Math.max(0, ...vals);
      if (min === max) max = min + 1;
      else {
        max = max > 0 ? max * 1.1 : 0;
        min = min < 0 ? min * 1.1 : 0;
      }
      if (
        Array.isArray(config.domain) &&
        config.domain.length === 2 &&
        config.domain.every((v) => number(v) !== null) &&
        Number(config.domain[1]) > Number(config.domain[0])
      ) {
        min = Number(config.domain[0]);
        max = Number(config.domain[1]);
      }
      if (!Number.isFinite(max - min)) fail('图表数值量级过大，请明确缩放单位。');
      return [min, max];
    };
    const leftDomain = series.some((s) => s.axis !== 'right') ? domains('left') : domains('right');
    const rightDomain = dual ? domains('right') : leftDomain;
    const y = (value: number, axis: string) => {
      const [min, max] = axis === 'right' ? rightDomain : leftDomain;
      return top + ph - ((value - min) / (max - min)) * ph;
    };
    const x = (i: number) =>
      left + (bars ? (i + 0.5) / data.length : i / Math.max(1, data.length - 1)) * pw;
    const axisTicks = (domain: [number, number]): number[] => {
      if (Array.isArray(config.ticks))
        return config.ticks.filter((v): v is number => number(v) !== null).slice(0, 12);
      const raw = (domain[1] - domain[0]) / 3,
        power = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = Math.ceil(raw / power) * power;
      const first = Math.floor(domain[0] / step) * step,
        last = Math.ceil(domain[1] / step) * step;
      return Array.from(
        { length: Math.min(12, Math.round((last - first) / step) + 1) },
        (_, i) => first + i * step,
      );
    };
    const axisText = (v: number, axis: string): string => {
      const seriesConfig =
        series.find((s) => (s.axis === 'right' ? 'right' : 'left') === axis) || series[0]!;
      const form = seriesConfig.format ?? config.format;
      if (form === 'percent')
        return new Intl.NumberFormat('en-US', {
          style: 'percent',
          maximumFractionDigits: 1,
        }).format(v);
      const currency =
        form === 'currency'
          ? new Intl.NumberFormat(
              text(seriesConfig.currency ?? config.currency).toUpperCase() === 'CNY'
                ? 'zh-CN'
                : 'en-US',
              {
                style: 'currency',
                currency: text(seriesConfig.currency ?? config.currency) || 'USD',
                maximumFractionDigits: 0,
              },
            )
              .format(0)
              .replace(/[0-9.,\s]/g, '')
          : '';
      const label = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(v);
      return currency + (kind === 'bar' ? label.replace('K', 'k') : label);
    };
    const appendTicks = (domain: [number, number], axis: string) => {
      axisTicks(domain).forEach((v) => {
        const py = Math.max(top + 5, Math.min(top + ph, y(v, axis)));
        const tick = svg(
          'text',
          {
            x: axis === 'left' ? left - 8 : w - right + 8,
            y: py + 4.26,
            'text-anchor': axis === 'left' ? 'end' : 'start',
          },
          axisText(v, axis),
        );
        tick.dataset.axis = 'y';
        root.append(tick);
      });
    };
    appendTicks(leftDomain, 'left');
    if (dual) appendTicks(rightDomain, 'right');
    const step = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(pw / 34))));
    data.forEach((r, i) => {
      if (i % step !== 0 && i !== data.length - 1) return;
      const label = text(valueOf(r, labelKey));
      const context =
        typeof CanvasRenderingContext2D !== 'undefined'
          ? document.createElement('canvas').getContext('2d')
          : null;
      if (context) context.font = '13px BoardDataInter';
      const labelWidth = context ? context.measureText(label).width : label.length * 7;
      const lastLabel = text(valueOf(data.at(-1)!, labelKey));
      const lastWidth = context ? context.measureText(lastLabel).width : lastLabel.length * 7;
      // Preserve the last tick without drawing its preceding label on top of it on narrow cards.
      if (
        i > 0 &&
        i < data.length - 1 &&
        x(data.length - 1) - x(i) < (labelWidth + lastWidth) / 2 + 10
      )
        return;
      const tickX =
        label.length > 5 && !bars
          ? x(i)
          : Math.max(labelWidth / 2, Math.min(w - labelWidth / 2, x(i)));
      root.append(
        svg(
          'text',
          {
            x: tickX,
            y: top + ph + 27.23,
            'text-anchor':
              label.length > 5 && !bars && i === 0
                ? 'start'
                : label.length > 5 && !bars && i === data.length - 1
                  ? 'end'
                  : 'middle',
            class: 'bd-x-tick',
            'font-size': 13,
          },
          label.length > 11 ? label.slice(0, 10) + '…' : label,
        ),
      );
    });
    if (config.xLabel)
      root.append(
        svg('text', { x: left + pw / 2, y: h - 5, 'text-anchor': 'middle' }, config.xLabel),
      );
    if (config.yLabel) root.append(svg('text', { x: 0, y: 12 }, config.yLabel));
    if (config.rightLabel && dual)
      root.append(svg('text', { x: w, y: 12, 'text-anchor': 'end' }, config.rightLabel));
    const positive = data.map(() => 0),
      negative = data.map(() => 0),
      barSeries = series.filter((s) => kind === 'bar' || (kind === 'combo' && s.type !== 'line'));
    let barIndex = 0;
    series.forEach((s, si) => {
      const key = text(s.key),
        axis = s.axis === 'right' ? 'right' : 'left',
        isBar = kind === 'bar' || (kind === 'combo' && s.type !== 'line');
      const points = data.map((r, i): [number, number] | null => {
        const v = number(valueOf(r, key));
        return v === null ? null : [x(i), y(v, axis)];
      });
      const ink =
        text(config.type) === 'combo-chart-card'
          ? si === 0
            ? 'var(--bd-green)'
            : 'var(--bd-blue)'
          : kind === 'bar'
            ? si === 0
              ? 'var(--bd-bar-ink)'
              : si === 1
                ? 'var(--bd-neutral)'
                : color(si)
            : si === 0
              ? 'var(--bd-line-ink)'
              : color(si);
      if (isBar) {
        const slot = pw / data.length,
          stacked = config.stacked === true && kind === 'bar',
          bw =
            kind === 'bar'
              ? Math.max(
                  1,
                  Math.min(
                    text(config.type) === 'earnings-chart-card'
                      ? 32
                      : text(config.type) === 'steps-card'
                        ? 50
                        : 10,
                    (slot * 0.66) / (stacked ? 1 : barSeries.length),
                  ),
                )
              : Math.max(1, (slot * 0.66) / (stacked ? 1 : barSeries.length));
        data.forEach((r, i) => {
          const v = number(valueOf(r, key));
          if (v === null) return;
          const base = stacked ? (v >= 0 ? positive[i]! : negative[i]!) : 0;
          const end = base + v;
          if (stacked) {
            if (v >= 0) positive[i] = end;
            else negative[i] = end;
          }
          const px =
            kind === 'bar'
              ? Number(
                  (
                    x(i) -
                    (stacked ? bw : (bw + 3) * barSeries.length - 3) / 2 +
                    (stacked ? 0 : (barSeries.length === 2 ? 1 - barIndex : barIndex) * (bw + 3)) -
                    slot * 0.005
                  ).toFixed(2),
                )
              : x(i) - slot * 0.33 + (stacked ? 0 : barIndex * bw);
          const py = Math.min(y(base, axis), y(end, axis)),
            bh = Math.abs(y(base, axis) - y(end, axis));
          const trackedBar = ['earnings-chart-card', 'steps-card'].includes(text(config.type));
          const radius = Math.min(
            trackedBar ? (text(config.type) === 'steps-card' ? 10 : 6) : 4,
            bw / 2,
            bh / 2,
          );
          const path =
            v >= 0
              ? 'M' +
                px +
                ',' +
                (py + radius) +
                'A' +
                radius +
                ',' +
                radius +
                ',0,0,1,' +
                (px + radius) +
                ',' +
                py +
                'H' +
                (px + bw - radius) +
                'A' +
                radius +
                ',' +
                radius +
                ',0,0,1,' +
                (px + bw) +
                ',' +
                (py + radius) +
                'V' +
                (py + bh) +
                'H' +
                px +
                'Z'
              : 'M' +
                px +
                ',' +
                py +
                'H' +
                (px + bw) +
                'V' +
                (py + bh - radius) +
                'A' +
                radius +
                ',' +
                radius +
                ',0,0,1,' +
                (px + bw - radius) +
                ',' +
                (py + bh) +
                'H' +
                (px + radius) +
                'A' +
                radius +
                ',' +
                radius +
                ',0,0,1,' +
                px +
                ',' +
                (py + bh - radius) +
                'Z';
          const rect =
            kind === 'bar' && !trackedBar
              ? svg('path', { d: path, fill: ink, 'data-bar': true })
              : svg('rect', {
                  x: px,
                  y: py,
                  width: kind === 'bar' ? bw : bw - 1,
                  height: bh,
                  rx: radius,
                  fill: ink,
                  'data-bar': true,
                });
          if (si === 0 && ['earnings-chart-card', 'steps-card'].includes(text(config.type))) {
            root.append(
              svg('rect', {
                x: px,
                y: top,
                width: bw,
                height: ph,
                rx: text(config.type) === 'steps-card' ? 10 : 6,
                fill: 'var(--bd-track)',
                'data-bar-track': true,
              }),
            );
          }
          rect.append(
            svg(
              'title',
              {},
              text(valueOf(r, labelKey)) +
                ' · ' +
                text(s.label) +
                ' ' +
                fmt(v, s.unit ?? config.unit),
            ),
          );
          root.append(rect);
        });
        barIndex++;
      } else {
        if (
          kind === 'area' ||
          (kind === 'line' &&
            (series.length === 1 || (text(config.type) === 'revenue-chart-card' && si === 0)))
        ) {
          const gradId = 'bd-area-' + ++id;
          const defs = svg('defs'),
            gradient = svg('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
          gradient.append(
            svg('stop', {
              offset: '0%',
              'stop-color': si === 0 ? 'var(--bd-line-area)' : ink,
              'stop-opacity': 0.21,
            }),
            svg('stop', {
              offset: '100%',
              'stop-color': si === 0 ? 'var(--bd-line-area)' : ink,
              'stop-opacity': 0,
            }),
          );
          defs.append(gradient);
          root.append(defs);
          let segment: Array<[number, number]> = [];
          const area = () => {
            if (!segment.length) return;
            root.append(
              svg('path', {
                d:
                  linePath(segment, config.shape !== 'sharp') +
                  'L' +
                  segment.at(-1)![0] +
                  ',' +
                  y(0, axis) +
                  'L' +
                  segment[0]![0] +
                  ',' +
                  y(0, axis) +
                  'Z',
                fill: 'url(#' + gradId + ')',
              }),
            );
            segment = [];
          };
          for (const point of points) {
            if (point) segment.push(point);
            else area();
          }
          area();
        }
        root.append(
          svg('path', {
            d: linePath(points, config.shape !== 'sharp'),
            fill: 'none',
            stroke:
              text(config.type) === 'revenue-chart-card' && si === 1 ? 'var(--bd-neutral)' : ink,
            'stroke-dasharray': text(config.type) === 'revenue-chart-card' && si === 1 ? '3 3' : '',
            'stroke-width': 1.5,
            'stroke-linecap': 'butt',
            'stroke-linejoin': 'miter',
            class: 'bd-line',
          }),
        );
      }
    });
    const guide = svg('line', {
      x1: 0,
      x2: 0,
      y1: top,
      y2: top + ph,
      stroke: 'var(--bd-muted)',
      'stroke-dasharray': '3 3',
      opacity: 0,
    });
    const cursor = svg('rect', {
      x: 0,
      y: top + 0.5,
      width: pw / data.length,
      height: Math.max(0, ph - 1),
      fill: 'var(--bd-track)',
      opacity: 0,
      'data-cursor': true,
    });
    if (bars) root.prepend(cursor);
    root.append(guide);
    const dots = series.map((_, i) =>
      svg('circle', {
        r: 5,
        fill: kind === 'bar' ? 'var(--bd-bar-ink)' : i === 0 ? 'var(--bd-line-ink)' : color(i),
        stroke: 'var(--bd-surface)',
        'stroke-width': 3,
        opacity: 0,
      }),
    );
    const pulse = svg('circle', {
      r: 5,
      fill: 'var(--bd-line-ink)',
      class: 'bd-pulse',
      opacity: 0,
    });
    pulse.style.display = 'none';
    root.append(pulse, ...dots);
    const tip = tooltip(plot);
    const readout = config._readout as ((index: number | null) => void) | undefined;
    let active = 0;
    const update = (i: number) => {
      active = Math.max(0, Math.min(data.length - 1, i));
      const r = data[active]!;
      const px = x(active);
      guide.setAttribute('x1', String(px));
      guide.setAttribute('x2', String(px));
      guide.setAttribute('opacity', '0');
      readout?.(active);
      if (bars) {
        cursor.setAttribute('x', String(px - pw / data.length / 2));
        cursor.setAttribute('opacity', '.5');
      }
      const firstValue = number(valueOf(r, text(series[0]!.key)));
      pulse.setAttribute('cx', String(px));
      pulse.setAttribute('cy', String(y(firstValue ?? 0, 'left')));
      pulse.style.display = firstValue === null || bars ? 'none' : '';
      pulse.setAttribute('opacity', firstValue === null || bars ? '0' : '.35');
      series.forEach((s, i) => {
        const v = number(valueOf(r, text(s.key)));
        dots[i]!.setAttribute('opacity', v === null || bars ? '0' : '1');
        if (v !== null) {
          dots[i]!.setAttribute('cx', String(px));
          dots[i]!.setAttribute('cy', String(y(v, s.axis === 'right' ? 'right' : 'left')));
        }
      });
      if (!readout || (series.length > 1 && kind !== 'bar'))
        showTip(
          tip,
          text(valueOf(r, labelKey)),
          series.map((s, i) => ({
            label: text(s.label),
            value: valueOf(r, text(s.key)),
            unit: s.unit ?? config.unit,
            color: i === 0 ? (bars ? 'var(--bd-bar-ink)' : 'var(--bd-line-ink)') : color(i),
          })),
          px,
          width,
        );
    };
    root.addEventListener('pointermove', (e) => {
      const rect = root.getBoundingClientRect();
      const px = ((e.clientX - rect.left) * w) / Math.max(1, rect.width);
      update(
        Math.round(
          ((px - left) / pw) * (bars ? data.length : Math.max(1, data.length - 1)) -
            (bars ? 0.5 : 0),
        ),
      );
    });
    root.addEventListener('pointerleave', () => {
      tip.hidden = true;
      readout?.(null);
      cursor.setAttribute('opacity', '0');
      pulse.setAttribute('opacity', '0');
      pulse.style.display = 'none';
      guide.setAttribute('opacity', '0');
      dots.forEach((dot) => dot.setAttribute('opacity', '0'));
    });
    root.addEventListener('focus', () => update(active));
    root.addEventListener('blur', () => {
      readout?.(null);
      cursor.setAttribute('opacity', '0');
      pulse.setAttribute('opacity', '0');
      pulse.style.display = 'none';
      tip.hidden = true;
      guide.setAttribute('opacity', '0');
      dots.forEach((dot) => dot.setAttribute('opacity', '0'));
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        update(active + (e.key === 'ArrowRight' ? 1 : -1));
      }
    });
    return root;
  }
  function bars(target: HTMLElement, config: Row): void {
    const data = rows(config.data, 100),
      values = data.map((r) => number(r.value) ?? fail('横向条形图需要数字 value。')),
      max = Math.max(1, ...values.map(Math.abs)),
      signed = values.some((v) => v < 0);
    const box = el('div', 'bd-bars');
    data.forEach((r, i) => {
      const line = el('div', 'bd-bar-row');
      const label = el('span', 'bd-bar-label', r.label);
      label.title = text(r.label);
      const track = el('div', 'bd-bar-track');
      const fill = el('div', 'bd-bar-fill');
      fill.style.width = (Math.abs(values[i]!) / max) * (signed ? 50 : 100) + '%';
      fill.style.left =
        (signed ? (values[i]! < 0 ? 50 - (Math.abs(values[i]!) / max) * 50 : 50) : 0) + '%';
      if (values[i]! < 0) fill.style.background = 'var(--ds-danger,#ef4444)';
      track.append(fill);
      line.append(label, track, el('span', 'bd-bar-value', fmt(r.value, config.unit)));
      box.append(line);
    });
    target.append(box);
  }
  function funnel(target: HTMLElement, config: Row): void {
    const data = rows(config.data, 24),
      values = data.map((r) => number(r.value) ?? fail('漏斗图需要数字 value。'));
    if (values.some((v) => v < 0)) fail('漏斗阶段数量应为非负数。');
    const max = Math.max(1, ...values),
      box = el('div', 'bd-funnel');
    data.forEach((r, i) => {
      const row = el('div', 'bd-funnel-step'),
        shape = el('div', 'bd-funnel-shape');
      shape.style.width = (values[i]! / max) * 100 + '%';
      shape.style.opacity = String(1 - (i / Math.max(1, data.length)) * 0.55);
      shape.title = text(r.label) + ' ' + fmt(r.value, config.unit);
      row.append(el('span', '', r.label), shape, el('span', '', fmt(r.value, config.unit)));
      box.append(row);
    });
    target.append(box);
  }
  function heatmap(target: HTMLElement, config: Row): void {
    let data = rows(config.data, 5000);
    if (data.some((r) => r.date != null)) {
      const days = data.map((r) => Date.parse(text(r.date) + 'T00:00:00Z'));
      if (days.some((v) => !Number.isFinite(v))) fail('日期热力图请使用 YYYY-MM-DD 日期。');
      const start = Math.min(...days);
      data = data.map((r, i) => ({
        ...r,
        row: ['日', '一', '二', '三', '四', '五', '六'][new Date(days[i]!).getUTCDay()],
        column: '第 ' + (Math.floor((days[i]! - start) / (7 * 86400000)) + 1) + ' 周',
        label: r.date,
      }));
    }
    const rowNames = [...new Set(data.map((r) => text(r.row)))],
      columnNames = [...new Set(data.map((r) => text(r.column)))];
    if (
      rowNames.length > 50 ||
      columnNames.length > 100 ||
      rowNames.some((s) => !s) ||
      columnNames.some((s) => !s)
    )
      fail('热力图需要 row/column 标签，最多 50 行、100 列。');
    const values = data.map((r) => number(r.value) ?? fail('热力图需要数字 value。'));
    if (values.some((v) => v < 0)) fail('当前热力图强度应为非负数。');
    const max = Math.max(1, ...values),
      matrix = new Map<string, Row>();
    for (const r of data) {
      const key = JSON.stringify([text(r.row), text(r.column)]);
      if (matrix.has(key)) fail('热力图存在重复行列，请先明确汇总口径。');
      matrix.set(key, r);
    }
    const wrap = el('div', 'bd-heatmap-scroll'),
      grid = el('div', 'bd-heatmap');
    grid.style.gridTemplateColumns = 'auto repeat(' + columnNames.length + ',22px)';
    grid.append(el('span'));
    for (const name of columnNames) {
      const label = el('span', 'bd-heatmap-label', name);
      label.title = name;
      grid.append(label);
    }
    for (const rowName of rowNames) {
      grid.append(el('span', 'bd-heatmap-label', rowName));
      for (const colName of columnNames) {
        const r = matrix.get(JSON.stringify([rowName, colName])),
          cell = el('button', 'bd-cell');
        cell.type = 'button';
        cell.dataset.missing = String(!r);
        const label = rowName + ' / ' + colName + '：' + (r ? fmt(r.value, config.unit) : '缺失');
        cell.title = r?.label ? text(r.label) + ' · ' + label : label;
        cell.setAttribute('aria-label', cell.title);
        if (r) {
          const setReadout = (next: unknown) => {
            if (typeof config._focusValue === 'function')
              (config._focusValue as (n: unknown, l?: unknown) => void)(
                next,
                rowName + ' / ' + colName,
              );
          };
          cell.addEventListener('pointerenter', () => setReadout(r.value));
          cell.addEventListener('focus', () => setReadout(r.value));
          cell.addEventListener('pointerleave', () => setReadout(null));
          cell.addEventListener('blur', () => setReadout(null));
          const ratio = (number(r.value) ?? 0) / max;
          cell.style.background =
            'color-mix(in srgb,var(--bd-blue) ' +
            Math.round(12 + ratio * 88) +
            '%,var(--bd-track))';
        }
        grid.append(cell);
      }
    }
    if (text(config.type) === 'heatmap-chart-card') {
      const headings = Array.from(grid.children).slice(0, columnNames.length + 1);
      headings.forEach((e) => e.remove());
      headings.forEach((e) => grid.append(e));
      grid.style.gridTemplateColumns = 'auto repeat(' + columnNames.length + ',minmax(6px,1fr))';
      grid.style.width = '100%';
    }
    wrap.append(grid);
    target.append(wrap);
  }
  function stages(target: HTMLElement, config: Row): void {
    const data = rows(config.data, 24),
      values = data.map((r) => number(r.value) ?? fail('阶段分布需要数字 value。'));
    if (values.some((v) => v < 0)) fail('阶段分布数量应为非负数。');
    const total = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total)) fail('合计数值过大，请缩放单位。');
    const track = el('div', 'bd-stage-track'),
      labels = el('div', 'bd-stage-labels');
    data.forEach((r, i) => {
      const part = el('div', 'bd-stage');
      part.style.width = (total ? (values[i]! / total) * 100 : 0) + '%';
      part.style.background = color(i);
      part.title = text(r.label) + ' ' + fmt(r.value, config.unit);
      track.append(part);
      const row = el('p');
      const dot = el('i', 'bd-swatch');
      dot.style.background = color(i);
      row.append(dot, el('span', '', r.label), el('strong', '', fmt(r.value, config.unit)));
      labels.append(row);
    });
    target.append(track, labels);
  }
  function circular(config: Row, kind: string, width: number): SVGSVGElement {
    const w = width,
      h = 250,
      cx = w / 2,
      cy = kind === 'gauge' ? 150 : 120,
      root = svgRoot(w, h, text(config.title));
    if (kind === 'gauge') {
      const value = number(config.value) ?? fail('仪表盘需要数字 value。'),
        max = number(config.max) ?? 100;
      if (max <= 0 || value < 0 || value > max) fail('仪表盘数值应在 0 与 max 之间。');
      const r = 84,
        length = Math.PI * r;
      const attrs = {
        d: 'M' + (cx - r) + ',' + cy + ' A' + r + ',' + r + ' 0 0 1 ' + (cx + r) + ',' + cy,
        fill: 'none',
        'stroke-width': 14,
        'stroke-linecap': 'round',
      };
      root.append(
        svg('path', { ...attrs, stroke: 'var(--bd-track)' }),
        svg('path', {
          ...attrs,
          stroke: color(0),
          'stroke-dasharray': length,
          'stroke-dashoffset': length * (1 - value / max),
        }),
        svg(
          'text',
          {
            x: cx,
            y: cy - 10,
            'text-anchor': 'middle',
            style: 'font-size:28px;fill:var(--bd-text);font-weight:600',
          },
          fmt(value, config.unit),
        ),
        svg(
          'text',
          { x: cx, y: cy + 26, 'text-anchor': 'middle' },
          '满值 ' + fmt(max, config.unit),
        ),
      );
      return root;
    }
    if (kind === 'rings') {
      const items = rows(config.items, 5);
      items.forEach((item, i) => {
        const v = number(item.value) ?? fail('活动环需要数字 value。'),
          goal = number(item.target) ?? fail('活动环需要 target。');
        if (v < 0 || goal <= 0) fail('活动环需要非负值和大于零的目标。');
        const r = 91 - i * 17,
          length = 2 * Math.PI * r;
        root.append(
          svg('circle', { cx, cy, r, fill: 'none', stroke: 'var(--bd-track)', 'stroke-width': 12 }),
          svg('circle', {
            cx,
            cy,
            r,
            fill: 'none',
            stroke: color(i),
            'stroke-width': 12,
            'stroke-linecap': 'round',
            'stroke-dasharray': length,
            'stroke-dashoffset': length * (1 - Math.min(1, v / goal)),
            transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
          }),
        );
      });
      return root;
    }
    const data = rows(config.data, 24),
      values = data.map((r) => number(r.value) ?? fail('环形图需要数字 value。'));
    if (values.some((v) => v < 0)) fail('环形图数量应为非负数。');
    const total = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total)) fail('合计数值过大，请缩放单位。');
    const r = 85,
      length = 2 * Math.PI * r;
    root.append(
      svg('circle', { cx, cy, r, fill: 'none', stroke: 'var(--bd-track)', 'stroke-width': 25 }),
    );
    let offset = 0;
    data.forEach((item, i) => {
      const portion = total ? (values[i]! / total) * length : 0;
      const arc = svg('circle', {
        cx,
        cy,
        r,
        fill: 'none',
        stroke: color(i),
        'stroke-width': 25,
        'stroke-dasharray': Math.max(0, portion - 2) + ' ' + length,
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
      });
      arc.append(
        svg(
          'title',
          {},
          text(item.label) +
            ' ' +
            fmt(item.value, config.unit) +
            ' · ' +
            (total ? fmt((values[i]! / total) * 100) : '0') +
            '%',
        ),
      );
      root.append(arc);
      offset += portion;
    });
    root.append(
      svg(
        'text',
        {
          x: cx,
          y: cy + 7,
          'text-anchor': 'middle',
          style: 'font-size:25px;fill:var(--bd-text);font-weight:600',
        },
        fmt(total),
      ),
      svg('text', { x: cx, y: cy + 29, 'text-anchor': 'middle' }, config.unit || '合计'),
    );
    return root;
  }
  function radar(config: Row, width: number): SVGSVGElement {
    const data = rows(config.data, 20),
      series = seriesOf(config);
    if (data.length < 3) fail('雷达图至少需要三个维度。');
    const values = series.flatMap((s) =>
      data.map((r) => number(valueOf(r, text(s.key))) ?? fail('雷达图各维度需要数字。')),
    );
    if (values.some((v) => v < 0)) fail('雷达图当前支持非负数值。');
    const max = number(config.max) ?? Math.max(1, ...values);
    if (max <= 0 || values.some((v) => v > max)) fail('雷达图 max 应覆盖所有数值。');
    const named = text(config.type) === 'radar-chart-card';
    const root = svgRoot(width, named ? 231 : 268, text(config.title)),
      cx = width / 2,
      cy = named ? 110 : 128,
      r = Math.min(named ? 76 : 90, width / 2 - 52);
    const at = (i: number, scale: number): [number, number] => {
      const a = -Math.PI / 2 + (i / data.length) * 2 * Math.PI;
      return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale];
    };
    for (let level = 1; level <= 4; level++)
      root.append(
        svg('polygon', {
          points: data.map((_, i) => at(i, level / 4).join(',')).join(' '),
          fill: 'none',
          stroke: 'var(--bd-border)',
        }),
      );
    data.forEach((row, i) => {
      const p = at(i, 1),
        label = at(i, 1.2);
      root.append(
        svg('line', { x1: cx, y1: cy, x2: p[0], y2: p[1], stroke: 'var(--bd-border)' }),
        svg(
          'text',
          { x: label[0], y: label[1] + 4, 'text-anchor': 'middle' },
          text(valueOf(row, text(config.labelKey) || 'label')).slice(0, 12),
        ),
      );
    });
    series.forEach((s, si) => {
      const points = data.map((row, i) => at(i, (number(valueOf(row, text(s.key))) ?? 0) / max));
      root.append(
        svg('polygon', {
          points: points.map((p) => p.join(',')).join(' '),
          fill:
            config.variant === 'lines' ? 'none' : named && si === 0 ? 'var(--bd-green)' : color(si),
          'fill-opacity': 0.15,
          stroke: named && si === 0 ? 'var(--bd-green)' : color(si),
          'stroke-width': 2,
        }),
      );
      points.forEach((p, i) => {
        const dot = svg('circle', { cx: p[0], cy: p[1], r: 3, fill: color(si) });
        dot.append(
          svg(
            'title',
            {},
            text(data[i]![text(config.labelKey) || 'label']) +
              ' · ' +
              text(s.label) +
              ' ' +
              fmt(valueOf(data[i]!, text(s.key)), s.unit ?? config.unit),
          ),
        );
        if (named) {
          dot.setAttribute('tabindex', '0');
          dot.setAttribute('opacity', config.variant === 'dotted' ? '1' : '0');
          dot.setAttribute('r', '5');
          const on = () => {
            dot.setAttribute('opacity', '1');
            if (typeof config._focusValue === 'function')
              (config._focusValue as (v: unknown, l?: unknown) => void)(
                valueOf(data[i]!, text(s.key)),
                data[i]![text(config.labelKey) || 'label'],
              );
          };
          const off = () => {
            dot.setAttribute('opacity', config.variant === 'dotted' ? '1' : '0');
            if (typeof config._focusValue === 'function')
              (config._focusValue as (v: unknown) => void)(null);
          };
          dot.addEventListener('focus', on);
          dot.addEventListener('pointerenter', on);
          dot.addEventListener('blur', off);
          dot.addEventListener('pointerleave', off);
        }
        root.append(dot);
      });
    });
    return root;
  }
  function scatter(plot: HTMLElement, config: Row, width: number): SVGSVGElement {
    const data = rows(config.data),
      w = width,
      h = text(config.type) === 'scatter-chart-card' ? 196 : 248,
      left = 50,
      right = 18,
      top = 12,
      bottom = 43,
      pw = w - left - right,
      ph = h - top - bottom;
    const xs = data.map((r) => number(r.x) ?? fail('散点图需要数字 x/y。')),
      ys = data.map((r) => number(r.y) ?? fail('散点图需要数字 x/y。'));
    const xmin = Math.min(0, ...xs),
      xmax = Math.max(1, ...xs),
      ymin = Math.min(0, ...ys),
      ymax = Math.max(1, ...ys);
    if (!Number.isFinite(xmax - xmin) || !Number.isFinite(ymax - ymin))
      fail('散点图数值量级过大。');
    const groups = [...new Set(data.map((r) => text(r.series) || text(config.title)))],
      root = svgRoot(
        w,
        h,
        text(config.title) + '；' + text(config.xLabel || 'X') + ' / ' + text(config.yLabel || 'Y'),
      ),
      tip = tooltip(plot);
    for (let i = 0; i <= 4; i++) {
      const py = top + (ph * i) / 4,
        px = left + (pw * i) / 4;
      root.append(
        svg('line', { x1: left, y1: py, x2: w - right, y2: py, class: 'bd-grid-line' }),
        svg(
          'text',
          { x: left - 8, y: py + 4, 'text-anchor': 'end' },
          compact(ymax - ((ymax - ymin) * i) / 4),
        ),
        svg(
          'text',
          { x: px, y: top + ph + 19, 'text-anchor': 'middle' },
          compact(xmin + ((xmax - xmin) * i) / 4),
        ),
      );
    }
    data.forEach((r, i) => {
      const px = left + ((xs[i]! - xmin) / (xmax - xmin)) * pw,
        py = top + ph - ((ys[i]! - ymin) / (ymax - ymin)) * ph,
        gi = groups.indexOf(text(r.series) || text(config.title)),
        ink =
          text(config.type) === 'scatter-chart-card'
            ? ['var(--bd-green)', 'var(--bd-blue)', 'var(--bd-purple)', 'var(--bd-pink)'][gi % 4]!
            : color(gi);
      const dot = svg('circle', {
        cx: px,
        cy: py,
        r: Math.max(3, Math.min(16, number(r.size) ?? 4.5)),
        fill: ink,
        'fill-opacity': 0.8,
        'data-scatter-group': gi,
      });
      dot.append(
        svg(
          'title',
          {},
          text(r.label || r.series || '数据点') + ' · X ' + fmt(r.x) + ' / Y ' + fmt(r.y),
        ),
      );
      dot.addEventListener('pointerenter', () =>
        showTip(
          tip,
          text(r.label || r.series || '数据点'),
          [
            { label: text(config.xLabel || 'X'), value: r.x, color: ink },
            { label: text(config.yLabel || 'Y'), value: r.y, unit: config.unit, color: ink },
          ],
          px,
          w,
        ),
      );
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('aria-label', dot.querySelector('title')?.textContent || '');
      const activate = () => {
        showTip(
          tip,
          text(r.label || r.series || '数据点'),
          [
            { label: text(config.xLabel || 'X'), value: r.x, color: ink },
            { label: text(config.yLabel || 'Y'), value: r.y, color: ink },
          ],
          px,
          w,
        );
        root
          .querySelectorAll('[data-scatter-group]')
          .forEach((e) =>
            e.setAttribute(
              'opacity',
              e.getAttribute('data-scatter-group') === String(gi) ? '1' : '.3',
            ),
          );
        if (typeof config._focusValue === 'function')
          (config._focusValue as (n: unknown, l?: unknown) => void)(r.y, r.label || r.series);
      };
      const deactivate = () => {
        tip.hidden = true;
        root
          .querySelectorAll('[data-scatter-group]')
          .forEach((e) => e.setAttribute('opacity', '1'));
        if (typeof config._focusValue === 'function')
          (config._focusValue as (n: unknown) => void)(null);
      };
      dot.addEventListener('focus', activate);
      dot.addEventListener('pointerenter', activate);
      dot.addEventListener('blur', deactivate);
      dot.addEventListener('pointerleave', deactivate);
      root.append(dot);
    });
    if (text(config.type) !== 'scatter-chart-card')
      root.append(
        svg('text', { x: left + pw / 2, y: h - 4, 'text-anchor': 'middle' }, config.xLabel || 'X'),
        svg('text', { x: 0, y: 4 }, config.yLabel || 'Y'),
      );
    return root;
  }
  function sankey(config: Row, width: number): SVGSVGElement {
    const nodes = rows(config.nodes, 80),
      links = rows(config.links, 300);
    const byId = new Map<string, Row>(),
      level = new Map<string, number>(),
      incoming = new Map<string, number>(),
      outgoing = new Map<string, number>(),
      degree = new Map<string, number>();
    for (const n of nodes) {
      const key = text(n.id);
      if (!key || byId.has(key)) fail('桑基图节点 id 应唯一且非空。');
      byId.set(key, n);
      level.set(key, 0);
      incoming.set(key, 0);
      outgoing.set(key, 0);
      degree.set(key, 0);
    }
    for (const link of links) {
      const a = text(link.source),
        b = text(link.target),
        v = number(link.value);
      if (!byId.has(a) || !byId.has(b) || a === b || v === null || v < 0)
        fail('桑基图连线需要有效节点和非负数字。');
      degree.set(b, degree.get(b)! + 1);
      incoming.set(b, incoming.get(b)! + v!);
      outgoing.set(a, outgoing.get(a)! + v!);
    }
    const queue = nodes.map((n) => text(n.id)).filter((key) => degree.get(key) === 0);
    let visited = 0;
    while (queue.length) {
      const key = queue.shift()!;
      visited++;
      for (const link of links.filter((l) => text(l.source) === key)) {
        const dest = text(link.target);
        level.set(dest, Math.max(level.get(dest)!, level.get(key)! + 1));
        degree.set(dest, degree.get(dest)! - 1);
        if (degree.get(dest) === 0) queue.push(dest);
      }
    }
    if (visited !== nodes.length) fail('当前桑基图需要无环流向；请核对循环连线。');
    const maxLevel = Math.max(...level.values()),
      h = text(config.type) === 'sankey-chart-card' ? 344 : 300,
      pad = 16,
      totals = Array.from({ length: maxLevel + 1 }, (_, i) =>
        nodes
          .filter((n) => level.get(text(n.id)) === i)
          .reduce(
            (sum, n) => sum + Math.max(incoming.get(text(n.id))!, outgoing.get(text(n.id))!),
            0,
          ),
      );
    const largest = Math.max(1, ...totals);
    if (!Number.isFinite(largest)) fail('桑基图合计数值过大。');
    const maxCount = Math.max(
      ...Array.from(
        { length: maxLevel + 1 },
        (_, i) => nodes.filter((n) => level.get(text(n.id)) === i).length,
      ),
    );
    const scale = Math.max(1, h - 2 * pad - maxCount * 10) / largest;
    const positions = new Map<string, { x: number; y: number; height: number; color: string }>();
    for (let stage = 0; stage <= maxLevel; stage++) {
      let cursor = pad;
      nodes
        .filter((n) => level.get(text(n.id)) === stage)
        .forEach((n, i) => {
          const key = text(n.id),
            height = Math.max(3, Math.max(incoming.get(key)!, outgoing.get(key)!) * scale);
          positions.set(key, {
            x:
              text(config.type) === 'sankey-chart-card'
                ? 100 + ((width - 216) * stage) / Math.max(1, maxLevel)
                : 38 + ((width - 96) * stage) / Math.max(1, maxLevel),
            y: cursor,
            height,
            color:
              text(config.type) === 'sankey-chart-card'
                ? stage === 0
                  ? [
                      'var(--bd-green)',
                      'var(--bd-purple)',
                      'var(--bd-yellow)',
                      'var(--bd-blue)',
                      'var(--bd-pink)',
                      'var(--bd-cyan)',
                    ][i % 6]!
                  : 'var(--bd-neutral)'
                : color(stage + i),
          });
          cursor += height + 10;
        });
    }
    const root = svgRoot(width, h, text(config.title)),
      sourceOffsets = new Map<string, number>(),
      targetOffsets = new Map<string, number>();
    for (const link of links) {
      const key = text(link.source),
        dest = text(link.target),
        a = positions.get(key)!,
        b = positions.get(dest)!,
        v = number(link.value)!,
        thickness = v * scale;
      if (!thickness) continue;
      const ay = a.y + (sourceOffsets.get(key) || 0) + thickness / 2,
        by = b.y + (targetOffsets.get(dest) || 0) + thickness / 2;
      sourceOffsets.set(key, (sourceOffsets.get(key) || 0) + thickness);
      targetOffsets.set(dest, (targetOffsets.get(dest) || 0) + thickness);
      const mid = (a.x + b.x) / 2;
      const flow = svg('path', {
        d:
          'M' +
          (a.x + 12) +
          ',' +
          ay +
          'C' +
          mid +
          ',' +
          ay +
          ' ' +
          mid +
          ',' +
          by +
          ' ' +
          b.x +
          ',' +
          by,
        fill: 'none',
        stroke: a.color,
        'stroke-width': thickness,
        'stroke-opacity': 0.3,
        'data-link': true,
        'data-source': key,
        'data-target': dest,
      });
      flow.append(
        svg(
          'title',
          {},
          text(byId.get(key)!.label) +
            ' → ' +
            text(byId.get(dest)!.label) +
            ' ' +
            fmt(v, config.unit),
        ),
      );
      flow.setAttribute('tabindex', '0');
      flow.setAttribute('aria-label', flow.querySelector('title')?.textContent || '');
      const on = () => {
        root
          .querySelectorAll('[data-link]')
          .forEach((e) => e.setAttribute('stroke-opacity', e === flow ? '.65' : '.08'));
        if (typeof config._focusValue === 'function')
          (config._focusValue as (n: unknown, l?: unknown) => void)(
            v,
            text(byId.get(key)!.label) + ' → ' + text(byId.get(dest)!.label),
          );
      };
      const off = () => {
        root.querySelectorAll('[data-link]').forEach((e) => e.setAttribute('stroke-opacity', '.3'));
        if (typeof config._focusValue === 'function')
          (config._focusValue as (n: unknown) => void)(null);
      };
      flow.addEventListener('focus', on);
      flow.addEventListener('pointerenter', on);
      flow.addEventListener('blur', off);
      flow.addEventListener('pointerleave', off);
      root.append(flow);
    }
    for (const [key, p] of positions) {
      const node = svg('rect', {
        x: p.x,
        y: p.y,
        width: 12,
        height: p.height,
        rx: 3,
        fill: p.color,
      });
      node.append(
        svg(
          'title',
          {},
          text(byId.get(key)!.label) +
            ' · ' +
            fmt(Math.max(incoming.get(key)!, outgoing.get(key)!), config.unit),
        ),
      );
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', node.querySelector('title')?.textContent || '');
      const on = () => {
        root
          .querySelectorAll('[data-link]')
          .forEach((e) =>
            e.setAttribute(
              'stroke-opacity',
              e.getAttribute('data-source') === key || e.getAttribute('data-target') === key
                ? '.65'
                : '.08',
            ),
          );
        if (typeof config._focusValue === 'function')
          (config._focusValue as (n: unknown, l?: unknown) => void)(
            Math.max(incoming.get(key)!, outgoing.get(key)!),
            byId.get(key)!.label,
          );
      };
      const off = () => {
        root.querySelectorAll('[data-link]').forEach((e) => e.setAttribute('stroke-opacity', '.3'));
        if (typeof config._focusValue === 'function')
          (config._focusValue as (n: unknown) => void)(null);
      };
      node.addEventListener('focus', on);
      node.addEventListener('pointerenter', on);
      node.addEventListener('blur', off);
      node.addEventListener('pointerleave', off);
      if (text(config.type) === 'sankey-chart-card') {
        const first = level.get(key) === 0,
          total = totals[0] || 1;
        root.append(
          node,
          svg(
            'text',
            {
              x: first ? p.x - 8 : p.x + 18,
              y: p.y + p.height / 2 + 4,
              'text-anchor': first ? 'end' : 'start',
            },
            text(byId.get(key)!.label).slice(0, 14) +
              (first ? '' : ' · ' + Math.round((incoming.get(key)! / total) * 100) + '%'),
          ),
        );
        if (first)
          root.append(
            svg(
              'text',
              { x: p.x - 8, y: p.y + p.height / 2 + 18, 'text-anchor': 'end', 'font-size': 10 },
              fmt(outgoing.get(key), config.unit),
            ),
          );
        continue;
      }
      root.append(
        node,
        svg(
          'text',
          {
            x: p.x + (level.get(key) === maxLevel ? -5 : 17),
            y: p.y + p.height / 2 + 4,
            'text-anchor': level.get(key) === maxLevel ? 'end' : 'start',
          },
          text(byId.get(key)!.label).slice(0, 16),
        ),
      );
    }
    return root;
  }
  const catalogRuntime = catalogFactory({
    el,
    svg,
    svgRoot,
    linePath,
    text,
    number,
    formattedValue,
    rows,
    fail,
  });
  function chartCard(target: HTMLElement, original: Row, kind: string): void {
    const supplied = original;
    original = catalogRuntime.prepare(original, kind);
    let selected = 0,
      oldIndicator: { left: number; width: number } | undefined;
    const periods =
      Array.isArray(original.periods) && original.periods.length ? rows(original.periods, 12) : [];
    const wrapper = el('div', 'bd-component');
    wrapper.dataset.component = kind;
    const card = el('section', 'bd-card');
    card.dataset.component = kind;
    const cartFrame =
      ['line', 'area', 'bar'].includes(kind) && text(original.type) !== 'most-active-days-card';
    if (cartFrame) card.dataset.frame = 'cartesian';
    wrapper.append(card);
    target.append(wrapper);
    const render = () => {
      const selectedConfig: Row = periods.length
        ? { ...supplied, ...periods[selected] }
        : { ...original };
      if (
        periods.length &&
        text(original.type).endsWith('-card') &&
        periods[selected]!.value === undefined
      )
        delete selectedConfig.value;
      const config: Row = catalogRuntime.prepare(selectedConfig, kind);
      wrapper.replaceChildren(card);
      card.replaceChildren();
      const header = el('div', 'bd-header'),
        identity = el('div', 'bd-identity');
      const title = el('h3', 'bd-title', config.title);
      identity.append(title);
      let value: HTMLElement | undefined,
        chip: HTMLElement | undefined,
        sub: HTMLElement | undefined;
      let serial = 0,
        shown = 0;
      const setValue = (next: unknown, format: Row = config) => {
        if (!value) return;
        if (text(config.type) === 'sleep-score-card' && config.description) {
          value.textContent = text(config.description);
          return;
        }
        if (['most-active-days-card', 'steps-card'].includes(text(config.type)))
          format = { ...format, unit: '' };
        value.textContent = formattedValue(next, format);
        const to = number(next),
          from = shown;
        shown = to ?? 0;
        serial++;
        const current = serial;
        const reduce = card.closest<HTMLElement>('.bd-root')?.dataset.reduceMotion === 'true';
        if (to === null || reduce || typeof requestAnimationFrame !== 'function') return;
        const start = performance.now();
        requestAnimationFrame(function tick(now) {
          if (current !== serial || !value?.isConnected) return;
          if (now < start) {
            value.textContent = formattedValue(to, format);
            return;
          }
          const t = Math.min(1, Math.max(0, (now - start) / 450));
          const n = from + (to - from) * (1 - Math.pow(1 - t, 3));
          const precision =
            format.format === 'percent'
              ? 6
              : format.format === 'currency'
                ? 2
                : Number.isInteger(to)
                  ? 0
                  : 2;
          value.textContent = formattedValue(t === 1 ? to : Number(n.toFixed(precision)), format);
          if (t < 1) requestAnimationFrame(tick);
        });
      };
      if (config.value != null) {
        const h = el('div', 'bd-headline');
        value = el('strong', 'bd-value', formattedValue(config.value, config));
        value.dataset.restingValue = text(config.value);
        h.append(value);
        chip = delta(config.delta);
        if (chip) h.append(chip);
        identity.append(h);
      }
      if (config.previous != null) {
        sub = el(
          'p',
          'bd-previous',
          formattedValue(config.previous, config) + ' ' + text(config.previousLabel || 'last year'),
        );
        identity.append(sub);
      }
      header.append(identity);
      if (periods.length) {
        const group = el('div', 'bd-periods');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', text(original.title) + ' 时间范围');
        const indicator = el('span', 'bd-period-indicator');
        indicator.setAttribute('aria-hidden', 'true');
        group.append(indicator);
        periods.forEach((p, i) => {
          const b = button(text(p.label));
          b.className = 'bd-period';
          b.setAttribute('aria-pressed', String(i === selected));
          b.addEventListener('click', () => {
            if (selected === i) return;
            const active = group.querySelector<HTMLElement>('[aria-pressed="true"]');
            if (active) oldIndicator = { left: active.offsetLeft, width: active.offsetWidth };
            selected = i;
            try {
              render();
            } catch (e) {
              Array.from(card.children)
                .filter((c) => !c.classList.contains('bd-header'))
                .forEach((c) => c.remove());
              error(card, e instanceof Error ? e.message : '此时间范围的数据需要调整。');
            }
          });
          group.append(b);
        });
        header.append(group);
        if (
          text(config.type).endsWith('-card') &&
          ![
            'line-chart-card',
            'earnings-chart-card',
            'contributions-card',
            'bar-list-card',
          ].includes(text(config.type))
        ) {
          const select = el('select', 'bd-range');
          select.setAttribute('aria-label', text(config.title) + ' 时间范围');
          periods.forEach((p, i) =>
            select.add(new Option(text(p.label), String(i), false, i === selected)),
          );
          select.addEventListener('change', () => {
            selected = Number(select.value);
            render();
          });
          group.replaceWith(select);
        }
        const position = () => {
          const active = group.querySelector<HTMLElement>('[aria-pressed="true"]');
          if (!active) return;
          if (oldIndicator) {
            indicator.style.transform = 'translateX(' + oldIndicator.left + 'px)';
            indicator.style.width = oldIndicator.width + 'px';
            oldIndicator = undefined;
          }
          const move = () => {
            indicator.style.transform = 'translateX(' + active.offsetLeft + 'px)';
            indicator.style.width = active.offsetWidth + 'px';
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(move);
          else move();
        };
        requestAnimationFrame(position);
        document.fonts?.ready.then(position);
      } else if (kind === 'bar' && seriesOf(config).length > 1) {
        legend(
          header,
          seriesOf(config).map((s, i) => ({
            label: text(s.label),
            color: i === 0 ? 'var(--bd-bar-ink)' : i === 1 ? 'var(--bd-neutral)' : color(i),
          })),
        );
      }
      if (
        !periods.length &&
        config.timeRange &&
        text(config.type).endsWith('-card') &&
        ![
          'orders-chart-card',
          'revenue-chart-card',
          'contributions-card',
          'most-active-days-card',
          'activity-rings-card',
          'bar-list-card',
        ].includes(text(config.type))
      ) {
        header.append(el('span', 'bd-range bd-range-static', config.timeRange));
      }
      if (cartFrame && value) {
        const data = rows(config.data),
          list = seriesOf(config),
          key = text(list[0]!.key),
          labelKey = text(config.labelKey) || 'label';
        const monthNames: Record<string, string> = {
          Jan: 'January',
          Feb: 'February',
          Mar: 'March',
          Apr: 'April',
          May: 'May',
          Jun: 'June',
          Jul: 'July',
          Aug: 'August',
          Sep: 'September',
          Oct: 'October',
          Nov: 'November',
          Dec: 'December',
        };
        config._readout = (i: number | null) => {
          const r = i === null ? undefined : data[i];
          const label = r ? text(valueOf(r, labelKey)) : text(config.title);
          title.textContent = r ? monthNames[label] || label : label;
          const v = r ? valueOf(r, key) : config.value;
          setValue(v, r ? { ...config, ...list[0] } : config);
          if (chip) {
            if (
              r &&
              kind === 'bar' &&
              list.length === 2 &&
              number(valueOf(r, text(list[1]!.key))) !== null
            ) {
              const prev = number(valueOf(r, text(list[1]!.key)))!;
              const d = number(v) !== null && prev > 0 ? ((Number(v) - prev) / prev) * 100 : null;
              const updated = d === null ? undefined : delta(Number(d.toFixed(1)));
              chip.hidden = !updated;
              if (updated) {
                chip.textContent = updated.textContent;
                chip.dataset.direction = updated.dataset.direction;
              }
            } else {
              chip.hidden = !!r;
              if (!r) {
                const restored = delta(config.delta);
                if (restored) {
                  chip.textContent = restored.textContent;
                  chip.dataset.direction = restored.dataset.direction;
                }
              }
            }
          }
          if (sub)
            sub.textContent =
              r && list.length > 1
                ? formattedValue(valueOf(r, text(list[1]!.key)), { ...config, ...list[1] }) +
                  ' ' +
                  text(config.hoverPreviousLabel || 'a year earlier')
                : formattedValue(config.previous, config) +
                  ' ' +
                  text(config.previousLabel || 'last year');
        };
      }
      config._focusValue = (next: unknown, label?: unknown) => {
        title.textContent = next == null ? text(config.title) : text(label || config.title);
        setValue(next == null ? config.value : next);
        if (chip) chip.hidden = next != null;
      };
      card.append(header);
      if (catalogRuntime.render(card, config, kind)) {
        // Each catalog template owns its layout rather than using an alias-only fallback.
      } else if (kind === 'table') {
        card.classList.add('bd-table-card');
        table(card, config);
      } else if (kind === 'bar-list') bars(card, config);
      else if (kind === 'funnel') funnel(card, config);
      else if (kind === 'heatmap') heatmap(card, config);
      else if (kind === 'stages') stages(card, config);
      else {
        const plot = el('div', 'bd-plot');
        card.append(plot);
        let previousWidth = 0;
        const draw = () => {
          const bounds = plot.getBoundingClientRect();
          const width = Math.max(
            260,
            Math.floor(bounds.width || plot.clientWidth || card.clientWidth - 32 || 560),
          );
          const dimensions = width * 10000 + Math.floor(bounds.height || plot.clientHeight || 221);
          if (dimensions === previousWidth) return;
          previousWidth = dimensions;
          plot.replaceChildren();
          try {
            const drawing = ['line', 'bar', 'area', 'combo'].includes(kind)
              ? cartesian(plot, config, kind, width)
              : kind === 'radar'
                ? radar(config, width)
                : kind === 'scatter'
                  ? scatter(plot, config, width)
                  : kind === 'sankey'
                    ? sankey(config, width)
                    : circular(config, kind, width);
            plot.prepend(drawing);
          } catch (e) {
            error(plot, e instanceof Error ? e.message : '图表数据配置需要调整。');
          }
        };
        draw();
        if (typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(() => {
            if (!plot.isConnected) {
              ro.disconnect();
              return;
            }
            draw();
          });
          ro.observe(plot);
          document.fonts?.ready.then(() => {
            previousWidth = 0;
            if (plot.isConnected) draw();
          });
        }
        if (['line', 'bar', 'area', 'combo', 'radar'].includes(kind)) {
          const series = seriesOf(config);
          if (!cartFrame || kind === 'combo')
            legend(
              card,
              series.map((s, i) => ({ label: text(s.label), color: color(i) })),
            );
          if (config.showData === true) dataDetails(wrapper, config, rows(config.data), series);
        } else if (['donut', 'rings', 'scatter'].includes(kind)) {
          const data = kind === 'rings' ? rows(config.items, 5) : rows(config.data);
          const labels =
            kind === 'scatter'
              ? [...new Set(data.map((r) => text(r.series) || text(config.title)))]
              : data.map(
                  (r) =>
                    text(r.label) +
                    (kind === 'rings' ? ' ' + fmt(r.value, r.unit) + ' / ' + fmt(r.target) : ''),
                );
          legend(
            card,
            labels.map((label, i) => ({ label, color: color(i) })),
          );
        }
      }
      if (value) setValue(config.value);
      catalogRuntime.finish(card, config, kind);
      if (config.description) wrapper.append(el('p', 'bd-description', config.description));
      caption(wrapper, config);
    };
    try {
      render();
    } catch (e) {
      card.replaceChildren();
      error(card, e instanceof Error ? e.message : '数据配置需要调整。');
    }
  }
  function mount(marker: HTMLElement): void {
    if (marker.dataset.boarduiReady === 'true') return;
    marker.dataset.boarduiReady = 'true';
    const raw =
      marker.tagName === 'SCRIPT'
        ? marker.textContent || ''
        : marker.getAttribute('data-boardui') || marker.textContent || '';
    const root = el('section', 'bd-root');
    root.dataset.boarduiRoot = 'true';
    root.dataset.kitVersion = version;
    root.dataset.reduceMotion = String(
      document.documentElement.dataset.reduceMotion === 'true' ||
        (typeof matchMedia === 'function' &&
          matchMedia('(prefers-reduced-motion: reduce)').matches),
    );
    marker.replaceWith(root);
    try {
      if (raw.length > 1048576) fail('数据配置超过 1 MiB，请分批展示。');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        fail('JSON 数据配置有误，请核对引号和逗号。');
      }
      const config = object(parsed);
      if (config.version !== undefined && config.version !== 1)
        fail('当前支持 version: 1 的数据格式。');
      const components = config.components === undefined ? [config] : rows(config.components, 32);
      if (config.components !== undefined && (config.title || config.description)) {
        const intro = el('header', 'bd-intro');
        if (config.title) intro.append(el('h2', '', config.title));
        if (config.description) intro.append(el('p', '', config.description));
        root.append(intro);
      }
      const dashboard = el('div', 'bd-dashboard');
      root.append(dashboard);
      for (const item of components) {
        try {
          const key = text(item.type);
          if (!Object.prototype.hasOwnProperty.call(catalog, key)) fail('不支持的图表类型：' + key);
          if (!text(item.title)) fail('数据组件需要具体的 title。');
          const kind = catalog[key]!;
          if (kind === 'stats') stats(dashboard, item);
          else chartCard(dashboard, item, kind);
        } catch (e) {
          error(dashboard, e instanceof Error ? e.message : '数据组件需要调整。');
        }
      }
      if (config.components !== undefined) caption(root, config);
    } catch (e) {
      error(root, e instanceof Error ? e.message : '数据配置需要调整。');
    }
  }
  const scope = window as Window & { SyncThinkData?: { version: string; refresh: () => void } };
  if (scope.SyncThinkData) {
    scope.SyncThinkData.refresh();
    return;
  }
  const hydrate = () => {
    document
      .querySelectorAll<HTMLElement>('[data-boardui]:not([data-boardui-ready])')
      .forEach(mount);
  };
  scope.SyncThinkData = { version, refresh: hydrate };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== 'sync-think-boardui-theme') return;
    const payload = event.data;
    if (payload.theme === 'light' || payload.theme === 'dark')
      document.documentElement.dataset.theme = payload.theme;
    document.documentElement.dataset.reduceMotion = String(payload.reduceMotion === true);
    if (payload.tokens && typeof payload.tokens === 'object')
      for (const [key, value] of Object.entries(payload.tokens))
        if (/^--ds-[a-z0-9-]+$/.test(key) && typeof value === 'string')
          document.documentElement.style.setProperty(key, value);
    document.querySelectorAll<HTMLElement>('.bd-root').forEach((root) => {
      root.dataset.reduceMotion = String(payload.reduceMotion === true);
    });
  });
  const reportHeight = () => {
    if (window.parent === window) return;
    const root = document.querySelector('main.viz-root') || document.body;
    window.parent.postMessage(
      {
        type: 'sync-think-boardui-height',
        height: Math.ceil(root.getBoundingClientRect().height) + 16,
      },
      '*',
    );
  };
  const start = () => {
    hydrate();
    requestAnimationFrame(reportHeight);
    if (typeof ResizeObserver !== 'undefined') {
      let queued = false;
      new ResizeObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          reportHeight();
        });
      }).observe(document.body);
    }
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export function buildBoardDataBootstrap(): string {
  return (
    '<script id="sync-think-board-data-runtime">(' +
    mountBoardData.toString() +
    ')(' +
    JSON.stringify(BOARD_DATA_TYPES) +
    ',' +
    JSON.stringify(BOARD_DATA_KIT_VERSION) +
    ',(' +
    createBoardDataCatalog.toString() +
    ')' +
    ');</script>'
  );
}
