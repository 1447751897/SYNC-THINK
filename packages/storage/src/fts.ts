// FTS5 virtual table for messages (AI rules §6: SQLite + FTS5).
// We create the FTS5 table via raw SQL migrations; this module exposes typed
// search and a small fixture helper.

export const FTS_MESSAGES_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  thread_id UNINDEXED,
  body,
  tokenize = 'unicode61'
);
`;

export const FTS_MESSAGES_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON message BEGIN
  INSERT INTO messages_fts(message_id, thread_id, body)
  VALUES (new.id, new.thread_id, json_extract(new.blocks_json, '$[0].text'));
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON message BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id;
END;
`;

export interface FtsSearchResult {
  messageId: string;
  threadId: string;
  snippet: string;
}
