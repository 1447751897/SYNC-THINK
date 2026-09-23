import type {
  CollaborationRepository,
  CollaborationSnapshot,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

type Collection = 'members' | 'messages' | 'deliveries' | 'tasks' | 'attempts';
const TABLES: Record<Collection, string> = {
  members: 'collaboration_member',
  messages: 'collaboration_message',
  deliveries: 'collaboration_delivery',
  tasks: 'collaboration_task',
  attempts: 'collaboration_attempt',
};
interface ConversationRow { payload_json: string; revision: number }
interface PayloadRow { payload_json: string }

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
    }
    return entry;
  });
}

function assertSnapshot(snapshot: CollaborationSnapshot): void {
  if (!snapshot.conversation.id.trim() || !snapshot.conversation.workspaceId.trim()) {
    throw new Error('collaboration.invalid_scope');
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new Error('collaboration.invalid_revision');
  }
  for (const collection of Object.keys(TABLES) as Collection[]) {
    const seen = new Set<string>();
    for (const entry of snapshot[collection]) {
      if (!entry.id.trim() || seen.has(entry.id)) throw new Error('collaboration.duplicate_entity');
      seen.add(entry.id);
    }
  }
  for (const message of snapshot.messages) {
    if (message.conversationId !== snapshot.conversation.id) {
      throw new Error('collaboration.message_scope_mismatch');
    }
    if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) {
      throw new Error('collaboration.invalid_sequence');
    }
  }
  for (const attempt of snapshot.attempts) {
    if (!Number.isSafeInteger(attempt.number) || attempt.number < 1) {
      throw new Error('collaboration.invalid_attempt');
    }
  }
  for (const [key, value] of Object.entries(snapshot.receipts)) {
    if (!key.trim() || typeof value !== 'string') throw new Error('collaboration.invalid_receipt');
  }
}

/**
 * Synchronous SQLite boundary for collaboration commands and scheduler claims.
 * Each save advances revision by exactly one; identical same-revision retries
 * are harmless. Holding transaction() around list/read + save makes resource
 * checks across conversations atomic as well. Nested calls use savepoints.
 *
 * v1 reads the whole conversation; normalized message/attempt rows and indexes
 * permit paginated history later without changing durable identity or receipts.
 */
export class SqliteCollaborationStore implements CollaborationRepository {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  transaction<T>(work: () => T): T {
    return this.raw.transaction(work).immediate();
  }

  read(conversationId: string): CollaborationSnapshot | undefined {
    // A deferred read transaction keeps every collection on the same snapshot.
    return this.raw.transaction(() => this.readSnapshot(conversationId))();
  }

  list(workspaceId?: string): CollaborationSnapshot[] {
    return this.raw.transaction(() => {
      const rows = (workspaceId === undefined
        ? this.raw.prepare('SELECT id FROM collaboration_conversation ORDER BY created_at, id').all()
        : this.raw.prepare('SELECT id FROM collaboration_conversation WHERE workspace_id = ? ORDER BY created_at, id').all(workspaceId)
      ) as Array<{ id: string }>;
      return rows.map(({ id }) => this.readSnapshot(id)!);
    })();
  }

  save(snapshot: CollaborationSnapshot): void {
    assertSnapshot(snapshot);
    this.transaction(() => {
      const previous = this.readSnapshot(snapshot.conversation.id);
      if (previous?.revision === snapshot.revision && stableJson(previous) === stableJson(snapshot)) return;
      if (
        previous
          ? snapshot.revision !== previous.revision + 1
          : snapshot.revision !== 0 && snapshot.revision !== 1
      ) throw new Error('collaboration.revision_conflict');
      if (previous) this.assertHistory(previous, snapshot);

      const conversation = snapshot.conversation;
      this.raw.prepare(`INSERT INTO collaboration_conversation
        (id, workspace_id, kind, title, parent_conversation_id, revision, created_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id,
          kind = excluded.kind, title = excluded.title, parent_conversation_id = excluded.parent_conversation_id,
          revision = excluded.revision, payload_json = excluded.payload_json`).run(
        conversation.id, conversation.workspaceId, conversation.kind, conversation.title,
        conversation.parentConversationId ?? null, snapshot.revision, conversation.createdAt,
        stableJson(conversation),
      );

      this.saveRows('members', snapshot, () => ({}));
      this.saveRows('messages', snapshot, (entry) => ({
        sequence: entry.sequence, kind: entry.kind, sender_member_id: entry.senderMemberId,
        created_at: entry.createdAt,
      }));
      this.saveRows('deliveries', snapshot, (entry) => ({
        message_id: entry.messageId, recipient_member_id: entry.recipientMemberId, status: entry.status,
      }));
      this.saveRows('tasks', snapshot, (entry) => ({
        root_task_id: entry.rootTaskId, assignee_member_id: entry.assigneeMemberId,
        current_attempt_id: entry.currentAttemptId, kind: entry.kind,
      }));
      this.saveRows('attempts', snapshot, (entry) => ({
        task_id: entry.taskId, number: entry.number, status: entry.status,
        run_id: entry.runId ?? null, updated_at: entry.updatedAt,
      }));
      const receipt = this.raw.prepare(`INSERT INTO collaboration_receipt
        (conversation_id, request_key, value) VALUES (?, ?, ?)
        ON CONFLICT(conversation_id, request_key) DO NOTHING`);
      for (const [key, value] of Object.entries(snapshot.receipts)) receipt.run(conversation.id, key, value);
    });
  }

