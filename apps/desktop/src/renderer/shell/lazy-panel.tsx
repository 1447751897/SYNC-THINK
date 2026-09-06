import {
  Component,
  Suspense,
  lazy,
  useState,
  type ComponentType,
  type PropsWithRef,
  type ReactNode,
} from 'react';
import { loadShellPanel } from './shell-chunk-retry.js';

class PanelLoadBoundary extends Component<
  { label: string; onRetry: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="shell-panel-load-state" role="alert">
        <span>{this.props.label}加载失败</span>
        <button type="button" onClick={this.props.onRetry}>
          重试加载
        </button>
      </div>
    );
  }
}

export function lazyPanel<Props extends object>(
  load: () => Promise<{ default: (props: Props) => ReactNode }>,
  label: string,
  entry?: string,
): ComponentType<Props> {
  return function DeferredPanel(props: Props) {
    const [state, setState] = useState(() => ({ Panel: lazy(load), attempt: 0 }));
    const { Panel, attempt } = state;
    return (
      <PanelLoadBoundary
        key={attempt}
        label={label}
        onRetry={() =>
          setState({
            Panel: lazy(() => loadShellPanel(load, entry, attempt + 1)),
            attempt: attempt + 1,
          })
        }
      >
        <Suspense
          fallback={
            <div className="shell-panel-load-state" role="status" aria-busy="true">
              正在加载{label}…
            </div>
          }
        >
          <Panel key="page" {...(props as PropsWithRef<Props>)} />
        </Suspense>
      </PanelLoadBoundary>
    );
  };
}
