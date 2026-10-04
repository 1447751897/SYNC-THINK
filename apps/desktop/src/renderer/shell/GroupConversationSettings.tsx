import { useEffect, useState } from 'react';
import type { CollaborationCommand, CollaborationSnapshot } from '@sync-think/shared';

export function GroupConversationSettings({
  snapshot,
  busy,
  onCommand,
}: {
  snapshot: CollaborationSnapshot;
  busy: boolean;
  onCommand(command: CollaborationCommand): void;
}) {
  const [description, setDescription] = useState(snapshot.conversation.groupDescription ?? '');
  const [baseRevision, setBaseRevision] = useState(
    snapshot.conversation.groupConfigurationRevision ?? 0,
  );
  const revision = snapshot.conversation.groupConfigurationRevision ?? 0;
  useEffect(() => {
    if (description === (snapshot.conversation.groupDescription ?? '')) setBaseRevision(revision);
  }, [revision, description, snapshot.conversation.groupDescription]);
  const changed = description !== (snapshot.conversation.groupDescription ?? '');
  return (
    <section className="task-section-intro" aria-label="本群协作规则">
      <h3>本群协作规则</h3>
      <p>
        只属于这个群，不修改智能体身份或小队模板。描述用途、主持职责、发言顺序和交接边界；当前工作目标仍在任务书中。
      </p>
      <label className="collab-field">
        群描述
        <textarea
          aria-label="群描述"
          maxLength={16000}
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例如：A 先提出观点，B 质疑和补充，协调员最后总结。成员可以直接交流；需要澄清或阻塞时由协调员处理。"
        />
      </label>
      {baseRevision !== revision && (
        <p role="alert">群描述已在其他位置更新，请重新载入后再保存，避免覆盖。</p>
      )}
      <div className="collab-toolbar">
        <button
          type="button"
          disabled={busy || !changed || baseRevision !== revision}
          onClick={() => {
            const normalized = description.trim();
            setDescription(normalized);
            onCommand({
              action: 'group-config',
              conversationId: snapshot.conversation.id,
              clientRequestId: crypto.randomUUID(),
              description: normalized,
              expectedRevision: baseRevision,
            });
          }}
        >
          保存群描述
        </button>
        {baseRevision !== revision && (
          <button
            type="button"
            onClick={() => {
              setDescription(snapshot.conversation.groupDescription ?? '');
              setBaseRevision(revision);
            }}
          >
            载入最新描述
          </button>
        )}
      </div>
      <label className="collab-toggle">
        <input
          type="checkbox"
          aria-label="协调员组织群讨论"
          checked={snapshot.conversation.policy.coordinateDiscussion === true}
          disabled={busy}
          onChange={(e) =>
            onCommand({
              action: 'policy',
              conversationId: snapshot.conversation.id,
              policy: { coordinateDiscussion: e.target.checked },
            })
          }
        />
        <span>
          协调员组织群讨论
          <small>
            未明确 @ 单个成员时，先由模型决定单人、并行或顺序发言。明确 @
            仍然直达；旧群需要手动开启。不会因此授予文件写入权限。
          </small>
        </span>
      </label>
    </section>
  );
}