  private readSnapshot(conversationId: string): CollaborationSnapshot | undefined {
    const row = this.raw.prepare('SELECT payload_json, revision FROM collaboration_conversation WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined;
    if (!row) return undefined;
    const receipts = this.raw.prepare('SELECT request_key, value FROM collaboration_receipt WHERE conversation_id = ?')
      .all(conversationId) as Array<{ request_key: string; value: string }>;
    return {
      conversation: JSON.parse(row.payload_json) as CollaborationSnapshot['conversation'],
      members: this.readRows('members', conversationId),
      messages: this.readRows('messages', conversationId),
      deliveries: this.readRows('deliveries', conversationId),
      tasks: this.readRows('tasks', conversationId),
      attempts: this.readRows('attempts', conversationId),
      revision: row.revision,
      receipts: Object.fromEntries(receipts.map(({ request_key, value }) => [request_key, value])),
    };
  }

  private readRows<K extends Collection>(collection: K, conversationId: string): CollaborationSnapshot[K] {
    const rows = this.raw.prepare(`SELECT payload_json FROM ${TABLES[collection]}
      WHERE conversation_id = ? ORDER BY position, id`).all(conversationId) as PayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json)) as CollaborationSnapshot[K];
  }

  private saveRows<K extends Collection>(
    collection: K,
    snapshot: CollaborationSnapshot,
    indexes: (entry: CollaborationSnapshot[K][number]) => Record<string, string | number | null>,
  ): void {
    const table = TABLES[collection];
    const keep = new Set(snapshot[collection].map((entry) => entry.id));
    // Membership may be pruned; message/task/attempt history is checked below.
    for (const row of this.raw.prepare(`SELECT id FROM ${table} WHERE conversation_id = ?`)
      .all(snapshot.conversation.id) as Array<{ id: string }>) {
      if (!keep.has(row.id)) this.raw.prepare(`DELETE FROM ${table} WHERE conversation_id = ? AND id = ?`)
        .run(snapshot.conversation.id, row.id);
    }
    for (const [position, entry] of snapshot[collection].entries()) {
      const fields = { ...indexes(entry), position, payload_json: stableJson(entry) };
      const columns = Object.keys(fields);
      const updates = columns.map((key) => `${key} = excluded.${key}`).join(', ');
      this.raw.prepare(`INSERT INTO ${table} (conversation_id, id, ${columns.join(', ')})
        VALUES (?, ?, ${columns.map(() => '?').join(', ')})
        ON CONFLICT(conversation_id, id) DO UPDATE SET ${updates}
        WHERE payload_json <> excluded.payload_json OR position <> excluded.position`)
        .run(snapshot.conversation.id, entry.id, ...Object.values(fields));
    }
  }

  private assertHistory(previous: CollaborationSnapshot, next: CollaborationSnapshot): void {
    if (previous.conversation.workspaceId !== next.conversation.workspaceId) {
      throw new Error('collaboration.workspace_scope_mismatch');
    }
    for (const collection of ['messages', 'deliveries', 'tasks', 'attempts'] as const) {
      const ids = new Set(next[collection].map((entry) => entry.id));
      if (previous[collection].some((entry) => !ids.has(entry.id))) {
        throw new Error('collaboration.history_missing');
      }
    }
    for (const [key, value] of Object.entries(previous.receipts)) {
      if (!Object.hasOwn(next.receipts, key) || next.receipts[key] !== value) {
        throw new Error('collaboration.receipt_conflict');
      }
    }
  }
}
