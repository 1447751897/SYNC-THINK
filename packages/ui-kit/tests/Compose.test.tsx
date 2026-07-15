import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Compose, type ComposeModelOption, projectComposeSendReadiness } from '../src/components/Compose.js';

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
    render(
      <Compose mode="conversation" onSend={onSend} streaming onCancel={onCancel} />,
    );
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
    expect(screen.getByTestId('compose-model-path-trigger').textContent).toMatch(/OpenAI|gpt-4o-mini/);
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
      <Compose
        mode="conversation"
        onSend={onSend}
        models={sampleModels}
        selectedModelId="mdl-c"
      />,
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
      <Compose
        mode="conversation"
        onSend={onSend}
        models={sampleModels}
        selectedModelId={null}
      />,
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
    render(
      <Compose mode="conversation" onSend={() => undefined} models={[]} />,
    );
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
    render(
      <Compose mode="conversation" onSend={() => undefined} streaming onCancel={onCancel} />,
    );
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
    expect(screen.getByTestId('compose-blocker').textContent).toMatch(/Runtime 未连接/);
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
    fireEvent.click(screen.getByRole('button', { name: '重新连接 Runtime' }));
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
