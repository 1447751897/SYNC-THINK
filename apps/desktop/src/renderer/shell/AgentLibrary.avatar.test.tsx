/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GlobalAgent } from '@sync-think/shared';
import { AgentLibrary } from './AgentLibrary.js';
import { DialogProvider } from './Dialog.js';
import { invalidateMcpCatalog } from './mcp-catalog-loader.js';
import { invalidateSkillCatalog } from './skill-catalog-loader.js';
import { parseBotAvatarSeed } from './bot-avatar.js';

vi.mock('./compose-toolbar.js', () => ({ ModelPickerMenu: () => null }));

function agent(id: string, avatar: string, extra: Partial<GlobalAgent> = {}): GlobalAgent {
  return {
    id,
    name: id,
    avatar,
    description: '说明',
    persona: '人设',
    defaultModelId: 'model-a',
    fallbackModelIds: [],
    skillIds: [],
    mcpServerIds: [],
    reasoningEffort: 'high',
    archived: false,
    availabilityScope: 'workspace',
    writePolicy: 'read-only',
    createdAt: '2026-09-24T00:00:00Z',
    updatedAt: '2026-09-24T00:00:00Z',
    ...extra,
  } as GlobalAgent;
}
const runtime = {
  updateGlobalAgent: vi.fn(),
  createGlobalAgent: vi.fn(),
  listSkills: vi.fn(),
  listMcpServers: vi.fn(),
};
function library(agents: GlobalAgent[]) {
  return (
    <DialogProvider>
      <AgentLibrary
        agents={agents}
        models={[{ modelId: 'model-a', displayName: '测试模型', providerName: '测试服务' }]}
        onRefresh={vi.fn()}
      />
    </DialogProvider>
  );
}
function edit(name: string) {
  fireEvent.click(screen.getByText(name).closest('.agent-card') as HTMLElement);
  fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
}

beforeEach(() => {
  invalidateMcpCatalog();
  invalidateSkillCatalog();
  runtime.updateGlobalAgent.mockReset().mockResolvedValue({});
  runtime.createGlobalAgent.mockReset().mockResolvedValue({});
  runtime.listSkills.mockReset().mockResolvedValue({ skills: [] });
  runtime.listMcpServers.mockReset().mockResolvedValue({ servers: [] });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('AgentLibrary bot avatar workflow', () => {
  it('offers 18 shapes, saves a selected shape/colour, and hides serialized seeds from the emoji input', async () => {
    render(library([agent('旧助手', 'gen:v1:hex:green')]));
    edit('旧助手');
    const shapes = screen.getByRole('group', { name: '头像造型' });
    expect(within(shapes).getAllByRole('button')).toHaveLength(18);
    expect(
      within(shapes).getByRole('button', { name: '造型 六角' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(document.querySelector('.agent-emoji-input')).toBeNull();
    fireEvent.click(within(shapes).getByRole('button', { name: '造型 四叶草' }));
    fireEvent.click(screen.getByRole('button', { name: '颜色 默认配色' }));
    expect(
      within(shapes).getByRole('button', { name: '造型 四叶草' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(runtime.updateGlobalAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: '旧助手',
          avatar: 'bot:v1:clover:preset',
          writePolicy: 'read-only',
          availabilityScope: 'workspace',
        }),
      ),
    );
  });

  it('starts new agents with a stable serialized bot avatar before typing their name', async () => {
    render(library([]));
    fireEvent.click(screen.getByRole('button', { name: '新建智能体' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '新建空白智能体' }));
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    const selected = within(screen.getByRole('group', { name: '头像造型' })).getByRole('button', {
      pressed: true,
    });
    const label = selected.getAttribute('aria-label');
    fireEvent.click(screen.getByTestId('agent-drawer-tab-overview'));
    fireEvent.change(screen.getByLabelText('智能体名称'), { target: { value: '新助手' } });
    fireEvent.click(screen.getByTestId('agent-drawer-tab-settings'));
    expect(
      within(screen.getByRole('group', { name: '头像造型' }))
        .getByRole('button', { pressed: true })
        .getAttribute('aria-label'),
    ).toBe(label);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(runtime.createGlobalAgent).toHaveBeenCalledOnce());
    expect(parseBotAvatarSeed(runtime.createGlobalAgent.mock.calls[0][0].avatar)).not.toBeNull();
  });

  it('keeps uploaded images on an ordinary save and supports explicitly restoring a generated avatar', async () => {
    const avatar = 'data:image/png;base64,test';
    render(library([agent('照片助手', avatar)]));
    edit('照片助手');
    expect(screen.getByRole('button', { name: '恢复动态头像' })).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: '头像造型' })).queryByRole('button', {
        pressed: true,
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(runtime.updateGlobalAgent).toHaveBeenCalledWith(expect.objectContaining({ avatar })),
    );
    edit('照片助手');
    fireEvent.click(screen.getByRole('button', { name: '恢复动态头像' }));
    expect(screen.queryByRole('button', { name: '恢复动态头像' })).toBeNull();
    expect(
      within(screen.getByRole('group', { name: '头像造型' })).getByRole('button', {
        pressed: true,
      }),
    ).toBeTruthy();
  });

  it('upgrades only legacy/text avatars after confirmation, preserving images and current choices', async () => {
    const records = [
      agent('旧生成', 'gen:v1:cloud:cyan'),
      agent('文字', '🤖'),
      agent('照片', 'data:image/webp;base64,test'),
      agent('新版', 'bot:v1:cat:violet'),
      agent('归档', 'A', { archived: true }),
    ];
    const view = render(library(records));
    fireEvent.click(screen.getByRole('button', { name: '升级专属头像' }));
    expect(runtime.updateGlobalAgent).not.toHaveBeenCalled();
    expect(await screen.findByText(/将把 2 个智能体/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('app-dialog-confirm'));
    await waitFor(() => expect(runtime.updateGlobalAgent).toHaveBeenCalledTimes(2));
    expect(runtime.updateGlobalAgent.mock.calls.map(([payload]) => payload.agentId)).toEqual([
      '旧生成',
      '文字',
    ]);
    expect(runtime.updateGlobalAgent.mock.calls[0][0]).toMatchObject({
      avatar: 'bot:v1:cloud:cyan',
      writePolicy: 'read-only',
      availabilityScope: 'workspace',
      reasoningEffort: 'high',
    });
    const updated = records.map((record) => {
      const call = runtime.updateGlobalAgent.mock.calls.find(
        ([payload]) => payload.agentId === record.id,
      );
      return call ? { ...record, avatar: call[0].avatar } : record;
    });
    view.rerender(library(updated));
    fireEvent.click(screen.getByRole('button', { name: '升级专属头像' }));
    expect(await screen.findByText('所有智能体都已使用新版头像或已导入图片。')).toBeTruthy();
    expect(runtime.updateGlobalAgent).toHaveBeenCalledTimes(2);
  });

  it('leaves all stored records untouched when the bulk upgrade is cancelled', async () => {
    render(library([agent('文字助手', 'A')]));
    fireEvent.click(screen.getByRole('button', { name: '升级专属头像' }));
    fireEvent.click(await screen.findByTestId('app-dialog-cancel'));
    expect(runtime.updateGlobalAgent).not.toHaveBeenCalled();
  });
});
