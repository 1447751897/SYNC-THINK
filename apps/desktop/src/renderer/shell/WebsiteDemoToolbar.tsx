import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowUp, MessageSquare, Puzzle, Square } from 'lucide-react';
import { ComposerAddControl } from './ComposerAddMenu.js';
import type { ComposerEditorHandle } from './ComposerEditor.js';
import type { ComposeAttachment } from './compose-mention.js';
import {
  demoKernels,
  demoModels as models,
  demoSkills,
  type DemoRoster,
} from './website-capability-state.js';
import { resolveKernelDisplayName } from './brand-icons.js';
export { demoSkills } from './website-capability-state.js';
import {
  ContextRing,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  SkillPickerMenu,
  PERMISSION_OPTIONS,
  REASONING_LABELS,
  useComposerToolbarCollapse,
  type IdentityOption,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';

export interface DemoComposeSettings {
  kernel: string;
  permission: PermissionMode;
  reasoning: ReasoningEffort;
  network: boolean;
  skills: string[];
  identity: IdentityOption;
}
export const initialDemoSettings: DemoComposeSettings = {
  kernel: 'native',
  permission: 'ask',
  reasoning: 'auto',
  network: false,
  skills: [],
  identity: { track: 'model', targetRef: '', name: '直接跟模型聊' },
};

export function WebsiteDemoToolbar(props: {
  editor: RefObject<ComposerEditorHandle | null>;
  input: string;
  onInput(value: string): void;
  model: string;
  onModel(value: string): void;
  mode: 'plan' | 'execute';
  onMode(value: 'plan' | 'execute'): void;
  onGoal(): void;
  settings: DemoComposeSettings;
  roster?: DemoRoster;
  onSettings(value: DemoComposeSettings): void;
  attachments: ComposeAttachment[];
  onAttachments(value: ComposeAttachment[]): void;
  onNotice(value: string): void;
  busy: boolean;
  generating: boolean;
  onSend(): void;
  onStop(): void;
}) {
  const [menu, setMenu] = useState<'add' | 'permission' | 'skill' | 'identity' | 'model' | null>(
    null,
  );
  const permissionRef = useRef<HTMLButtonElement>(null);
  const skillRef = useRef<HTMLButtonElement>(null);
  const identityRef = useRef<HTMLButtonElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const toolbar = useComposerToolbarCollapse({
    permissionMenuOpen: menu === 'permission',
    onPermissionMenuOpenChange: (open) => {
      if (!open) setMenu(null);
    },
  });
  useEffect(() => {
    if (/(?:^|\s)@[^\s]*$/.test(props.input)) setMenu('add');
  }, [props.input]);
  const inputRef = useMemo(
    () => ({
      get current() {
        return props.editor.current?.getInputElement() ?? null;
      },
    }),
    [props.editor],
  );
  const composerRef = useMemo(
    () => ({
      get current() {
        return (
          props.editor.current?.getRootElement()?.closest<HTMLElement>('.shell-newmax-composer') ??
          null
        );
      },
    }),
    [props.editor],
  );
  const change = (value: Partial<DemoComposeSettings>) =>
    props.onSettings({ ...props.settings, ...value });
  const toggle = (name: typeof menu) => setMenu(menu === name ? null : name);
  const permission = PERMISSION_OPTIONS.find((item) => item.value === props.settings.permission)!;
  const PermissionIcon = permission.Icon;
  return (
    <div className="shell-compose__bar" ref={toolbar.outerRef}>
      <div className="shell-compose__bar-left" ref={toolbar.leftRef}>
        <ComposerAddControl
          variant="conversation"
          open={menu === 'add'}
          inputRef={inputRef}
          composerRef={composerRef}
          value={props.input}
          onValueChange={props.onInput}
          onOpenChange={(open) => setMenu(open ? 'add' : null)}
          workspaceFolder="demo-workspace"
          selectedFilePaths={props.attachments.map((item) => item.path)}
          networkEnabled={props.settings.network}
          permissionMode={props.settings.permission}
          showPermissionItems
          onAttach={() => upload.current?.click()}
          onPlan={() => props.onMode(props.mode === 'plan' ? 'execute' : 'plan')}
          onGoal={props.onGoal}
          onNetworkChange={(network) => change({ network })}
          onPermissionChange={(value) => change({ permission: value })}
          onFile={(file) =>
            props.onAttachments(
              props.attachments.some((item) => item.path === file.path)
                ? props.attachments.filter((item) => item.path !== file.path)
                : [...props.attachments, file],
            )
          }
        />
        <input
          ref={upload}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (
              file.size > 5 * 1024 * 1024 ||
              props.attachments.length >= 8 ||
              !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
            ) {
              props.onNotice('请选择 5 MB 以内的 PNG、JPEG 或 WebP，最多 8 个附件。');
              return;
            }
            const previewUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(file);
            }).catch(() => '');
            if (!previewUrl) {
              props.onNotice('图片读取失败，请重新选择。');
              return;
            }
            props.onAttachments([
              ...props.attachments,
              {
                path: `image:${crypto.randomUUID()}`,
                name: file.name,
                kind: 'image',
                previewUrl,
                mimeType: file.type,
                sizeBytes: file.size,
              },
            ]);
            props.onNotice('图片仅保留在本页内存，不会上传。');
          }}
        />
        <div
          ref={toolbar.permissionRef}
          className="shell-compose__tool-wrap"
          hidden={toolbar.collapseLevel > 0}
        >
          <button
            ref={permissionRef}
            className="shell-compose__tool"
            data-active="1"
            title="权限模式"
            aria-label="权限模式"
            aria-expanded={menu === 'permission'}
            onClick={() => toggle('permission')}
          >
            <PermissionIcon size={15} />
            <span className="shell-compose__tool-label">{permission.title}</span>
          </button>
        </div>
        <button
          ref={skillRef}
          className="shell-compose__tool"
          title="本轮 Skill"
          aria-label="本轮 Skill"
          aria-expanded={menu === 'skill'}
          data-active={props.settings.skills.length ? '1' : '0'}
          onClick={() => toggle('skill')}
        >
          <Puzzle size={15} />
        </button>
      </div>
      <div className="shell-compose__bar-right" ref={toolbar.rightRef}>
        <button
          ref={identityRef}
          className="shell-compose__tool"
          title={`对话对象：${props.settings.identity.name}`}
          aria-label="对话对象"
          aria-expanded={menu === 'identity'}
          onClick={() => toggle('identity')}
        >
          <MessageSquare size={15} />
        </button>
        <ContextRing
          used={18400}
          limit={models.find((item) => item.modelId === props.model)?.contextWindow ?? 128000}
          compactThreshold={0.7}
          sessionTokens={32400}
          title="查看示例上下文"
        />
        <ModelPickerMenu
          open={menu === 'model'}
          kernels={demoKernels}
          selectedKernelId={props.settings.kernel}
          onPickKernel={(kernel) => {
            change({ kernel });
            setMenu(null);
          }}
          models={models}
          selectedModelId={props.model}
          defaultLabel="SYNC-THINK"
          reasoningEffort={props.settings.reasoning}
          anchorEl={modelRef.current}
          onClose={() => setMenu(null)}
          onPick={(value) => {
            props.onModel(value);
            setMenu(null);
          }}
          onReasoningChange={(reasoning) => change({ reasoning })}
          trigger={
            <ModelTrigger
              buttonRef={modelRef}
              label={
                props.settings.kernel === 'native'
                  ? props.model
                  : resolveKernelDisplayName(props.settings.kernel)
              }
              reasoningLabel={REASONING_LABELS[props.settings.reasoning]}
              mode={props.mode}
              open={menu === 'model'}
              onClick={() => toggle('model')}
            />
          }
        />
        <button
          className="shell-compose__send"
          data-testid="demo-send"
          aria-label={props.generating ? '停止生成' : props.busy ? '加入待处理队列' : '发送'}
          disabled={!props.generating && !props.input.trim()}
          onClick={props.generating ? props.onStop : props.onSend}
        >
          {props.generating ? <Square size={14} /> : <ArrowUp size={17} />}
        </button>
      </div>
      <PermissionMenu
        open={menu === 'permission'}
        value={props.settings.permission}
        anchorEl={permissionRef.current}
        onClose={() => setMenu(null)}
        onChange={(value) => change({ permission: value })}
      />
      <SkillPickerMenu
        open={menu === 'skill'}
        options={demoSkills}
        selectedSkillVersionIds={props.settings.skills}
        anchorEl={skillRef.current}
        onClose={() => setMenu(null)}
        onClear={() => change({ skills: [] })}
        onToggle={(id) =>
          change({
            skills: props.settings.skills.includes(id)
              ? props.settings.skills.filter((item) => item !== id)
              : [...props.settings.skills, id],
          })
        }
      />
      <IdentityPickerMenu
        open={menu === 'identity'}
        agents={
          props.roster?.agents ?? [
            { id: 'demo-agent', name: '界面检查助手', description: '示例智能体' },
          ]
        }
        teams={
          props.roster?.teams ?? [
            { id: 'demo-team', name: '产品协作小队', description: '示例小队' },
          ]
        }
        currentTrack={props.settings.identity.track}
        currentTargetRef={props.settings.identity.targetRef}
        anchorEl={identityRef.current}
        onClose={() => setMenu(null)}
        onPick={(identity) => change({ identity })}
      />
    </div>
  );
}
