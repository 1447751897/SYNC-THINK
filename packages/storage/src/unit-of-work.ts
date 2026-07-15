import type { BetterSQLite3Raw } from './connection.js';

export class SqliteUnitOfWork {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  run<T>(fn: () => T): T {
    return this.raw.transaction(fn).immediate();
  }
}
