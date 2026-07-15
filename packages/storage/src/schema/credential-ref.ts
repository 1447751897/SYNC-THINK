import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

// CredentialRef persists metadata ONLY. Plaintext secret lives in secure-store;
// storeHandle is an opaque reference into the secure store (TD-005 / §19).
export const credentialRef = sqliteTable('credential_ref', {
  id: idColumn('id'),
  credentialGroupId: text('credential_group_id').notNull(),
  label: text('label').notNull(),
  kind: text('kind').notNull(),
  storeHandle: text('store_handle').notNull(),
  ...tsColumns(),
});
