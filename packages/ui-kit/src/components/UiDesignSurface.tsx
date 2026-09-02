import { BarChart3, CheckCircle2, Circle, List, Table2, ToggleLeft } from 'lucide-react';
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

export interface UiDesignSurfaceProps {
  artifact: UiDesignArtifact;
}

function NodeView({ node }: { node: UiDesignNode }) {
  if (node.type === 'heading') {
    const Heading = node.level === 1 ? 'h1' : node.level === 3 ? 'h3' : 'h2';
    return <Heading className={`st-ui-design__heading st-ui-design__heading--${node.level ?? 2}`}>{node.text}</Heading>;
  }
  if (node.type === 'text') return <p className="st-ui-design__text">{node.text}</p>;
  if (node.type === 'metric') {
    return (
      <article className="st-ui-design__metric" data-tone={node.tone ?? 'neutral'}>
        <span>{node.label}</span>
        <strong>{node.value}</strong>
        {node.detail ? <small>{node.detail}</small> : null}
      </article>
    );
  }
  if (node.type === 'card') {
    return <article className="st-ui-design__card" style={node.accent ? { borderTopColor: node.accent } : undefined}>
      <h3>{node.title}</h3>
      {node.text ? <p>{node.text}</p> : null}
    </article>;
  }
  if (node.type === 'list') {
    return <section className="st-ui-design__block">
      <div className="st-ui-design__block-title"><List size={14} aria-hidden="true" />{node.title ?? '列表'}</div>
      <ul className="st-ui-design__list">{node.items.map((item, index) => <li key={`${item}-${index}`}><Circle size={7} aria-hidden="true" />{item}</li>)}</ul>
    </section>;
  }
  if (node.type === 'table') {
    return <section className="st-ui-design__block">
      <div className="st-ui-design__block-title"><Table2 size={14} aria-hidden="true" />数据表</div>
      <div className="st-ui-design__table-wrap"><table><thead><tr>{node.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>
    </section>;
  }
  return <section className="st-ui-design__block">
    <div className="st-ui-design__block-title"><ToggleLeft size={14} aria-hidden="true" />配置</div>
    <form className="st-ui-design__form" onSubmit={(event) => event.preventDefault()}>
      {node.fields.map((field) => <label key={field.label}><span>{field.label}</span>{field.kind === 'toggle' ? <button type="button" className="st-ui-design__toggle" aria-label={field.label}><CheckCircle2 size={16} aria-hidden="true" /></button> : field.kind === 'select' ? <select defaultValue={field.value ?? ''}><option value="">请选择</option><option>{field.value || '默认选项'}</option></select> : <input defaultValue={field.value ?? ''} />}</label>)}
      <button type="submit" className="st-ui-design__submit">{node.submitLabel ?? '保存'}</button>
    </form>
  </section>;
}

export function UiDesignSurface({ artifact }: UiDesignSurfaceProps) {
  return <section className="st-ui-design" data-testid="ui-design-surface">
    <header className="st-ui-design__header"><div><span className="st-ui-design__eyebrow">UI KIT DESIGN</span><h2>{artifact.title}</h2>{artifact.subtitle ? <p>{artifact.subtitle}</p> : null}</div><BarChart3 size={18} aria-hidden="true" /></header>
    <div className="st-ui-design__body">
      {artifact.sidebar ? <aside className="st-ui-design__sidebar"><strong>{artifact.sidebar.title ?? '工作区'}</strong><nav>{artifact.sidebar.items.map((item) => <button type="button" key={item.label} className={item.active ? 'is-active' : undefined}>{item.label}{item.badge ? <small>{item.badge}</small> : null}</button>)}</nav></aside> : null}
      <main className="st-ui-design__content">{artifact.nodes.map((node, index) => <NodeView key={`${node.type}-${index}`} node={node} />)}</main>
    </div>
  </section>;
}
