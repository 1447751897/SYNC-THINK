import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { answerSourceFromHref, isCitationLabel, type AnswerSource } from './answer-sources.js';

interface CitationState {
  sources: readonly AnswerSource[];
  open: boolean;
  setOpen(open: boolean): void;
  selection?: { key: string; request: number };
  select(key: string): void;
  targetId(key: string): string;
}
const Context = createContext<CitationState | undefined>(undefined);
export const useCitations = () => useContext(Context);

/** Each reply owns its disclosure, ids and navigation; no global selectors or document hash. */
export function CitationScope({
  sources,
  children,
}: {
  sources: readonly AnswerSource[];
  children: ReactNode;
}) {
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<CitationState['selection']>();
  const targetId = useCallback(
    (key: string) => 'source-' + prefix + '-' + encodeURIComponent(key),
    [prefix],
  );
  const select = useCallback((key: string) => {
    setOpen(true);
    setSelection((current) => ({ key, request: (current?.request ?? 0) + 1 }));
  }, []);
  const value = useMemo(
    () => ({ sources, open, setOpen, selection, select, targetId }),
    [sources, open, selection, select, targetId],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCitationLink(href: string, label: string, projectFolder?: string) {
  const scope = useCitations();
  if (!scope || !isCitationLabel(label)) return undefined;
  const target = answerSourceFromHref(href, projectFolder);
  if (!target) return undefined;
  const citations = scope.sources.filter((source) => source.origin === 'citation');
  const index = citations.findIndex((source) => source.key === target.key);
  if (index < 0) return undefined;
  const source = citations[index]!;
  return {
    source,
    index: index + 1,
    targetId: scope.targetId(source.key),
    onSelect: () => scope.select(source.key),
  };
}
