import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Puzzle } from 'lucide-react';
import type { GlobalAgent } from '@sync-think/shared';
import type { SkillVersionSummary } from '@sync-think/protocol';
import {
  filterEquippedSkillOptions,
  MAX_TURN_SKILL_SELECTION,
  resolveAppendSkillVersionIds,
} from './compose-skill-selection.js';
import { SkillPickerMenu } from './compose-toolbar.js';

type CatalogStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface CatalogState {
  scopeKey: string;
  status: CatalogStatus;
  skills: SkillVersionSummary[];
  error?: string;
}

export interface TurnSkillControlProps {
  owner?: Pick<GlobalAgent, 'id' | 'skillIds'>;
  open: boolean;
  selectedSkillVersionIds: readonly string[];
  onOpenChange(open: boolean): void;
  onChange(skillVersionIds: string[]): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Skill 目录加载失败，请重试';
}

export function TurnSkillControl(props: TurnSkillControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ownerScopeKey = props.owner
    ? `${String(props.owner.id)}\u0000${props.owner.skillIds.map(String).join('\u0000')}`
    : 'model-direct';
  const activeScopeRef = useRef(ownerScopeKey);
  activeScopeRef.current = ownerScopeKey;
  const requestGenerationRef = useRef(0);
  const loadingScopeRef = useRef<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>(() => ({
    scopeKey: ownerScopeKey,
    status: 'idle',
    skills: [],
  }));

  useEffect(() => {
    requestGenerationRef.current += 1;
    loadingScopeRef.current = null;
    setCatalog({ scopeKey: ownerScopeKey, status: 'idle', skills: [] });
  }, [ownerScopeKey]);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
    },
    [],
  );

  const loadCatalog = useCallback(() => {
    if (!props.owner) return;
    const requestScope = ownerScopeKey;
    if (loadingScopeRef.current === requestScope) return;
    loadingScopeRef.current = requestScope;
    const generation = (requestGenerationRef.current += 1);
    setCatalog({ scopeKey: requestScope, status: 'loading', skills: [] });
    const api = window.syncThink?.runtime;
    if (!api?.listSkills) {
      loadingScopeRef.current = null;
      setCatalog({
        scopeKey: requestScope,
        status: 'error',
        skills: [],
        error: 'Skill 目录服务尚未就绪，请重试',
      });
      return;
    }
    void api
      .listSkills({ skillVersionIds: props.owner.skillIds.map(String) })
      .then((response) => {
        if (
          requestGenerationRef.current !== generation ||
          activeScopeRef.current !== requestScope
        ) {
          return;
        }
        loadingScopeRef.current = null;
        setCatalog({
          scopeKey: requestScope,
          status: 'loaded',
          skills: response.skills,
        });
      })
      .catch((error: unknown) => {
        if (
          requestGenerationRef.current !== generation ||
          activeScopeRef.current !== requestScope
        ) {
          return;
        }
        loadingScopeRef.current = null;
        setCatalog({
          scopeKey: requestScope,
          status: 'error',
          skills: [],
          error: errorMessage(error),
        });
      });
  }, [ownerScopeKey, props.owner]);

  useEffect(() => {
    if (
      props.open &&
      props.owner &&
      catalog.scopeKey === ownerScopeKey &&
      catalog.status === 'idle'
    ) {
      loadCatalog();
    }
  }, [catalog.scopeKey, catalog.status, loadCatalog, ownerScopeKey, props.open, props.owner]);

  const selected = useMemo(
    () => resolveAppendSkillVersionIds('agent', props.selectedSkillVersionIds),
    [props.selectedSkillVersionIds],
  );
  const options = useMemo(
    () => filterEquippedSkillOptions(props.owner?.skillIds ?? [], catalog.skills),
    [catalog.skills, props.owner?.skillIds],
  );
  const disabled = !props.owner;
  const title = disabled
    ? '模型直聊没有 Agent Skill；请先切换对话对象为智能体或小队'
    : `本轮 Skill：${selected.length}/8`;

  const toggle = useCallback(
    (skillVersionId: string) => {
      if (selected.includes(skillVersionId)) {
        props.onChange(selected.filter((id) => id !== skillVersionId));
        return;
      }
      if (selected.length >= MAX_TURN_SKILL_SELECTION) return;
      props.onChange([...selected, skillVersionId]);
    },
    [props, selected],
  );

  return (
    <div className="shell-compose__tool-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="shell-compose__tool"
        data-active={props.open || selected.length > 0 ? '1' : '0'}
        data-testid="turn-skill-trigger"
        disabled={disabled}
        title={title}
        onClick={() => props.onOpenChange(!props.open)}
      >
        <Puzzle size={15} />
        <span className="shell-compose__tool-label w-[3.5ch] tabular-nums">
          {selected.length}/8
        </span>
      </button>
      <SkillPickerMenu
        open={!disabled && props.open}
        options={options}
        selectedSkillVersionIds={selected}
        loading={catalog.status === 'loading'}
        error={catalog.status === 'error' ? catalog.error : undefined}
        anchorEl={buttonRef.current}
        onClose={() => props.onOpenChange(false)}
        onToggle={toggle}
        onClear={() => props.onChange([])}
        onRetry={loadCatalog}
      />
    </div>
  );
}
