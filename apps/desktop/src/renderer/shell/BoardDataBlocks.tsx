import { useEffect, useMemo, useRef, useState } from 'react';
import {
  boardDataBlockInitialHeight,
  splitBoardDataBlocks,
} from '../visualization/board-data-blocks.js';
import { buildVisualizationDocumentHtml } from '../visualization/ui-kit.js';
import {
  readVisualizationDesignTokens,
  visualizationReduceMotion,
  visualizationTheme,
} from '../visualization/design-system.js';
import { BoardDataPreview } from './BoardDataPreview.js';
import './BoardDataBlocks.css';

function DataBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const initialHeight = useMemo(
    () => boardDataBlockInitialHeight(source, window.innerWidth <= 500),
    [source],
  );
  const [active, setActive] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (active || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [active]);
  const html = useMemo(
    () =>
      active
        ? buildVisualizationDocumentHtml(source, {
            theme: visualizationTheme(),
            tokens: readVisualizationDesignTokens(),
            reduceMotion: visualizationReduceMotion(),
          })
        : '',
    [active, source],
  );
  return (
    <div ref={ref} className="shell-data-block" data-testid="board-data-block">
      {active ? (
        <BoardDataPreview html={html} inline initialHeight={initialHeight} />
      ) : (
        <div
          className="shell-data-block__placeholder"
          role="status"
          style={{ minHeight: initialHeight }}
        >
          数据组件将在滚动到这里时显示…
        </div>
      )}
    </div>
  );
}

/** Data inspection belongs to the main chat scroll, not to a single dashboard viewport. */
export default function BoardDataBlocks({
  source,
  fallbackHtml,
}: {
  source: string;
  fallbackHtml: string;
}) {
  const result = useMemo(() => {
    try {
      return { groups: splitBoardDataBlocks(source), error: null };
    } catch (error) {
      return { groups: null, error: error instanceof Error ? error.message : '数据配置需要调整。' };
    }
  }, [source]);
  if (result.error)
    return (
      <div className="shell-html__error" role="alert">
        {result.error} 源码仍保留。
      </div>
    );
  if (result.groups === null) return <BoardDataPreview html={fallbackHtml} />;
  return (
    <div className="shell-data-blocks" data-testid="board-data-blocks">
      {result.groups.map((group, index) => (
        <section className="shell-data-group" key={index}>
          {group.title || group.description ? (
            <header className="shell-data-group__intro">
              {group.title ? <h3>{group.title}</h3> : null}
              {group.description ? <p>{group.description}</p> : null}
            </header>
          ) : null}
          {group.blocks.map((block, blockIndex) => (
            <DataBlock source={block} key={blockIndex} />
          ))}
          {group.source || group.timeRange ? (
            <p className="shell-data-group__caption">
              {[group.source, group.timeRange].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
