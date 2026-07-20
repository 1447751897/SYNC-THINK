import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  Compose,
  type ComposeAgentOption,
  type ComposeGroupOption,
  type ComposeModelOption,
  type ComposeWorkspaceOption,
  projectComposeSendReadiness,
} from '../src/components/Compose.js';

function getFormWithin(textarea: HTMLTextAreaElement): HTMLFormElement {
  return textarea.closest('form') as HTMLFormElement;
}

const sampleModels: ComposeModelOption[] = [
  {
    modelId: 'mdl-a',
    label: 'OpenAI · gpt-4o-mini',
    providerName: 'OpenAI',
    providerModelId: 'gpt-4o-mini',
  },
  {
    modelId: 'mdl-b',
    label: 'DeepSeek · deepseek-chat',
    providerName: 'DeepSeek',
    providerModelId: 'deepseek-chat',
  },
  {
    modelId: 'mdl-c',
    label: 'OpenAI · gpt-4o',
    providerName: 'OpenAI',
    providerModelId: 'gpt-4o',
  },
];

describe('Compose', () => {
  it('picks, previews, removes, and sends managed attachments', async () => {
    const onSend = vi.fn();
    const onPickAttachments = vi.fn().mockResolvedValue([
      {
        id: 'attachment-1',
        kind: 'image',
        name: 'screen.png',
        mimeType: 'image/png',
        size: 4,
        managedRef: 'C:/managed/screen.png',
        readOnly: true,
        previewUrl: 'data:image/png;base64,AQIDBA==',
      },
    ]);
    render(<Compose mode="conversation" onSend={onSend} onPickAttachments={onPickAttachments} />);
    fireEvent.click(screen.getByLabelText('添加附件'));
    fireEvent.click(screen.getByText('图片或文件'));
    expect(await screen.findByText('screen.png')).toBeTruthy();
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '检查截图' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).toHaveBeenCalledWith(
      '检查截图',
      expect.objectContaining({
        attachments: [expect.objectContaining({ id: 'attachment-1', kind: 'image' })],
      }),
    );
    expect(screen.queryByText('screen.png')).toBeNull();
  });

  it('imports pasted files and blocks images on a non-vision model', async () => {
    const onImportFiles = vi.fn().mockResolvedValue([
      {
        id: 'attachment-2',
        kind: 'image',
        name: 'paste.png',
        mimeType: 'image/png',
        size: 3,
        managedRef: 'C:/managed/paste.png',
        readOnly: true,
      },
    ]);
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={[{ modelId: 'text-only', label: 'Text only', supportsVision: false }]}
        selectedModelId="text-only"
        onImportFiles={onImportFiles}
      />,
    );
    const textarea = screen.getByLabelText('消息输入');
    const file = new File(['png'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });
    expect(await screen.findByText('paste.png')).toBeTruthy();
    expect(screen.getByText('当前模型未确认支持图片，请切换到视觉模型')).toBeTruthy();
    expect(screen.getByLabelText('发送').getAttribute('disabled')).not.toBeNull();
  });

  it('shows a drop target and imports files from a DOMStringList-compatible drag event', async () => {
    const onImportFiles = vi.fn().mockResolvedValue([
      {
        id: 'attachment-drop',
        kind: 'image',
        name: 'dropped.png',
        mimeType: 'image/png',
        size: 4,
        managedRef: 'C:/managed/dropped.png',
        readOnly: true,
        previewUrl: 'data:image/png;base64,AQIDBA==',
      },
    ]);
    render(
      <Compose mode="conversation" onSend={() => undefined} onImportFiles={onImportFiles} />,
    );
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    const form = getFormWithin(textarea);
    const file = new File(['drop'], 'dropped.png', { type: 'image/png' });
    const types = { 0: 'Files', length: 1 } as unknown as readonly string[];

    fireEvent.dragEnter(form, { dataTransfer: { files: [file], types } });
    expect(form.getAttribute('data-drag-active')).toBe('1');
    expect(screen.getByText('松开以添加到当前对话')).toBeTruthy();

    fireEvent.dragOver(form, { dataTransfer: { files: [file], types } });
    fireEvent.drop(form, { dataTransfer: { files: [file], types } });

    expect(await screen.findByText('dropped.png')).toBeTruthy();
    expect(onImportFiles).toHaveBeenCalledWith([file]);
    expect(form.getAttribute('data-drag-active')).toBe('0');
  });
  it('fires onSend with trimmed-at-submit text and clears input', () => {
    const onSend = vi.fn();
    render(<Compose mode="conversation" onSend={onSend} />);
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  hello runtime  ' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).toHaveBeenCalledWith('  hello runtime  ', expect.objectContaining({}));
    expect(textarea.value).toBe('');
  });

  it('does not send when input is whitespace', () => {
    const onSend = vi.fn();
    render(<Compose mode="conversation" onSend={onSend} />);
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the submitted draft when an async send reports failure', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<Compose mode="conversation" onSend={onSend} />);
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'keep this draft' } });
    fireEvent.submit(getFormWithin(textarea));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(textarea.value).toBe('keep this draft');
  });

  it('clears the submitted draft when an async send succeeds', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<Compose mode="conversation" onSend={onSend} />);
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'sent draft' } });
    fireEvent.submit(getFormWithin(textarea));
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('disables send when disabled prop is set', () => {
    const onSend = vi.fn();
    render(<Compose mode="conversation" onSend={onSend} disabled />);
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows cancel while streaming and fires onCancel', () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(<Compose mode="conversation" onSend={onSend} streaming onCancel={onCancel} />);
    const cancel = screen.getByLabelText('停止生成');
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('hides cancel when not streaming', () => {
    render(<Compose mode="conversation" onSend={() => undefined} />);
    expect(screen.queryByLabelText('取消流式输出')).toBeNull();
  });

  it('renders model selector when models are provided', () => {
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        selectedModelId="mdl-a"
      />,
    );
    const picker = screen.getByTestId('compose-model-path');
    expect(picker).toBeTruthy();
    expect(picker.getAttribute('data-has-value')).toBe('1');
    expect(screen.getByTestId('compose-model-path-trigger').textContent).toMatch(
      /OpenAI|gpt-4o-mini/,
    );
    fireEvent.click(screen.getByTestId('compose-model-path-trigger'));
    expect(screen.getByTestId('compose-model-path-panel')).toBeTruthy();
  });

  it('includes auto default option and can clear selection', () => {
    const onModelChange = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        selectedModelId="mdl-b"
        onModelChange={onModelChange}
      />,
    );
    fireEvent.click(screen.getByTestId('compose-model-path-trigger'));
    fireEvent.click(screen.getByTestId('compose-model-path-default'));
    expect(onModelChange).toHaveBeenCalledWith(null);
  });

  it('sends selected modelId with the message', () => {
    const onSend = vi.fn();
    render(
      <Compose mode="conversation" onSend={onSend} models={sampleModels} selectedModelId="mdl-c" />,
    );
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'switch model' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).toHaveBeenCalledWith(
      'switch model',
      expect.objectContaining({ modelId: 'mdl-c' }),
    );
  });

  it('sends without modelId when using agent default', () => {
    const onSend = vi.fn();
    render(
      <Compose mode="conversation" onSend={onSend} models={sampleModels} selectedModelId={null} />,
    );
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'use default' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).toHaveBeenCalledWith(
      'use default',
      expect.objectContaining({ modelId: undefined }),
    );
  });

  it('notifies onModelChange when user picks another model', () => {
    const onModelChange = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        selectedModelId="mdl-a"
        onModelChange={onModelChange}
      />,
    );
    fireEvent.click(screen.getByTestId('compose-model-path-trigger'));
    // DeepSeek is a different group under the same/other surface — switch groups then pick.
    const groups = screen.getAllByTestId(/compose-model-path-group-/);
    for (const g of groups) {
      fireEvent.click(g);
      const opt = screen.queryByTestId('compose-model-path-model-mdl-b');
      if (opt) {
        fireEvent.click(opt);
        break;
      }
    }
    expect(onModelChange).toHaveBeenCalledWith('mdl-b');
  });

  it('shows empty-registry hint when no models registered', () => {
    render(<Compose mode="conversation" onSend={() => undefined} models={[]} />);
    expect(screen.getByTestId('compose-model-empty')).toBeTruthy();
    expect(screen.getByTestId('compose-model-empty').textContent).toBe('暂无模型');
  });

  it('keeps the selected model in the compact trigger without a second summary row', () => {
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        selectedModelId="mdl-b"
      />,
    );
    expect(screen.getByTestId('compose-model-path-trigger').textContent).toMatch(/DeepSeek/);
    expect(screen.queryByTestId('compose-model-summary')).toBeNull();
  });

  it('sends on Ctrl+Enter and clears the textarea', () => {
    const onSend = vi.fn();
    render(<Compose mode="conversation" onSend={onSend} />);
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'via shortcut' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('via shortcut', expect.objectContaining({}));
    expect(textarea.value).toBe('');
  });

  it('cancels stream on Escape when streaming', () => {
    const onCancel = vi.fn();
    render(<Compose mode="conversation" onSend={() => undefined} streaming onCancel={onCancel} />);
    const textarea = screen.getByLabelText('消息输入');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows Chinese default placeholder and send label', () => {
    render(<Compose mode="conversation" onSend={() => undefined} />);
    const ta = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    expect(ta.placeholder).toMatch(/输入指令|继续当前任务/);
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
  });

  it('moves the keyboard shortcut into the send tooltip', () => {
    render(<Compose mode="conversation" onSend={() => undefined} />);
    expect(screen.queryByTestId('compose-shortcut-hint')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' }).getAttribute('title')).toMatch(/Enter/);
  });

  it('uses hierarchical model path picker instead of flat chips', () => {
    const onModelChange = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        selectedModelId={null}
        onModelChange={onModelChange}
        agentFallbackCount={2}
        multiProvider
      />,
    );
    // Flat chips intentionally hidden — CC Switch hierarchy is the primary path.
    expect(screen.queryByTestId('compose-model-chips')).toBeNull();
    fireEvent.click(screen.getByTestId('compose-model-path-trigger'));
    expect(screen.getByTestId('compose-model-path-panel')).toBeTruthy();
    // Guide copy explains the flow
    expect(screen.getByTestId('compose-model-path-panel').textContent).toMatch(/应用|分组|模型/);
    // Pick DeepSeek via groups
    for (const g of screen.getAllByTestId(/compose-model-path-group-/)) {
      fireEvent.click(g);
      const opt = screen.queryByTestId('compose-model-path-model-mdl-b');
      if (opt) {
        fireEvent.click(opt);
        break;
      }
    }
    expect(onModelChange).toHaveBeenCalledWith('mdl-b');
    expect(screen.queryByTestId('compose-model-summary')).toBeNull();
  });

  it('keeps chips hidden when only one model', () => {
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={[sampleModels[0]!]}
        selectedModelId="mdl-a"
      />,
    );
    expect(screen.queryByTestId('compose-model-chips')).toBeNull();
  });

  it('shows only the primary blocker when sending is unavailable', () => {
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={[]}
        connectionState="offline"
        hasActiveTask={false}
        agentDefaultSet={false}
        disabled
      />,
    );
    expect(screen.queryByTestId('compose-send-readiness')).toBeNull();
    expect(screen.getByTestId('compose-blocker').textContent).toMatch(/本地服务未连接/);
  });

  it('blocks submit when a compact blocker is active even without disabled prop', () => {
    const onSend = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={onSend}
        models={[]}
        connectionState="online"
        hasActiveTask
        agentDefaultSet={false}
      />,
    );
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'must not send' } });
    fireEvent.submit(getFormWithin(textarea));
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays quiet when all send gates are ready', () => {
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        selectedModelId="mdl-a"
        connectionState="online"
        hasActiveTask
        agentDefaultSet
        multiProvider
        agentFallbackCount={1}
      />,
    );
    expect(screen.queryByTestId('compose-send-readiness')).toBeNull();
    expect(screen.queryByTestId('compose-blocker')).toBeNull();
  });

  it('replaces send with a compact stop control while streaming', () => {
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        streaming
        onCancel={() => undefined}
        connectionState="online"
        hasActiveTask
      />,
    );
    expect(screen.queryByTestId('compose-send-readiness')).toBeNull();
    expect(screen.getByRole('button', { name: '停止生成' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  });

  it('offers the relevant action from a compact blocker', () => {
    const onReconnect = vi.fn();
    const { rerender } = render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        connectionState="offline"
        hasActiveTask
        agentDefaultSet
        disabled
        onReconnect={onReconnect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重新连接本地服务' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);

    const onConfigureModel = vi.fn();
    rerender(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={[]}
        connectionState="online"
        hasActiveTask
        agentDefaultSet={false}
        disabled
        onConfigureModel={onConfigureModel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '配置模型' }));
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
  });

  it('switches teammates from the Compose agent picker', () => {
    const onAgentChange = vi.fn();
    const onOpenAgentCenter = vi.fn();
    const agents: ComposeAgentOption[] = [
      { agentId: 'a1', name: '规划', role: 'planner', color: '#29b982' },
      { agentId: 'a2', name: '执行', role: 'executor', color: '#438fd0' },
    ];
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        agents={agents}
        selectedAgentId="a1"
        onAgentChange={onAgentChange}
        onOpenAgentCenter={onOpenAgentCenter}
        hasActiveTask
        agentDefaultSet
        connectionState="online"
      />,
    );

    expect(screen.getByTestId('compose-agent-trigger').textContent).toMatch(/@规划/);
    fireEvent.click(screen.getByTestId('compose-agent-trigger'));
    fireEvent.click(screen.getByTestId('compose-agent-option-a2'));
    expect(onAgentChange).toHaveBeenCalledWith('a2');

    fireEvent.click(screen.getByTestId('compose-agent-trigger'));
    fireEvent.click(screen.getByTestId('compose-agent-manage'));
    expect(onOpenAgentCenter).toHaveBeenCalledTimes(1);
  });

  it('lists Agents and teams separately and selects a configured team', () => {
    const onGroupChange = vi.fn();
    const groups: ComposeGroupOption[] = [
      {
        groupId: 'group-1',
        name: '发布小队',
        leadName: '规划官',
        memberCount: 4,
        color: '#0d9488',
      },
    ];
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        agents={[{ agentId: 'a1', name: '规划官', role: 'planner' }]}
        groups={groups}
        selectedAgentId="a1"
        onAgentChange={() => undefined}
        onGroupChange={onGroupChange}
      />,
    );

    fireEvent.click(screen.getByTestId('compose-agent-trigger'));
    expect(screen.getByText('智能体')).toBeTruthy();
    expect(screen.getByText('小队')).toBeTruthy();
    expect(screen.getByTestId('compose-group-option-group-1').textContent).toMatch(
      /发布小队.*规划官.*4/,
    );
    fireEvent.click(screen.getByTestId('compose-group-option-group-1'));
    expect(onGroupChange).toHaveBeenCalledWith('group-1');
  });

  it('offers @ mention picks while typing', () => {
    const onAgentChange = vi.fn();
    const agents: ComposeAgentOption[] = [
      { agentId: 'a1', name: '规划', role: 'planner' },
      { agentId: 'a2', name: '审查', role: 'reviewer' },
    ];
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        agents={agents}
        selectedAgentId="a1"
        onAgentChange={onAgentChange}
        hasActiveTask
        agentDefaultSet
        connectionState="online"
      />,
    );
    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: '@审',
        selectionStart: 2,
        selectionEnd: 2,
      },
    });

    expect(screen.getByTestId('compose-mention-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('compose-mention-a2'));
    expect(onAgentChange).toHaveBeenCalledWith('a2');
    expect(textarea.value).toMatch(/@审查/);
  });

  it('routes a group-chat @ mention to the exact member without switching the participant', () => {
    const onSend = vi.fn();
    const onAgentChange = vi.fn();
    render(
      <Compose
        mode="collaboration"
        onSend={onSend}
        agents={[{ agentId: 'lead', name: '主智能体' }]}
        mentionAgents={[
          { agentId: 'lead', agentVersionId: 'lead-v3', name: '主智能体' },
          { agentId: 'designer', agentVersionId: 'designer-v2', name: '设计分析官' },
        ]}
        selectedAgentId="lead"
        onAgentChange={onAgentChange}
      />,
    );

    const textarea = screen.getByLabelText('消息输入') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '@设计', selectionStart: 3, selectionEnd: 3 },
    });
    fireEvent.click(screen.getByTestId('compose-mention-designer'));
    expect(onAgentChange).not.toHaveBeenCalled();
    fireEvent.change(textarea, { target: { value: `${textarea.value}请检查这个方案` } });
    fireEvent.submit(getFormWithin(textarea));

    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining('@设计分析官'),
      expect.objectContaining({ agentVersionId: 'designer-v2' }),
    );
  });

  it('switches the active project from the Compose toolbar', () => {
    const onWorkspaceChange = vi.fn();
    const workspaces: ComposeWorkspaceOption[] = [
      {
        workspaceId: 'ws-1',
        name: 'SYNC-THINK',
        folderPath: 'D:\\projects\\SYNC-THINK',
      },
      { workspaceId: 'ws-2', name: 'Notes' },
    ];
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        models={sampleModels}
        workspaces={workspaces}
        selectedWorkspaceId="ws-1"
        onWorkspaceChange={onWorkspaceChange}
        hasActiveTask
        agentDefaultSet
        connectionState="online"
      />,
    );

    expect(screen.getByTestId('compose-workspace-trigger').textContent).toContain('SYNC-THINK');
    fireEvent.click(screen.getByTestId('compose-workspace-trigger'));
    expect(screen.getByRole('tooltip').textContent).toBe('D:\\projects\\SYNC-THINK');
    fireEvent.click(screen.getByTestId('compose-workspace-option-ws-2'));
    expect(onWorkspaceChange).toHaveBeenCalledWith('ws-2');
  });

  it('offers blank-project and folder-project creation from the project menu', () => {
    const onCreateWorkspace = vi.fn();
    const onCreateWorkspaceFromFolder = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        workspaces={[{ workspaceId: 'ws-1', name: 'SYNC-THINK' }]}
        selectedWorkspaceId="ws-1"
        onWorkspaceChange={() => undefined}
        onCreateWorkspace={onCreateWorkspace}
        onCreateWorkspaceFromFolder={onCreateWorkspaceFromFolder}
      />,
    );

    fireEvent.click(screen.getByTestId('compose-workspace-trigger'));
    fireEvent.click(screen.getByTestId('compose-workspace-create-blank'));
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('compose-workspace-trigger'));
    fireEvent.click(screen.getByTestId('compose-workspace-create-folder'));
    expect(onCreateWorkspaceFromFolder).toHaveBeenCalledTimes(1);
  });

  it('changes operation permission for the current conversation', () => {
    const onPermissionModeChange = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        permissionMode="full"
        onPermissionModeChange={onPermissionModeChange}
        permissionDetails={{
          approvalMode: 'full',
          executionMode: 'managed_worktree',
          executionState: 'ready',
          baseRef: 'main',
          browserIdentityName: '工作账号',
          effectiveToolNames: ['read_file', 'run_command'],
          capabilityCeiling: {
            file: ['*'],
            command: ['*'],
            browser: ['*'],
            desktop: [],
            network: [],
          },
        }}
      />,
    );

    const select = screen.getByLabelText('当前对话操作权限') as HTMLSelectElement;
    expect(select.value).toBe('full');
    fireEvent.change(select, { target: { value: 'request' } });
    expect(onPermissionModeChange).toHaveBeenCalledWith('request');
    fireEvent.click(screen.getByLabelText('查看当前任务有效权限'));
    expect(screen.getByRole('dialog', { name: '当前任务有效权限' })).toBeTruthy();
    expect(screen.getByText('隔离工作树')).toBeTruthy();
    expect(screen.getByText('工作账号')).toBeTruthy();
    expect(screen.getByText('run_command')).toBeTruthy();
  });

  it('changes the browser identity pinned to the current task', () => {
    const onBrowserIdentityChange = vi.fn();
    render(
      <Compose
        mode="conversation"
        onSend={() => undefined}
        browserIdentities={[
          { id: 'browser-default', name: '默认身份', isDefault: true },
          { id: 'browser-work', name: '工作账号' },
        ]}
        selectedBrowserIdentityId="browser-default"
        onBrowserIdentityChange={onBrowserIdentityChange}
      />,
    );
    const select = screen.getByLabelText('当前任务浏览器身份') as HTMLSelectElement;
    expect(select.value).toBe('browser-default');
    fireEvent.change(select, { target: { value: 'browser-work' } });
    expect(onBrowserIdentityChange).toHaveBeenCalledWith('browser-work');
  });
});

