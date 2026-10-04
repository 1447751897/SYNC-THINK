/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot, type Conversation, type GlobalAgent } from '@sync-think/shared';
const state = vi.hoisted(() => ({ snapshot: undefined as CollaborationSnapshot | undefined, command: vi.fn() }));
vi.mock('./use-collaboration-chat.js', () => ({ useCollaborationChat: () => ({ snapshot: state.snapshot, error: '', command: state.command }) }));
vi.mock('./image-compress.js', () => ({ compressImageDataUrl: async (dataUrl: string) => ({ dataUrl, mimeType: 'image/png' }) }));
import { CollaborationChatView } from './CollaborationChatView.js';
const conversation = { id: 'room-1', workspaceId: 'workspace-1', track: 'team', title: '视频小队', executionMode: 'full-access' } as Conversation;
const agent = { id: 'director', name: '视觉导演', enabled: true } as GlobalAgent;
beforeEach(() => {
  sessionStorage.clear();
  state.command.mockReset().mockResolvedValue({});
  state.snapshot = { conversation: { id: 'room-1', workspaceId: 'workspace-1', kind: 'group', title: '视频小队', coordinatorMemberId: 'agent:director', policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY }, createdAt: '2026-10-04' }, members: [
    { id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true },
    { id: 'agent:director', kind: 'agent', agentId: 'director', name: '视觉导演', avatar: '', role: '导演', active: true },
  ], messages: [], deliveries: [], tasks: [], attempts: [], revision: 0, receipts: {} } as CollaborationSnapshot;
  window.syncThink = { runtime: { pathForFile: (file: File) => 'C:/selected/' + file.name } } as typeof window.syncThink;
});
afterEach(cleanup);
function view() { return render(<CollaborationChatView projectFolder="D:/video" workspace conversation={conversation} agents={[agent]} onOpenConversation={vi.fn()} />); }
describe('group composer attachments', () => {
  it('accepts audio-only messages, shows an audio tile, and sends file metadata', async () => {
    const rendered = view();
    fireEvent.change(screen.getByLabelText('选择群聊附件'), { target: { files: [new File(['audio'], '楚汤.mp3', { type: 'audio/mpeg' })] } });
    expect(await screen.findByText('楚汤.mp3')).toBeTruthy();
    expect(rendered.container.querySelector('[data-kind="audio"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'send', text: '', files: [{ path: 'C:/selected/楚汤.mp3', name: '楚汤.mp3', kind: 'file', mimeType: 'audio/mpeg', sizeBytes: 5 }] })));
  });
  it('prepares and sends pasted images as actual multimodal attachments', async () => {
    view();
    const png = new File(['png'], 'cover.png', { type: 'image/png' });
    fireEvent.paste(screen.getByTestId('collaboration-draft'), { clipboardData: { files: [png] } });
    await waitFor(() => expect(screen.getByAltText('cover.png')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ images: [expect.objectContaining({ name: 'cover.png', mimeType: 'image/png', dataUrl: expect.stringContaining('data:image/png;base64,') })] })));
  });
  it('supports drag-and-drop, retains files on send failure, and reuses the request ID', async () => {
    const rendered = view();
    state.command.mockRejectedValueOnce(new Error('transport')).mockResolvedValueOnce({});
    fireEvent.drop(rendered.container.querySelector('.collab-composer')!, { dataTransfer: { files: [new File(['sound'], 'sound.wav', { type: 'audio/wav' })], types: ['Files'] } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledTimes(2));
    expect(state.command.mock.calls[0][0].clientRequestId).toBe(state.command.mock.calls[1][0].clientRequestId);
  });
  it('keeps the member @ picker alongside attachments', async () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: '成员' }));
    expect(await screen.findByRole('listbox', { name: '选择接收成员' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /视觉导演/ }));
    expect(screen.getByRole('button', { name: '添加附件' })).toBeTruthy();
  });
});


describe('stored group media', () => {
  it('loads durable image previews from the bound workspace after reopening', async () => {
    const stagingPath = 'D:/video/.sync-think/conversations/room-1/images/cover.png';
    const readProjectImage = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,aGVsbG8=' });
    window.syncThink!.runtime.readProjectImage = readProjectImage;
    state.snapshot!.messages = [{ id: 'media-1', conversationId: 'room-1', senderMemberId: 'user:local', recipientMemberIds: [], mentions: [], kind: 'chat', blocks: [{ type: 'image', payload: { name: 'cover.png', mimeType: 'image/png', stagingPath } }], expectsResponse: false, correlationId: 'test', hopCount: 0, sequence: 1, createdAt: '2026-10-04' }];
    view();
    const preview = await screen.findByAltText('cover.png') as HTMLImageElement;
    expect(preview.src).toBe('data:image/png;base64,aGVsbG8=');
    expect(readProjectImage).toHaveBeenCalledWith({ root: 'D:/video', path: stagingPath });
  });
  it('clears an attachment-only draft already acknowledged by the durable receipt', async () => {
    const file = { path: 'C:/selected/song.mp3', name: 'song.mp3', kind: 'file', sizeBytes: 5 };
    sessionStorage.setItem('sync-think.collaboration-draft.v1:room-1', JSON.stringify({ text: '', recipients: [], attachments: [file], receipt: { id: 'received', key: JSON.stringify(['', [], undefined, [[file.path, file.name, file.sizeBytes]]]) } }));
    state.snapshot!.receipts['send:received'] = 'durable receipt';
    view();
    await waitFor(() => expect(screen.queryByText('song.mp3')).toBeNull());
    expect(state.command).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
