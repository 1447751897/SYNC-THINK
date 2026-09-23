/** Additive collaboration persistence, applied only by the normal migration runner. */
export const COLLABORATION_CHAT_DDL = `
CREATE TABLE collaboration_conversation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model','direct','group')),
  title TEXT NOT NULL,
  parent_conversation_id TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE INDEX collaboration_conversation_workspace_idx
  ON collaboration_conversation(workspace_id, created_at, id);
CREATE INDEX collaboration_conversation_parent_idx
  ON collaboration_conversation(parent_conversation_id);

CREATE TABLE collaboration_member (
  conversation_id TEXT NOT NULL REFERENCES collaboration_conversation(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (conversation_id, id)
);
CREATE TABLE collaboration_message (
  conversation_id TEXT NOT NULL REFERENCES collaboration_conversation(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  sender_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (conversation_id, id),
  UNIQUE (conversation_id, sequence)
);
CREATE TABLE collaboration_delivery (
  conversation_id TEXT NOT NULL REFERENCES collaboration_conversation(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  recipient_member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','processed','failed','cancelled')),
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (conversation_id, id),
  UNIQUE (conversation_id, message_id, recipient_member_id)
);
CREATE INDEX collaboration_delivery_status_idx
  ON collaboration_delivery(conversation_id, status, position);
CREATE TABLE collaboration_task (
  conversation_id TEXT NOT NULL REFERENCES collaboration_conversation(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  root_task_id TEXT NOT NULL,
  assignee_member_id TEXT NOT NULL,
  current_attempt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task','reply','summary')),
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (conversation_id, id)
);
CREATE INDEX collaboration_task_root_idx
  ON collaboration_task(conversation_id, root_task_id);
CREATE TABLE collaboration_attempt (
  conversation_id TEXT NOT NULL REFERENCES collaboration_conversation(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number >= 1),
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_input','stopping','succeeded','failed','cancelled','interrupted')),
  run_id TEXT,
  updated_at TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (conversation_id, id),
  UNIQUE (conversation_id, task_id, number)
);
CREATE INDEX collaboration_attempt_status_idx
  ON collaboration_attempt(conversation_id, status, updated_at);
CREATE INDEX collaboration_attempt_run_idx ON collaboration_attempt(run_id);
CREATE TABLE collaboration_receipt (
  conversation_id TEXT NOT NULL REFERENCES collaboration_conversation(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (conversation_id, request_key)
);
`;
