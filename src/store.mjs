import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chunks } from './messages.mjs';

export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('数据版本比程序新，请恢复匹配版本。'); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS chats (key TEXT PRIMARY KEY, thread TEXT);
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY, chat TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued', thread TEXT, turn TEXT,
        created INTEGER NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0,
        first_attempt INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0, remote TEXT);
      CREATE INDEX IF NOT EXISTS inbox_queue ON inbox(state, created);
      CREATE INDEX IF NOT EXISTS outbox_queue ON outbox(state, next_attempt);`);
    this.db.exec('PRAGMA user_version=1');
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id) { return this.db.prepare('SELECT * FROM inbox WHERE id=?').get(id); }
  assertAccount(appId) {
    for (const row of this.db.prepare('SELECT key FROM chats').all()) {
      if (JSON.parse(row.key)[0] !== appId) throw new Error('Bridge data belongs to another application');
    }
  }
  accept(message) {
    return this.transaction(() => {
      if (this.get(message.id)) return 'duplicate';
      const total = this.db.prepare("SELECT count(*) AS n FROM inbox WHERE state IN ('queued','starting','running')").get().n;
      const state = total >= 100 ? 'rejected' : 'queued';
      this.db.prepare('INSERT INTO inbox(id,chat,payload,state,created) VALUES(?,?,?,?,?)')
        .run(message.id, message.chat, JSON.stringify(message), state, Date.now());
      this.db.prepare('INSERT OR IGNORE INTO chats(key) VALUES(?)').run(message.chat);
      return state;
    });
  }
  next() {
    return this.db.prepare(`SELECT * FROM inbox i WHERE state='queued'
      AND NOT EXISTS(SELECT 1 FROM inbox b WHERE b.chat=i.chat AND b.state IN ('starting','running','unknown'))
      ORDER BY created,rowid LIMIT 1`).get();
  }
  set(id, state, fields = {}) {
    const allowed = ['thread', 'turn', 'error'];
    const keys = Object.keys(fields);
    if (keys.some(k => !allowed.includes(k))) throw new Error('Invalid state field');
    this.db.prepare(`UPDATE inbox SET state=?${keys.map(k => `,${k}=?`).join('')} WHERE id=?`)
      .run(state, ...keys.map(k => fields[k]), id);
  }
  thread(chat) { return this.db.prepare('SELECT thread FROM chats WHERE key=?').get(chat)?.thread; }
  bind(chat, thread) { this.db.prepare('UPDATE chats SET thread=? WHERE key=?').run(thread, chat); }
  interrupted() { return this.db.prepare("SELECT * FROM inbox WHERE state IN ('starting','running')").all(); }
  unknown(chat) { return this.db.prepare("SELECT * FROM inbox WHERE state='unknown' AND chat=?").all(chat); }
  blocked(chat) { return this.db.prepare("SELECT count(*) AS n FROM inbox WHERE chat=? AND state IN ('starting','running','unknown')").get(chat).n > 0; }
  enqueue(source, message, text, kind = 'final') {
    // Stable intent ID prevents duplicate final output when recovery is repeated.
    chunks(text).forEach((part, index) => {
      const id = `${source}:${kind}:${index}`;
      this.db.prepare('INSERT OR IGNORE INTO outbox(id,source,payload) VALUES(?,?,?)')
        .run(id, source, JSON.stringify({ replyTo: message.id, chatId: message.chatId, text: part, uuid: randomUUID() }));
    });
  }
  finish(row, text, state = 'completed') {
    this.transaction(() => {
      this.db.prepare("UPDATE outbox SET state='superseded' WHERE source=? AND state!='sent' AND (id LIKE '%:receipt:%' OR id LIKE '%:running:%')").run(row.id);
      this.enqueue(row.id, JSON.parse(row.payload), text);
      this.set(row.id, state);
    });
  }
  enqueueFile(source, message, file, callId) {
    this.db.prepare('INSERT OR IGNORE INTO outbox(id,source,payload) VALUES(?,?,?)').run(`${source}:file:${callId}`, source,
      JSON.stringify({ replyTo: message.id, chatId: message.chatId, file, uuid: randomUUID() }));
  }
  delivery() {
    this.db.prepare("UPDATE outbox SET state='unknown' WHERE state='sending' AND first_attempt<?").run(Date.now() - 45 * 60_000);
    return this.db.prepare(`SELECT o.* FROM outbox o WHERE o.state IN ('pending','sending') AND o.next_attempt<=?
      AND NOT EXISTS(SELECT 1 FROM outbox earlier WHERE earlier.source=o.source AND earlier.rowid<o.rowid
        AND earlier.state IN ('pending','sending','unknown')) ORDER BY o.rowid LIMIT 1`).get(Date.now());
  }
  sending(row) {
    this.db.prepare("UPDATE outbox SET state='sending',attempt=attempt+1,first_attempt=COALESCE(first_attempt,?) WHERE id=?").run(Date.now(), row.id);
  }
  delivered(id, remote) { this.db.prepare("UPDATE outbox SET state='sent',remote=? WHERE id=?").run(remote, id); }
  retry(row, failure) {
    // Stay strictly inside Feishu's one-hour UUID deduplication window.
    const expired = row.first_attempt && Date.now() - row.first_attempt > 45 * 60_000;
    const state = expired || row.attempt >= 8 ? 'unknown' : 'sending';
    const payload = JSON.parse(row.payload);
    if (failure) payload.lastError = failure;
    this.db.prepare('UPDATE outbox SET state=?,next_attempt=?,payload=? WHERE id=?')
      .run(state, Date.now() + Math.min(60_000, 1000 * 2 ** row.attempt), JSON.stringify(payload), row.id);
  }
  retryDeliveries(chat) {
    // Preserve UUID and the original deadline; never replay outside the deduplication window.
    return this.db.prepare(`UPDATE outbox SET state='sending',attempt=0,next_attempt=0
      WHERE state='unknown' AND first_attempt>? AND first_attempt<=?
      AND source IN (SELECT id FROM inbox WHERE chat=?)`).run(Date.now() - 45 * 60_000, Date.now(), chat).changes;
  }
  deliveryErrors(chat) {
    return this.db.prepare(`SELECT o.id,o.state,o.payload FROM outbox o JOIN inbox i ON i.id=o.source
      WHERE o.state IN ('sending','unknown') AND (? IS NULL OR i.chat=?)
      ORDER BY o.rowid DESC LIMIT 10`).all(chat ?? null, chat ?? null)
      .map(row => ({ id: row.id, state: row.state, error: JSON.parse(row.payload).lastError }))
      .filter(row => row.error);
  }
  stats() {
    return { inbox: this.db.prepare('SELECT state,count(*) AS count FROM inbox GROUP BY state').all(),
      outbox: this.db.prepare('SELECT state,count(*) AS count FROM outbox GROUP BY state').all(),
      deliveryErrors: this.deliveryErrors() };
  }
  close() { this.db.close(); }
}
