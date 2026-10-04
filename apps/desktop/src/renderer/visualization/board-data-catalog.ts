/** Public-preview adapters. No remote scripts, libraries or fabricated datasets in the guest. */
type Row = Record<string, unknown>;
type Helpers = {
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    value?: unknown,
  ) => HTMLElementTagNameMap[K];
  svg: (
    tag: keyof SVGElementTagNameMap,
    attrs?: Record<string, string | number | boolean>,
    value?: unknown,
  ) => SVGElement;
  svgRoot: (w: number, h: number, title: string) => SVGSVGElement;
  linePath: (points: Array<[number, number] | null>, smooth: boolean) => string;
  text: (v: unknown) => string;
  number: (v: unknown) => number | null;
  formattedValue: (v: unknown, config: Row) => string;
  rows: (v: unknown, max?: number) => Row[];
  fail: (s: string) => never;
};
/** Stringified alongside the base engine: keep all runtime helpers inside this function. */
export function createBoardDataCatalog(h: Helpers) {
  const { el, svg, svgRoot, linePath, text, number, formattedValue: format, rows, fail } = h;
  const inks = [
    'var(--bd-green)',
    'var(--bd-blue)',
    'var(--bd-purple)',
    'var(--bd-pink)',
    'var(--bd-yellow)',
    'var(--bd-cyan)',
  ];
  const ink = (i: number) => inks[i % inks.length]!;
  const dataOf = (c: Row) => rows(c.data ?? c.items, 2000);
  const valueOf = (r: Row, key = 'value') =>
    Object.prototype.hasOwnProperty.call(r, key) ? r[key] : null;
  const num = (r: Row, key = 'value') => number(valueOf(r, key));
  const title = (e: Element, s: string) => e.setAttribute('aria-label', s);
  const btn = (label: string, action: () => void, cls = 'bd-button') => {
    const b = el('button', cls, label) as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  };
  const focus = (c: Row, v: unknown, label?: unknown) => {
    if (typeof c._focusValue === 'function')
      (c._focusValue as (v: unknown, l?: unknown) => void)(v, label);
  };
  const bind = (e: Element, c: Row, v: unknown, label: unknown, group?: Element) => {
    e.setAttribute('tabindex', '0');
    e.setAttribute('role', 'img');
    title(e, text(label) + ' · ' + format(v, c));
    const on = () => {
      focus(c, v, label);
      if (group) {
        group
          .querySelectorAll('[data-focus-item]')
          .forEach((n) => n.setAttribute('data-dim', String(n !== e)));
        e.setAttribute('data-dim', 'false');
      }
    };
    e.setAttribute('data-focus-item', 'true');
    e.addEventListener('pointerenter', on);
    e.addEventListener('focus', on);
    const off = () => {
      focus(c, null);
      group?.querySelectorAll('[data-focus-item]').forEach((n) => n.removeAttribute('data-dim'));
    };
    e.addEventListener('pointerleave', off);
    e.addEventListener('blur', off);
  };
  function tiles(card: HTMLElement, c: Row, items: Row[], className = 'bd-tiles') {
    if (!items.length) return;
    const box = el('div', className);
    const columns = Math.min(
      ['funnel-chart-card', 'contributions-card', 'activity-rings-card'].includes(text(c.type))
        ? 6
        : 3,
      items.length,
    );
    box.style.setProperty('--bd-tile-cols', String(columns));
    items.forEach((r, i) => {
      const tile = el('div', 'bd-metric-tile');
      tile.dataset.tileIndex = String(i);
      const count = Math.min(columns, items.length - Math.floor(i / columns) * columns);
      tile.style.gridColumn = 'span ' + 60 / count;
      const label = el('span', 'bd-tile-label', r.label);
      const dot = el('i', 'bd-dot');
      dot.style.background =
        c.type === 'activity-rings-card'
          ? ['var(--bd-pink)', 'var(--bd-green)', 'var(--bd-cyan)'][i % 3]!
          : ink(i);
      label.prepend(dot);
      tile.append(label, el('strong', '', format(r.value, { ...c, ...r })));
      bind(tile, c, r.value, r.label, box);
      box.append(tile);
    });
    card.append(box);
  }
  function prepare(original: Row, kind: string): Row {
    const c = { ...original };
    const type = text(c.type);
    if (!type.endsWith('-card') && type !== 'radial') return c;
    if (
      c.value == null &&
      kind !== 'table' &&
      type !== 'bar-list-card' &&
      type !== 'sleep-score-card'
    ) {
      const ds = Array.isArray(c.data) ? rows(c.data) : [];
      const s = Array.isArray(c.series) ? rows(c.series, 12) : [];
      const key = text(s[0]?.key) || 'value';
      const vals = ds
        .map((r) => num(r, type === 'scatter-chart-card' ? 'y' : key))
        .filter((v): v is number => v !== null);
      if (vals.length) {
        c.value =
          type === 'scatter-chart-card'
            ? vals.reduce((a, b) => a + b, 0) / vals.length
            : vals.reduce((a, b) => a + b, 0);
        c._automaticValue = true;
      }
    }
    if (type === 'area-chart-card' && c.stacked === undefined) c.stacked = true;
    return c;
  }
  function richTable(card: HTMLElement, c: Row, grid: boolean) {
    card.classList.add('bd-table-card', grid ? 'bd-grid-card' : 'bd-data-table');
    const input = rows(c.rows ?? c.data, 10000);
    let records = input.map((r) => ({ ...r }));
    const cols = rows(c.columns, 32).map((col) => ({ ...col }));
    if (
      cols.some(
        (col) =>
          !text(col.key) || ['__proto__', 'constructor', 'prototype'].includes(text(col.key)),
      )
    )
      fail('表格列 key 需要为普通字段名。');
    if (new Set(cols.map((col) => text(col.key))).size !== cols.length)
      fail('表格列 key 需要保持唯一。');
    let order = cols.map((col) => text(col.key)),
      sort = '',
      asc = true,
      page = 0,
      query = '',
      dense = false;
    const hidden = new Set<string>(),
      selected = new Set<number>(),
      filters = new Map<string, string>();
    let active: { row: number; col: string } | undefined,
      anchor: { row: number; col: string } | undefined;
    const tools = el('div', 'bd-rich-tools'),
      summary = el('p', 'bd-results'),
      search = el('input', 'bd-search') as HTMLInputElement;
    search.placeholder = '搜索…';
    title(search, '搜索 ' + text(c.title));
    search.type = 'search';
    const view = el('div', 'bd-table-wrap'),
      footer = el('div', 'bd-pagination'),
      status = el('p', 'bd-edit-status');
    status.setAttribute('role', 'status');
    const pageSize = Math.min(100, Math.max(1, Math.floor(number(c.pageSize) ?? (grid ? 12 : 8))));
    const menu = el('div', 'bd-column-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'group');
    title(menu, '显示列');
    const colButton = btn('列', () => {
      menu.hidden = !menu.hidden;
      colButton.setAttribute('aria-expanded', String(!menu.hidden));
    });
    colButton.setAttribute('aria-expanded', 'false');
    const toolbar = el('div', 'bd-rich-toolbar');
    toolbar.append(summary, tools);
    tools.append(search, colButton);
    const keys = () => order.filter((k) => !hidden.has(k));
    const colFor = (key: string) => cols.find((col) => text(col.key) === key)!;
    const display = (row: Row, col: Row) => format(valueOf(row, text(col.key)), col);
    const entries = () => {
      const result = records
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) =>
            (!query || cols.some((col) => display(row, col).toLocaleLowerCase().includes(query))) &&
            [...filters].every(([key, v]) => !v || text(valueOf(row, key)) === v),
        );
      if (sort)
        result.sort((a, b) => {
          const av = valueOf(a.row, sort),
            bv = valueOf(b.row, sort);
          if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
          const n =
            typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : text(av).localeCompare(text(bv), undefined, { numeric: true });
          return (asc ? n : -n) || a.index - b.index;
        });
      return result;
    };
    const safeCsv = (v: unknown) => {
      let s = text(v);
      if (typeof v !== 'number' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const exportRows = () => {
      const chosen = entries().filter((r) => !selected.size || selected.has(r.index)),
        ks = keys();
      const content =
        '\uFEFF' +
        [
          ks.map((k) => safeCsv(colFor(k).label)).join(','),
          ...chosen.map(({ row }) => ks.map((k) => safeCsv(valueOf(row, k))).join(',')),
        ].join('\r\n');
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
      const a = el('a') as HTMLAnchorElement;
      a.href = url;
      a.download = (text(c.title) || 'data') + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    tools.append(btn('导出 CSV', exportRows));
    const copy = async (s: string) => {
      try {
        await navigator.clipboard.writeText(s);
        status.textContent = '已复制';
      } catch {
        status.textContent = '复制未完成，请检查剪贴板权限。';
      }
    };
    if (grid)
      tools.append(
        btn('重置', () => {
          records = input.map((r) => ({ ...r }));
          filters.clear();
          hidden.clear();
          selected.clear();
          sort = '';
          query = '';
          search.value = '';
          page = 0;
          status.textContent = '已恢复原始数据';
          draw();
        }),
        btn('行高', () => {
          dense = !dense;
          card.dataset.density = dense ? 'compact' : 'normal';
        }),
      );
    cols.forEach((col) => {
      const key = text(col.key),
        label = el('label', 'bd-column-option');
      const check = el('input') as HTMLInputElement;
      check.type = 'checkbox';
      check.checked = true;
      title(check, '显示 ' + text(col.label));
      check.addEventListener('change', () => {
        if (!check.checked && keys().length === 1) {
          check.checked = true;
          return;
        }
        if (check.checked) hidden.delete(key);
        else hidden.add(key);
        draw();
      });
      label.append(check, el('span', '', col.label));
      menu.append(label);
    });
    const filterBox = el('div', 'bd-column-filters');
    cols
      .filter(
        (col) =>
          col.filterable === true ||
          col.cell === 'select' ||
          col.cell === 'badge' ||
          Array.isArray(col.options),
      )
      .forEach((col) => {
        const select = el('select', 'bd-select') as HTMLSelectElement;
        title(select, '筛选 ' + text(col.label));
        select.add(new Option('全部 ' + text(col.label), ''));
        const options = Array.isArray(col.options)
          ? col.options.map(text)
          : [...new Set(input.map((r) => text(valueOf(r, text(col.key)))))].slice(0, 100);
        options.forEach((v) => select.add(new Option(v, v)));
        select.addEventListener('change', () => {
          filters.set(text(col.key), select.value);
          page = 0;
          draw();
        });
        filterBox.append(select);
      });
    card.append(toolbar, menu, filterBox, view, footer, status);
    search.addEventListener('input', () => {
      query = search.value.trim().toLocaleLowerCase();
      page = 0;
      draw();
    });
    function checkbox(label: string, checked: boolean, action: (v: boolean) => void) {
      const b = el('input', 'bd-check') as HTMLInputElement;
      b.type = 'checkbox';
      title(b, label);
      b.checked = checked;
      b.addEventListener('change', () => action(b.checked));
      return b;
    }
    function typedCell(cell: HTMLElement, row: Row, col: Row) {
      const v = valueOf(row, text(col.key));
      cell.replaceChildren();
      if (col.cell === 'progress') {
        const n = number(v);
        cell.append(el('span', '', display(row, col)));
        if (n !== null) {
          const track = el('div', 'bd-cell-progress'),
            fill = el('i');
          fill.style.width = String(Math.max(0, Math.min(100, n * 100))) + '%';
          track.append(fill);
          cell.append(track);
        }
      } else if (col.cell === 'badge' || col.cell === 'select') {
        const badge = el('span', 'bd-status-chip', display(row, col));
        const n = text(v).toLowerCase();
        badge.dataset.tone = /won|complete|success|已|完成|shipped/.test(n)
          ? 'lime'
          : /fail|error|失败/.test(n)
            ? 'rose'
            : /wait|pending|等待/.test(n)
              ? 'orange'
              : 'blue';
        cell.append(badge);
      } else if (col.cell === 'boolean')
        cell.append(el('span', 'bd-boolean', v === true ? '✓' : v === false ? '—' : '–'));
      else if (col.cell === 'avatar') {
        const person = el('span', 'bd-person');
        person.append(
          el('i', 'bd-person-avatar', text(v).slice(0, 2).toUpperCase()),
          el('span', '', display(row, col)),
        );
        cell.append(person);
      } else cell.append(el('span', '', display(row, col)));
    }
    function validate(raw: string, col: Row): unknown {
      if (col.cell === 'boolean') {
        if (!['true', 'false', ''].includes(raw)) throw new Error('请选择 true 或 false');
        return raw === '' ? null : raw === 'true';
      }
      if (
        col.format === 'number' ||
        col.format === 'currency' ||
        col.format === 'percent' ||
        col.cell === 'number' ||
        col.cell === 'progress'
      ) {
        if (!raw.trim()) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error('请输入有效数字');
        if (number(col.min) !== null && n < Number(col.min)) throw new Error('数值低于下限');
        if (number(col.max) !== null && n > Number(col.max)) throw new Error('数值超过上限');
        return n;
      }
      if (Array.isArray(col.options) && !col.options.map(text).includes(raw))
        throw new Error('请选择已有选项');
      return raw.slice(0, 2048);
    }
    function edit(cell: HTMLElement, index: number, col: Row) {
      if (
        !grid ||
        !(col.editable === true || (c.editable === true && col.editable !== false)) ||
        cell.querySelector('input,select')
      )
        return;
      const field = el(Array.isArray(col.options) ? 'select' : 'input', 'bd-cell-editor') as
        HTMLInputElement | HTMLSelectElement;
      title(field, '编辑 ' + text(col.label));
      if (field.tagName === 'SELECT')
        for (const v of (col.options as unknown[]).map(text))
          (field as HTMLSelectElement).add(new Option(v, v));
      field.value = text(valueOf(records[index]!, text(col.key)));
      cell.replaceChildren(field);
      field.focus();
      if (field instanceof HTMLInputElement) field.select();
      let finished = false;
      const save = (commit: boolean) => {
        if (finished) return;
        try {
          if (commit) records[index]![text(col.key)] = validate(field.value, col);
          finished = true;
          status.textContent = commit ? '已更新预览数据 · 仅本次展示有效' : '已取消编辑';
          draw();
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : '值有误';
          field.setAttribute('aria-invalid', 'true');
          field.focus();
        }
      };
      field.addEventListener('keydown', (event) => {
        const e = event as KeyboardEvent;
        if (e.key === 'Enter') {
          e.preventDefault();
          save(true);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          save(false);
        }
        e.stopPropagation();
      });
      field.addEventListener('blur', () => save(true));
    }
    function focusCell(index: number, key: string) {
      Array.from(view.querySelectorAll<HTMLElement>('[data-row][data-col]'))
        .find((cell) => Number(cell.dataset.row) === index && cell.dataset.col === key)
        ?.focus();
    }
    function paintSelection() {
      const current = entries().slice(page * pageSize, (page + 1) * pageSize),
        ks = keys();
      const r0 = current.findIndex((r) => r.index === active?.row),
        r1 = current.findIndex((r) => r.index === anchor?.row);
      const c0 = ks.indexOf(active?.col || ''),
        c1 = ks.indexOf(anchor?.col || '');
      view.querySelectorAll<HTMLElement>('[data-row][data-col]').forEach((cell) => {
        const ri = current.findIndex((r) => r.index === Number(cell.dataset.row)),
          ci = ks.indexOf(cell.dataset.col || '');
        const selected =
          r0 >= 0 &&
          r1 >= 0 &&
          c0 >= 0 &&
          c1 >= 0 &&
          ri >= Math.min(r0, r1) &&
          ri <= Math.max(r0, r1) &&
          ci >= Math.min(c0, c1) &&
          ci <= Math.max(c0, c1);
        cell.dataset.range = String(selected);
        cell.setAttribute('aria-selected', String(selected));
        cell.tabIndex = ri === r0 && ci === c0 ? 0 : -1;
      });
    }
    function draw() {
      const all = entries();
      page = Math.min(page, Math.max(0, Math.ceil(all.length / pageSize) - 1));
      const current = all.slice(page * pageSize, (page + 1) * pageSize),
        ks = keys();
      if (active && (!current.some((r) => r.index === active!.row) || !ks.includes(active.col))) {
        active = current.length ? { row: current[0]!.index, col: ks[0]! } : undefined;
        anchor = active ? { ...active } : undefined;
      }
      summary.replaceChildren(
        el('span', 'bd-result-label', 'Total Results'),
        el('strong', '', all.length.toLocaleString() + ' ' + (text(c.rowLabel) || 'rows')),
      );
      if (selected.size) summary.append(el('span', 'bd-selection-count', '已选 ' + selected.size));
      menu.querySelectorAll('input').forEach((box, i) => {
        (box as HTMLInputElement).checked = !hidden.has(text(cols[i]!.key));
      });
      filterBox.querySelectorAll('select').forEach((s, i) => {
        const col = cols.filter(
          (col) =>
            col.filterable === true ||
            col.cell === 'select' ||
            col.cell === 'badge' ||
            Array.isArray(col.options),
        )[i]!;
        s.value = filters.get(text(col.key)) || '';
      });
      const table = el('table', grid ? 'bd-grid' : 'bd-advanced-table');
      if (grid) {
        table.setAttribute('role', 'grid');
        table.setAttribute('aria-rowcount', String(all.length + 1));
        table.setAttribute('aria-colcount', String(ks.length + 1));
        title(table, text(c.title) + ' · Enter 或 F2 编辑；方向键导航；Shift 选择范围');
      }
      view.replaceChildren(table);
      const thead = el('thead'),
        head = el('tr'),
        body = el('tbody');
      table.append(thead, body);
      thead.append(head);
      const first = el('th', 'bd-frozen bd-row-selector');
      const allChecked = current.length > 0 && current.every((r) => selected.has(r.index));
      const selectAll = checkbox('选择本页', allChecked, (v) => {
        current.forEach((r) => (v ? selected.add(r.index) : selected.delete(r.index)));
        draw();
      });
      selectAll.indeterminate = !allChecked && current.some((r) => selected.has(r.index));
      first.append(selectAll);
      head.append(first);
      ks.forEach((key, j) => {
        const col = colFor(key),
          th = el('th');
        th.dataset.key = key;
        th.dataset.align = ['number', 'currency', 'percent'].includes(text(col.format))
          ? 'number'
          : 'text';
        th.style.width =
          String(Math.max(72, Math.min(600, number(col.width) ?? (grid ? 160 : 120)))) + 'px';
        if (grid && j === 0) th.classList.add('bd-frozen', 'bd-frozen-first');
        const sortButton = btn(
          text(col.label),
          () => {
            if (col.sortable === false) return;
            if (sort === key) asc = !asc;
            else {
              sort = key;
              asc = true;
            }
            page = 0;
            draw();
          },
          'bd-sort',
        );
        sortButton.dataset.active = String(sort === key);
        sortButton.dataset.ascending = String(asc);
        sortButton.append(svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20 }));
        sortButton.lastChild?.appendChild(
          svg('path', {
            d: 'm8 10 4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.5,
          }),
        );
        th.setAttribute('aria-sort', sort === key ? (asc ? 'ascending' : 'descending') : 'none');
        th.append(sortButton);
        if (grid) {
          th.draggable = true;
          th.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', key));
          th.addEventListener('dragover', (e) => e.preventDefault());
          th.addEventListener('drop', (e) => {
            e.preventDefault();
            const from = e.dataTransfer?.getData('text/plain');
            if (from && order.includes(from) && from !== key) {
              order = order.filter((k) => k !== from);
              order.splice(order.indexOf(key), 0, from);
              draw();
            }
          });
          const resize = el('span', 'bd-column-resize');
          resize.setAttribute('role', 'separator');
          resize.setAttribute('aria-orientation', 'vertical');
          resize.tabIndex = 0;
          title(resize, '调整 ' + text(col.label) + ' 列宽');
          const setWidth = (n: number) => {
            col.width = Math.max(72, Math.min(600, n));
            resize.setAttribute('aria-valuenow', String(col.width));
            th.style.width = String(col.width) + 'px';
          };
          resize.setAttribute('aria-valuemin', '72');
          resize.setAttribute('aria-valuemax', '600');
          setWidth(number(col.width) ?? 160);
          resize.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              setWidth(Number(col.width) + (e.key === 'ArrowRight' ? 10 : -10));
            }
          });
          resize.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const x = e.clientX,
              w = Number(col.width);
            resize.setPointerCapture?.(e.pointerId);
            const move = (v: PointerEvent) => setWidth(w + v.clientX - x);
            const end = () => {
              resize.removeEventListener('pointermove', move);
              resize.removeEventListener('pointerup', end);
              resize.removeEventListener('pointercancel', end);
            };
            resize.addEventListener('pointermove', move);
            resize.addEventListener('pointerup', end, { once: true });
            resize.addEventListener('pointercancel', end, { once: true });
          });
          th.append(resize);
        }
        head.append(th);
      });
      if (!grid) head.append(el('th', '', 'Actions'));
      current.forEach(({ row, index }, ri) => {
        const tr = el('tr');
        tr.dataset.selected = String(selected.has(index));
        tr.setAttribute('aria-rowindex', String(page * pageSize + ri + 2));
        const selection = el('td', 'bd-frozen bd-row-selector');
        selection.append(
          checkbox('选择第 ' + (index + 1) + ' 行', selected.has(index), (v) => {
            if (v) selected.add(index);
            else selected.delete(index);
            draw();
          }),
        );
        if (grid) selection.append(el('small', '', index + 1));
        tr.append(selection);
        ks.forEach((key, j) => {
          const col = colFor(key),
            td = el('td');
          td.dataset.row = String(index);
          td.dataset.col = key;
          td.dataset.align = ['number', 'currency', 'percent'].includes(text(col.format))
            ? 'number'
            : 'text';
          if (grid && j === 0) td.classList.add('bd-frozen', 'bd-frozen-first');
          typedCell(td, row, col);
          if (grid) {
            td.setAttribute('role', 'gridcell');
            td.tabIndex = active?.row === index && active.col === key ? 0 : -1;
            if (!active && ri === 0 && j === 0) td.tabIndex = 0;
            if (active && anchor) {
              const r0 = current.findIndex((r) => r.index === active!.row),
                r1 = current.findIndex((r) => r.index === anchor!.row),
                c0 = ks.indexOf(active.col),
                c1 = ks.indexOf(anchor.col);
              const chosen =
                ri >= Math.min(r0, r1) &&
                ri <= Math.max(r0, r1) &&
                j >= Math.min(c0, c1) &&
                j <= Math.max(c0, c1);
              td.dataset.range = String(chosen);
              td.setAttribute('aria-selected', String(chosen));
            }
            td.addEventListener('click', (e) => {
              if (td.querySelector('input,select')) return;
              active = { row: index, col: key };
              if (!e.shiftKey) anchor = { ...active };
              // Keep the same node: replacing it on click prevents the browser's native dblclick.
              paintSelection();
              focusCell(index, key);
            });
            td.addEventListener('dblclick', () => edit(td, index, col));
            td.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                edit(td, index, col);
                return;
              }
              const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0,
                dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (dr || dc) {
                e.preventDefault();
                const next = current[Math.max(0, Math.min(current.length - 1, ri + dr))]!;
                active = {
                  row: next.index,
                  col: ks[Math.max(0, Math.min(ks.length - 1, j + dc))]!,
                };
                if (!e.shiftKey) anchor = { ...active };
                paintSelection();
                focusCell(active.row, active.col);
              }
            });
            td.addEventListener('copy', (e) => {
              if (td.querySelector('input,select')) return;
              if (!e.clipboardData) return;
              const r0 = current.findIndex((r) => r.index === (anchor?.row ?? index)),
                r1 = current.findIndex((r) => r.index === (active?.row ?? index)),
                c0 = ks.indexOf(anchor?.col ?? key),
                c1 = ks.indexOf(active?.col ?? key);
              const s = current
                .slice(Math.min(r0, r1), Math.max(r0, r1) + 1)
                .map((v) =>
                  ks
                    .slice(Math.min(c0, c1), Math.max(c0, c1) + 1)
                    .map((k) => text(valueOf(v.row, k)).replace(/[\t\r\n]/g, ' '))
                    .join('\t'),
                )
                .join('\n');
              e.preventDefault();
              e.clipboardData.setData('text/plain', s);
            });
            td.addEventListener('paste', (e) => {
              if (td.querySelector('input,select')) return;
              if (!e.clipboardData) return;
              e.preventDefault();
              try {
                const raw = e.clipboardData.getData('text/plain');
                if (raw.length > 65536) throw new Error('粘贴数据超过 64 KiB');
                const changes: { r: number; k: string; v: unknown }[] = [];
                raw
                  .replace(/\r/g, '')
                  .split('\n')
                  .slice(0, 100)
                  .forEach((line, a) =>
                    line
                      .split('\t')
                      .slice(0, 32)
                      .forEach((v, b) => {
                        const target = current[ri + a],
                          k = ks[j + b];
                        if (!target || !k) return;
                        const col = colFor(k);
                        if (
                          col.editable === true ||
                          (c.editable === true && col.editable !== false)
                        )
                          changes.push({ r: target.index, k, v: validate(v, col) });
                      }),
                  );
                changes.forEach((v) => {
                  records[v.r]![v.k] = v.v;
                });
                status.textContent = '已粘贴 ' + changes.length + ' 个单元格 · 仅本次展示有效';
                draw();
              } catch (e) {
                status.textContent = e instanceof Error ? e.message : '粘贴数据有误';
              }
            });
          }
          tr.append(td);
        });
        if (!grid) {
          const actions = el('td'),
            details = el('details', 'bd-row-actions'),
            summary = el('summary', '', '•••');
          title(summary, '第 ' + (index + 1) + ' 行操作');
          details.append(
            summary,
            btn('复制行', () => {
              void copy(cols.map((col) => text(col.label) + ': ' + display(row, col)).join('\n'));
              details.open = false;
            }),
            btn('查看详情', () => {
              const panel = el('dl', 'bd-record-details');
              cols.forEach((col) =>
                panel.append(el('dt', '', col.label), el('dd', '', display(row, col))),
              );
              const old = card.querySelector('.bd-record-details');
              old?.remove();
              card.append(panel);
              details.open = false;
            }),
          );
          actions.append(details);
          tr.append(actions);
        }
        body.append(tr);
      });
      if (!current.length) {
        const empty = el('tr'),
          cell = el('td', 'bd-no-results', '没有匹配的数据');
        cell.setAttribute('colspan', String(ks.length + (grid ? 1 : 2)));
        empty.append(cell);
        body.append(empty);
      }
      if (grid) {
        const foot = el('tfoot'),
          line = el('tr', 'bd-grid-summary');
        line.append(el('td', 'bd-frozen', '汇总'));
        ks.forEach((key, j) => {
          const col = colFor(key),
            td = el('td');
          if (j === 0) td.classList.add('bd-frozen', 'bd-frozen-first');
          const vals = all.map((v) => num(v.row, key)).filter((v): v is number => v !== null),
            agg = text(col.aggregate);
          if (agg) {
            const v =
              agg === 'count'
                ? all.length
                : !vals.length
                  ? null
                  : agg === 'avg'
                    ? vals.reduce((a, b) => a + b, 0) / vals.length
                    : agg === 'min'
                      ? Math.min(...vals)
                      : agg === 'max'
                        ? Math.max(...vals)
                        : vals.reduce((a, b) => a + b, 0);
            td.textContent = agg + ': ' + (agg === 'count' ? text(v) : format(v, col));
          }
          line.append(td);
        });
        foot.append(line);
        table.append(foot);
      }
      footer.replaceChildren(
        el(
          'span',
          '',
          page * pageSize +
            (all.length ? 1 : 0) +
            '–' +
            Math.min((page + 1) * pageSize, all.length) +
            ' / ' +
            all.length,
        ),
      );
      const controls = el('div'),
        prev = btn('上一页', () => {
          page--;
          draw();
        }),
        next = btn('下一页', () => {
          page++;
          draw();
        });
      prev.disabled = page === 0;
      next.disabled = (page + 1) * pageSize >= all.length;
      controls.append(
        prev,
        el('span', '', page + 1 + ' / ' + Math.max(1, Math.ceil(all.length / pageSize))),
        next,
      );
      footer.append(controls);
    }
    draw();
  }
  function ringSvg(c: Row, items: Row[], activity = false, small = false) {
    const root = svgRoot(240, 240, text(c.title)),
      cx = 120,
      cy = 120;
    root.classList.add(activity ? 'bd-activity-svg' : 'bd-radial-svg');
    const max = number(c.max) ?? Math.max(1, ...items.map((r) => num(r) ?? 0)) * 1.1;
    items.forEach((r, i) => {
      const radius = activity
          ? 92 - i * 22
          : items.length === 1
            ? 84
            : 28 + i * Math.min(15, 64 / Math.max(1, items.length - 1)),
        stroke = activity ? 18 : 9;
      const target = number(r.target) ?? max;
      if ((num(r) ?? 0) < 0 || target <= 0) fail('进度数值需要为非负数，目标应大于零。');
      const p = Math.max(0, Math.min(1, (num(r) ?? 0) / target));
      const track = svg('circle', {
        cx,
        cy,
        r: radius,
        fill: 'none',
        stroke: activity ? ['#f9dbee', '#e4f2d4', '#d8eef9'][i % 3]! : 'var(--bd-track)',
        'stroke-width': stroke,
      });
      if (c.variant === 'grid' && !activity) {
        track.setAttribute('stroke-width', '1');
        track.setAttribute('stroke-dasharray', '3 3');
      }
      root.append(track);
      const arc = svg('circle', {
        cx,
        cy,
        r: radius,
        fill: 'none',
        stroke: activity ? ['var(--bd-pink)', 'var(--bd-green)', 'var(--bd-cyan)'][i % 3]! : ink(i),
        'stroke-width': stroke,
        'stroke-linecap': 'round',
        'stroke-dasharray': p * Math.PI * radius * 2 + ' ' + Math.PI * radius * 2,
        transform: 'rotate(-90 120 120)',
        'data-radial-ring': true,
      });
      arc.setAttribute('data-ring-index', String(i));
      if (activity) arc.classList.add('bd-activity-ring');
      arc.append(
        svg(
          'title',
          {},
          text(r.label) +
            ' ' +
            format(r.value, { ...c, ...r }) +
            ' / ' +
            format(target, { ...c, ...r }),
        ),
      );
      if (!small) bind(arc, c, r.value, r.label, root);
      root.append(arc);
    });
    return root;
  }
  function radial(card: HTMLElement, c: Row) {
    const items = dataOf(c).slice(0, 8),
      variant = text(c.variant);
    const panel = el('div', 'bd-radial-panel');
    card.append(panel);
    if (variant === 'gauge' || variant === 'solid') {
      const v = number(c.value) ?? num(items[0]!) ?? 0,
        max = number(c.max) ?? 100;
      const root = ringSvg({ ...c, max }, [{ label: c.title, value: v }], false);
      root.classList.add('bd-single-radial');
      if (variant === 'solid') root.classList.add('bd-solid-radial');
      root.append(
        svg(
          'text',
          { x: 120, y: 125, 'text-anchor': 'middle', class: 'bd-radial-score' },
          Math.round((v / max) * 100) + '%',
        ),
        svg(
          'text',
          { x: 120, y: 147, 'text-anchor': 'middle', class: 'bd-radial-caption' },
          'of goal',
        ),
      );
      panel.append(root);
    } else if (variant === 'stacked') {
      const root = svgRoot(240, 145, text(c.title)),
        sum = items.reduce((s, r) => s + (num(r) ?? 0), 0);
      if (sum <= 0) fail('半环需要至少一项正数。');
      let start = 0;
      items.forEach((r, i) => {
        const v = num(r) ?? 0,
          len = (v / sum) * Math.PI * 90;
        const arc = svg('circle', {
          cx: 120,
          cy: 120,
          r: 90,
          fill: 'none',
          stroke: ink(i),
          'stroke-width': 24,
          'stroke-dasharray': len + ' ' + 2 * Math.PI * 90,
          'stroke-dashoffset': -start,
          transform: 'rotate(180 120 120)',
        });
        start += len;
        bind(arc, c, v, r.label, root);
        root.append(arc);
      });
      root.append(
        svg(
          'text',
          { x: 120, y: 114, 'text-anchor': 'middle', class: 'bd-radial-score' },
          Math.round(((num(items[0]!) ?? 0) / sum) * 100) + '%',
        ),
      );
      panel.append(root);
    } else {
      const root = ringSvg(c, items);
      if (variant === 'grid') root.classList.add('bd-radial-grid');
      if (variant === 'labels')
        items.forEach((r, i) =>
          root.append(
            svg(
              'text',
              {
                x: 125,
                y: 120 - (28 + i * Math.min(15, 64 / Math.max(1, items.length - 1))),
                class: 'bd-ring-label',
              },
              text(r.label),
            ),
          ),
        );
      panel.append(root);
    }
    if (c.tiles !== false) tiles(card, c, items);
  }
  function activity(card: HTMLElement, c: Row) {
    const items = rows(c.items ?? c.data, 5);
    if (items.length > 4) fail('活动环最多展示四项，请拆分。');
    tiles(card, c, items, 'bd-tiles bd-activity-tiles');
    const top = el('div', 'bd-activity-top'),
      header = card.querySelector('.bd-header'),
      metrics = card.querySelector('.bd-activity-tiles');
    if (header) top.append(header);
    if (metrics) top.append(metrics);
    card.prepend(top);
    const panel = el('div', 'bd-activity-panel');
    panel.append(ringSvg(c, items, true));
    card.append(panel);
  }
  function sleep(card: HTMLElement, c: Row) {
    const score = number(c.value) ?? fail('睡眠评分需要 value 数字。');
    const max = number(c.max) ?? 100;
    if (max <= 0 || score < 0) fail('评分范围有误。');
    const items = Array.isArray(c.items) ? rows(c.items, 8) : [];
    const root = svgRoot(240, 104, text(c.title));
    root.append(
      svg('circle', {
        cx: 120,
        cy: 52,
        r: 40,
        fill: 'none',
        stroke: 'var(--bd-track)',
        'stroke-width': 10,
      }),
    );
    let offset = 0;
    (items.length ? items : [{ label: c.title, value: score, target: max }]).forEach((r, i) => {
      const v = num(r) ?? 0,
        share = v / max,
        arc = svg('circle', {
          cx: 120,
          cy: 52,
          r: 40,
          fill: 'none',
          stroke: ink(i + 2),
          'stroke-width': 10,
          'stroke-linecap': 'round',
          'stroke-dasharray': Math.max(0, share * 2 * Math.PI * 40 - 4) + ' ' + 2 * Math.PI * 40,
          'stroke-dashoffset': -offset,
          transform: 'rotate(-90 120 52)',
          'data-sleep-segment': true,
        });
      offset += share * 2 * Math.PI * 40;
      bind(arc, c, v, r.label, root);
      root.append(arc);
    });
    root.append(
      svg('text', { x: 120, y: 63, 'text-anchor': 'middle', class: 'bd-radial-score' }, score),
    );
    const panel = el('div', 'bd-sleep-ring');
    panel.append(root);
    card.append(panel);
    if (items.length) {
      const metrics = el('div', 'bd-sleep-metrics');
      items.forEach((r, i) => {
        const row = el('div', 'bd-sleep-row'),
          dot = el('i', 'bd-dot');
        dot.style.background = ink(i + 2);
        row.append(
          dot,
          el('span', '', r.label),
          el(
            'strong',
            '',
            format(r.value, r) + (number(r.target) !== null ? '/' + format(r.target, r) : ''),
          ),
        );
        bind(row, c, r.value, r.label, metrics);
        metrics.append(row);
      });
      card.append(metrics);
    }
  }
  function horizontalFunnel(card: HTMLElement, c: Row) {
    const items = dataOf(c).slice(0, 12);
    if (items.some((r) => num(r) === null || Number(r.value) < 0)) fail('漏斗阶段需要非负数值。');
    const max = Math.max(1, ...items.map((r) => Number(r.value)));
    const plot = el('div', 'bd-flow-funnel'),
      root = svgRoot(600, 170, text(c.title));
    const w = 600 / items.length;
    card.append(plot);
    plot.append(root);
    items.forEach((r, i) => {
      const start = Math.max(8, (Number(r.value) / max) * 145),
        end = Math.max(8, (Number(items[Math.min(items.length - 1, i + 1)]!.value) / max) * 145),
        x = i * w,
        y = 85 - start / 2,
        z = 85 - end / 2;
      const d =
        c.shape === 'sharp'
          ? 'M' +
            x +
            ',' +
            y +
            'L' +
            (x + w) +
            ',' +
            z +
            'V' +
            (85 + end / 2) +
            'L' +
            x +
            ',' +
            (85 + start / 2) +
            'Z'
          : 'M' +
            x +
            ',' +
            y +
            'C' +
            (x + w * 0.6) +
            ',' +
            y +
            ' ' +
            (x + w * 0.4) +
            ',' +
            z +
            ' ' +
            (x + w) +
            ',' +
            z +
            'V' +
            (85 + end / 2) +
            'C' +
            (x + w * 0.4) +
            ',' +
            (85 + end / 2) +
            ' ' +
            (x + w * 0.6) +
            ',' +
            (85 + start / 2) +
            ' ' +
            x +
            ',' +
            (85 + start / 2) +
            'Z';
      const group = svg('g', { 'data-funnel-stage': true });
      group.append(
        svg('path', { d, fill: ink(i), opacity: 0.18, transform: 'translate(0 -6)' }),
        svg('path', { d, fill: ink(i) }),
        svg('rect', {
          x: x + w / 2 - 19,
          y: 75,
          width: 38,
          height: 20,
          rx: 10,
          fill: 'var(--bd-inner)',
        }),
        svg(
          'text',
          { x: x + w / 2, y: 89, 'text-anchor': 'middle', class: 'bd-funnel-percent' },
          Math.round((Number(r.value) / max) * 100) + '%',
        ),
      );
      bind(group, c, r.value, r.label, root);
      root.append(group);
    });
    tiles(card, c, items);
  }
  function stageBars(card: HTMLElement, c: Row) {
    const items = dataOf(c).slice(0, 32),
      max = Math.max(1, ...items.map((r) => Math.abs(num(r) ?? 0))),
      list = el('div', 'bd-stage-list');
    card.append(list);
    items.forEach((r, i) => {
      const row = el('div', 'bd-stage-pill'),
        label = el('span', 'bd-stage-name', r.label),
        track = el('div', 'bd-stage-background'),
        fill = el('i');
      fill.style.width = String(Math.max(0, ((num(r) ?? 0) / max) * 100)) + '%';
      fill.style.background = ink(i);
      track.append(fill);
      row.append(
        label,
        track,
        el('strong', '', format(r.value, c)),
        el('small', '', Math.round(((num(r) ?? 0) / max) * 100) + '%'),
      );
      bind(row, c, r.value, r.label, list);
      list.append(row);
    });
    if (c.tiles !== false) tiles(card, c, items.slice(0, 12));
  }
  function barList(card: HTMLElement, c: Row) {
    const items = dataOf(c).slice(0, 100),
      list = el('div', 'bd-ranked-list');
    let expanded = false;
    const draw = () => {
      list.replaceChildren();
      const max = Math.max(1, ...items.map((r) => Math.abs(num(r) ?? 0)));
      (expanded ? items : items.slice(0, 6)).forEach((r) => {
        const row = el('div', 'bd-ranked-row'),
          track = el('div', 'bd-ranked-track'),
          fill = el('i'),
          label = el('span', '', r.label);
        fill.style.width = String((Math.abs(num(r) ?? 0) / max) * 100) + '%';
        track.append(fill, label);
        row.append(track, el('strong', '', format(r.value, c)));
        bind(row, c, r.value, r.label, list);
        list.append(row);
      });
      if (items.length > 6)
        list.append(
          btn(
            expanded ? '收起' : '显示全部 ' + items.length + ' 项',
            () => {
              expanded = !expanded;
              draw();
            },
            'bd-expand-list',
          ),
        );
    };
    card.append(list);
    draw();
  }
  function checkedDate(value: unknown): string {
    const key = text(value),
      time = Date.parse(key + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== key
    )
      fail('日期需要使用有效 YYYY-MM-DD。');
    return key;
  }
  function contribution(card: HTMLElement, c: Row): boolean {
    const items = dataOf(c);
    if (!items.some((r) => r.date != null)) return false;
    const keys = items.map((r) => checkedDate(r.date));
    if (new Set(keys).size !== keys.length) fail('贡献日历存在重复日期，请先明确汇总口径。');
    if (items.some((r) => r.value != null && (num(r) === null || Number(r.value) < 0)))
      fail('贡献强度需要非负数字，缺失数据请使用 null。');
    const dates = keys.map((key) => Date.parse(key + 'T00:00:00Z'));
    if (dates.some((n) => !Number.isFinite(n))) fail('日期需要使用有效 YYYY-MM-DD。');
    const end = Math.max(...dates),
      start = Math.min(...dates);
    if (end - start > 366 * 86400000) fail('贡献日历按一年分开展示。');
    const first = new Date(start);
    first.setUTCDate(first.getUTCDate() - first.getUTCDay());
    const count = Math.min(371, Math.ceil((end - first.getTime()) / 86400000) + 1),
      weeks = Math.ceil(count / 7),
      lookup = new Map(items.map((r) => [text(r.date), r]));
    const max = Math.max(1, ...items.map((r) => num(r) ?? 0)),
      container = el('div', 'bd-contribution-scroll'),
      calendar = el('div', 'bd-contribution-grid');
    calendar.style.setProperty('--bd-weeks', String(weeks));
    container.append(calendar);
    card.append(container);
    const toolbar = el('div', 'bd-contribution-toolbar');
    toolbar.append(el('span', '', 'Activity'));
    const periods = card.querySelector('.bd-periods');
    if (periods) toolbar.append(periods);
    container.prepend(toolbar);
    let month = -1;
    for (let w = 0; w < weeks; w++) {
      const date = new Date(first.getTime() + w * 7 * 86400000),
        m = date.getUTCMonth(),
        label = el(
          'span',
          'bd-contribution-month',
          m !== month
            ? new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date)
            : '',
        );
      month = m;
      label.style.gridColumn = String(w + 1);
      label.style.gridRow = '1';
      calendar.append(label);
    }
    for (let i = 0; i < weeks * 7; i++) {
      const date = new Date(first.getTime() + i * 86400000).toISOString().slice(0, 10),
        r = lookup.get(date),
        b = el('button', 'bd-contribution-cell') as HTMLButtonElement;
      b.type = 'button';
      b.dataset.date = date;
      b.dataset.missing = String(!r || num(r) === null);
      b.style.gridColumn = String(Math.floor(i / 7) + 1);
      b.style.gridRow = String((i % 7) + 2);
      b.style.setProperty(
        '--bd-intensity',
        String(r && num(r) !== null ? 0.16 + Math.min(1, (num(r) ?? 0) / max) * 0.84 : 0),
      );
      title(b, date + ' · ' + (r ? format(r.value, c) : '缺少数据'));
      if (r) bind(b, c, r.value, date, calendar);
      calendar.append(b);
    }
    if (Array.isArray(c.metrics)) {
      tiles(card, c, rows(c.metrics, 8));
      const metrics = card.querySelector('.bd-tiles');
      if (metrics) card.insertBefore(metrics, container);
    }
    return true;
  }
  function dailyCalendar(card: HTMLElement, c: Row) {
    const mainValue = card.querySelector('.bd-value');
    if (mainValue && c.unit) {
      mainValue.textContent = format(c.value, { ...c, unit: '' });
      mainValue.after(el('small', 'bd-calendar-unit', c.unit));
    }
    const items = dataOf(c);
    const valid = items.some((r) => r.date != null);
    if (valid) {
      const dates = items.map((r) => checkedDate(r.date));
      if (new Set(dates).size !== dates.length) fail('活动日历存在重复日期，请先汇总。');
    }
    const months = valid ? [...new Set(items.map((r) => text(r.date).slice(0, 7)))].sort() : [''];
    let current = 0,
      selected = '';
    const calendar = el('div', 'bd-day-calendar'),
      nav = el('div', 'bd-calendar-nav'),
      month = el('span', 'bd-calendar-month');
    const prev = btn('‹', () => {
        if (current > 0) {
          current--;
          draw();
        }
      }),
      next = btn('›', () => {
        if (current < months.length - 1) {
          current++;
          draw();
        }
      });
    title(prev, '上个月');
    title(next, '下个月');
    nav.append(prev, month, next);
    card.querySelector('.bd-header')?.append(nav);
    card.append(calendar);
    const draw = () => {
      calendar.replaceChildren();
      month.textContent = months[current] || text(c.timeRange) || '已提供日期';
      prev.disabled = current === 0;
      next.disabled = current === months.length - 1;
      const shown = valid ? items.filter((r) => text(r.date).startsWith(months[current]!)) : items;
      if (c._automaticValue) {
        c.value = shown.reduce((n, r) => n + (num(r) ?? 0), 0);
        focus(c, c.value);
      }
      if (valid) {
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((v) =>
          calendar.append(el('span', 'bd-weekday', v)),
        );
        const date = new Date(months[current] + '-01T00:00:00Z');
        if (!Number.isFinite(date.getTime())) fail('日历日期有误。');
        for (let i = 0; i < date.getUTCDay(); i++) calendar.append(el('span'));
        const count = new Date(date.getUTCFullYear(), date.getUTCMonth() + 1, 0).getDate(),
          lookup = new Map(shown.map((r) => [text(r.date), r]));
        for (let day = 1; day <= count; day++) {
          const key = months[current] + '-' + String(day).padStart(2, '0');
          addDay(lookup.get(key), String(day), key);
        }
      } else shown.forEach((r) => addDay(r, text(r.label), text(r.label)));
    };
    function addDay(r: Row | undefined, label: string, key: string) {
      const b = btn(
        '',
        () => {
          if (!r) return;
          selected = key;
          focus(c, r.value, key);
          draw();
        },
        'bd-day-button',
      );
      b.dataset.selected = String(key === selected);
      b.disabled = !r;
      title(b, key + ' · ' + (r ? format(r.value, c) : '缺少数据'));
      b.append(el('span', '', label));
      if (r) {
        const values = Array.isArray(r.items)
          ? rows(r.items, 3)
          : [
              {
                label: c.title,
                value: r.value,
                target:
                  number(r.target) ??
                  number(c.target) ??
                  number(c.max) ??
                  Math.max(1, ...items.map((r) => num(r) ?? 0)),
              },
            ];
        const ring = ringSvg(c, values, true, true);
        ring.classList.add('bd-day-ring');
        b.append(ring);
      } else b.append(el('span', 'bd-day-missing', '·'));
      calendar.append(b);
    }
    draw();
  }
  function stackedArea(card: HTMLElement, c: Row) {
    const ds = rows(c.data),
      series = Array.isArray(c.series) ? rows(c.series, 12) : [{ key: 'value', label: c.title }],
      plot = el('div', 'bd-plot bd-stacked-area');
    card.append(plot);
    const draw = () => {
      plot.replaceChildren();
      const w = Math.max(260, Math.floor(plot.getBoundingClientRect().width || 560)),
        left = 44,
        top = 6,
        bottom = 32,
        pw = w - left - 6,
        h = 196,
        ph = h - top - bottom,
        normalized = c.variant === 'percent',
        stacked = c.stacked !== false && c.variant !== 'overlap';
      const totals = ds.map((r) =>
          series.reduce((s, v) => s + Math.max(0, num(r, text(v.key)) ?? 0), 0),
        ),
        max = normalized
          ? 1
          : Math.max(
              1,
              ...(stacked
                ? totals
                : ds.flatMap((r) => series.map((v) => num(r, text(v.key)) ?? 0))),
            ) * 1.1,
        root = svgRoot(w, h, text(c.title));
      const y = (v: number) => top + ph - (v / max) * ph,
        x = (i: number) => left + (pw * i) / Math.max(1, ds.length - 1);
      for (let j = 0; j < 4; j++)
        root.append(
          svg(
            'text',
            { x: left - 8, y: y((max * j) / 3) + 3, 'text-anchor': 'end', class: 'bd-axis' },
            normalized
              ? Math.round(((max * j) / 3) * 100) + '%'
              : new Intl.NumberFormat('en', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format((max * j) / 3),
          ),
        );
      const accum = ds.map(() => 0);
      series.forEach((s, j) => {
        const upper: (number | null)[] = [],
          lower: (number | null)[] = [];
        ds.forEach((r, i) => {
          const v = num(r, text(s.key));
          if (v === null) {
            upper.push(null);
            lower.push(null);
            return;
          }
          const n = normalized ? (totals[i]! > 0 ? v / totals[i]! : 0) : v;
          lower.push(stacked ? accum[i]! : 0);
          upper.push((stacked ? accum[i]! : 0) + n);
          if (stacked) accum[i]! += n;
        });
        let segment: number[] = [];
        const flush = () => {
          if (!segment.length) return;
          const up = segment.map((i) => [x(i), y(upper[i]!)] as [number, number]),
            low = segment
              .slice()
              .reverse()
              .map((i) => [x(i), y(lower[i]!)] as [number, number]);
          const smooth = c.shape !== 'sharp',
            upperPath = linePath(up, smooth),
            lowerPath = linePath(low, smooth),
            path = upperPath + lowerPath.replace(/^M/, 'L') + 'Z';
          root.append(
            svg('path', { d: path, fill: ink(j), opacity: 0.18, class: 'bd-area-fill' }),
            svg('path', { d: upperPath, fill: 'none', stroke: ink(j), 'stroke-width': 1.5 }),
          );
          segment = [];
        };
        upper.forEach((v, i) => {
          if (v === null) flush();
          else segment.push(i);
        });
        flush();
      });
      ds.forEach((r, i) => {
        if (ds.length < 15 || i % Math.ceil(ds.length / 12) === 0)
          root.append(
            svg(
              'text',
              { x: x(i), y: h - 8, 'text-anchor': 'middle', class: 'bd-axis' },
              text(r[text(c.labelKey) || 'label']),
            ),
          );
        const hit = svg('rect', {
          x: Math.max(left, x(i) - pw / Math.max(1, ds.length - 1) / 2),
          y: top,
          width: pw / Math.max(1, ds.length - 1),
          height: ph,
          fill: 'transparent',
          'data-area-hit': true,
        });
        bind(hit, c, totals[i], r[text(c.labelKey) || 'label'], root);
        root.append(hit);
      });
      plot.append(root);
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
    }
    tiles(
      card,
      c,
      series.map((s) => ({
        label: s.label,
        value: ds.reduce((n, r) => n + (num(r, text(s.key)) ?? 0), 0),
        format: s.format,
        currency: s.currency,
        unit: s.unit,
      })),
    );
  }
  function linkRingTiles(card: HTMLElement) {
    const nodes = Array.from(
      card.querySelectorAll<HTMLElement>('[data-ring-index],[data-tile-index]'),
    );
    nodes.forEach((node) => {
      const index = node.getAttribute('data-ring-index') ?? node.dataset.tileIndex;
      const on = () =>
        nodes.forEach((peer) =>
          peer.setAttribute(
            'data-dim',
            String((peer.getAttribute('data-ring-index') ?? peer.dataset.tileIndex) !== index),
          ),
        );
      const off = () => nodes.forEach((peer) => peer.removeAttribute('data-dim'));
      node.addEventListener('pointerenter', on);
      node.addEventListener('focus', on);
      node.addEventListener('pointerleave', off);
      node.addEventListener('blur', off);
    });
  }
  function render(card: HTMLElement, c: Row, kind: string): boolean {
    const type = text(c.type);
    card.dataset.template = type;
    if (type === 'data-grid' || type === 'data-table') {
      richTable(card, c, type === 'data-grid');
      return true;
    }
    if (type === 'radial-chart-card' || type === 'radial') {
      radial(card, c);
      linkRingTiles(card);
      return true;
    }
    if (type === 'most-active-days-card') {
      dailyCalendar(card, c);
      return true;
    }
    if (type === 'activity-rings-card') {
      activity(card, c);
      linkRingTiles(card);
      return true;
    }
    if (type === 'sleep-score-card') {
      if (c.description) {
        const value = card.querySelector('.bd-value');
        if (value) value.textContent = text(c.description);
      }
      sleep(card, c);
      return true;
    }
    if (type === 'funnel-chart-card') {
      horizontalFunnel(card, c);
      return true;
    }
    if (type === 'stage-bars-card') {
      stageBars(card, c);
      return true;
    }
    if (type === 'bar-list-card') {
      const header = card.querySelector('.bd-header'),
        identity = header?.querySelector('.bd-identity');
      identity?.classList.add('bd-sr-only');
      header?.append(el('small', 'bd-list-metric', c.title));
      barList(card, c);
      return true;
    }
    if (type === 'contributions-card' || type === 'contributions') return contribution(card, c);
    if (type === 'area-chart-card') {
      stackedArea(card, c);
      return true;
    }
    void kind;
    return false;
  }
  function finish(card: HTMLElement, c: Row, kind: string) {
    const type = text(c.type);
    if (!type.endsWith('-card')) return;
    if (type === 'steps-card' && c.unit)
      card.querySelector('.bd-value')?.after(el('small', 'bd-calendar-unit', c.unit));
    if (['combo-chart-card', 'radar-chart-card', 'scatter-chart-card'].includes(type)) {
      card.querySelector('.bd-legend')?.remove();
      const ds = rows(c.data);
      let metrics: Row[] = [];
      if (kind === 'scatter') {
        const groups = [...new Set(ds.map((r) => text(r.series) || text(c.title)))];
        metrics = groups.map((label) => {
          const values = ds
            .filter((r) => (text(r.series) || text(c.title)) === label)
            .map((r) => num(r, 'y'))
            .filter((v): v is number => v !== null);
          return {
            label: label + ' · avg',
            value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
          };
        });
      } else if (kind === 'radar') {
        const s = Array.isArray(c.series) ? rows(c.series, 12) : [{ key: 'value' }];
        metrics = ds.map((r) => ({
          label: r[text(c.labelKey) || 'label'],
          value: valueOf(r, text(s[0]!.key) || 'value'),
        }));
      } else {
        const s = rows(c.series, 12);
        metrics = s.map((v) => {
          const vals = ds.map((r) => num(r, text(v.key))).filter((n): n is number => n !== null),
            average = v.type === 'line';
          return {
            ...v,
            label: text(v.label) + (average ? ' · average' : ' · total'),
            value: vals.length
              ? vals.reduce((a, b) => a + b, 0) / (average ? vals.length : 1)
              : null,
          };
        });
      }
      if (type === 'scatter-chart-card') {
        const labels = el('div', 'bd-scatter-captions');
        labels.append(el('span', '', c.yLabel || 'Y'), el('span', '', c.xLabel || 'X'));
        card.append(labels);
      }
      tiles(card, c, metrics.slice(0, 12));
    }
    if (type === 'heatmap-chart-card') {
      const scale = el('div', 'bd-heat-legend');
      scale.append(el('span', '', 'Less'));
      for (let i = 0; i < 5; i++) {
        const swatch = el('i');
        swatch.style.background =
          'color-mix(in srgb,var(--bd-blue) ' + (15 + i * 20) + '%,var(--bd-track))';
        scale.append(swatch);
      }
      scale.append(el('span', '', 'More'));
      card.append(scale);
    }
    card
      .querySelectorAll<SVGElement>(
        'svg [data-bar], svg circle[tabindex], svg polygon, svg path[data-link]',
      )
      .forEach((e) => {
        if (e.hasAttribute('tabindex')) return;
        const t = e.querySelector('title')?.textContent;
        if (t) {
          e.setAttribute('tabindex', '0');
          title(e, t);
        }
      });
  }
  return { prepare, render, finish };
}
