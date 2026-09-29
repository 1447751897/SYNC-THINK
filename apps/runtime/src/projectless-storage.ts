import { mkdirSync, statSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConversationRecord } from '@sync-think/storage';
import type { Message } from '@sync-think/shared';
export const PROJECTLESS_DIRECTORY_KEY = 'data.projectless.directory';
export const projectlessLocationKey = (id: string) => 'data.projectless.conversation.' + id;
interface Settings {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown): unknown;
}
/** Database stays authoritative; each unbound conversation owns durable local files and message copies. */
export class ProjectlessStorage {
  constructor(
    private readonly defaultDirectory: string,
    private readonly settings?: Settings,
  ) {}
  get directory(): string {
    const saved = this.settings?.get(PROJECTLESS_DIRECTORY_KEY)?.value;
    return typeof saved === 'string' && isAbsolute(saved)
      ? resolve(saved)
      : resolve(this.defaultDirectory);
  }
  validateDirectory(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim()))
      throw new Error('请选择有效的绝对目录路径');
    const directory = resolve(value.trim());
    mkdirSync(directory, { recursive: true });
    if (!statSync(directory).isDirectory()) throw new Error('所选位置不是目录');
    const probe = join(directory, '.sync-think-write-' + randomUUID());
    writeFileSync(probe, '', { flag: 'wx' });
    unlinkSync(probe);
    return directory;
  }
  ensure(conversation: ConversationRecord): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(conversation.id))
      throw new Error('Invalid conversation directory identity');
    const key = projectlessLocationKey(conversation.id);
    const saved = this.settings?.get(key)?.value;
    const directory =
      typeof saved === 'string' && isAbsolute(saved)
        ? saved
        : join(this.directory, 'conversations', conversation.id);
    const files = join(directory, 'files');
    mkdirSync(files, { recursive: true });
    mkdirSync(join(directory, 'messages'), { recursive: true });
    if (saved !== directory) this.settings?.set(key, directory);
    this.writeJson(join(directory, 'conversation.json'), {
      id: conversation.id,
      title: conversation.title,
      track: conversation.track,
      targetRef: conversation.targetRef,
      createdAt: conversation.createdAt,
      workspaceId: null,
    });
    return files;
  }
  saveMessage(conversation: ConversationRecord, message: Message): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(message.id)) return;
    const files = this.ensure(conversation);
    // Deliberately omit credential references and internal transport metadata.
    this.writeJson(join(files, '..', 'messages', message.id + '.json'), {
      id: message.id,
      role: message.role,
      sequence: message.sequence,
      blocks: message.blocks,
      createdAt: message.createdAt,
      modelId: message.modelId,
    });
  }
  private writeJson(file: string, value: unknown): void {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2));
      renameSync(temporary, file);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* renamed, or write failed */
      }
    }
  }
}
