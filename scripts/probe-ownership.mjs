import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { AppServer } from '../src/app-server.mjs';

// Explicitly select an idle test thread. This does not start a model turn or edit history.
const threadId = process.argv[2];
if (!threadId) throw Error('Usage: node scripts/probe-ownership.mjs TEST_THREAD_ID');
const args = [resolve('node_modules/@openai/codex/bin/codex.js'), 'app-server'];
const owner = new AppServer(process.execPath, args);
const viewer = new AppServer(process.execPath, args);
try {
  await owner.initialize(); await viewer.initialize();
  await owner.request('thread/resume', { threadId });
  const before = await viewer.request('thread/read', { threadId, includeTurns: true });
  await assert.rejects(viewer.request('thread/resume', { threadId }), /already has an active writer/);
  await owner.close();
  await viewer.request('thread/resume', { threadId });
  const after = await viewer.request('thread/read', { threadId, includeTurns: true });
  assert.equal(after.thread.turns.length, before.thread.turns.length);
  console.log(JSON.stringify({ threadId, idleWriterExclusive: true, historyReadable: true,
    processExitReleases: true, turnsUnchanged: true }));
} finally { await viewer.close(); await owner.close(); }