describe('projectComposeSendReadiness', () => {
  it('projects empty when no models and no text', () => {
    const r = projectComposeSendReadiness({
      text: '',
      modelsProvided: true,
      hasModels: false,
      modelCount: 0,
      connectionState: 'unknown',
    });
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('等待配置');
    expect(r.modelsOk).toBe(false);
  });

  it('projects ready when text + models + online + task', () => {
    const r = projectComposeSendReadiness({
      text: 'hello',
      modelsProvided: true,
      hasModels: true,
      modelCount: 2,
      connectionState: 'online',
      hasActiveTask: true,
      agentDefaultSet: true,
      multiProvider: true,
      selectedModelId: 'm1',
    });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('可发送');
    expect(r.sourceTag).toBe('本轮覆盖');
    expect(r.note).toMatch(/轨迹|Manifest/);
  });

  it('projects streaming and blocked', () => {
    const streaming = projectComposeSendReadiness({
      text: 'x',
      streaming: true,
      modelsProvided: true,
      hasModels: true,
      connectionState: 'online',
      hasActiveTask: true,
    });
    expect(streaming.level).toBe('streaming');
    expect(streaming.badge).toBe('流式中');

    const blocked = projectComposeSendReadiness({
      text: 'x',
      disabled: true,
      modelsProvided: true,
      hasModels: true,
      connectionState: 'offline',
      hasActiveTask: false,
    });
    expect(blocked.level).toBe('blocked');
    expect(blocked.badge).toBe('暂不可发送');
    expect(blocked.note).toMatch(/先打开任务|未连接|等待/);
  });

  it('projects partial when ready gates pass but text empty', () => {
    const r = projectComposeSendReadiness({
      text: '   ',
      modelsProvided: true,
      hasModels: true,
      modelCount: 1,
      connectionState: 'online',
      hasActiveTask: true,
    });
    expect(r.level).toBe('partial');
    expect(r.badge).toBe('准备中');
    expect(r.sourceTag).toBe('Agent 默认');
  });
});
