import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppServer } from '../src/app-server.mjs';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
test('RPC, early completion, timeout and child exit are handled', async () => {
  const client = new AppServer(process.execPath, [fixture]);
  try {
    await client.initialize();
    await client.interrupt('thread1', 't1');
    assert.equal((await client.turn('thread1', 'hello')).status, 'completed');
    await assert.rejects(client.request('timeout', {}, 30), /timeout/);
    assert.equal(client.pending.size, 0);
    await assert.rejects(client.request('exit'), /exited/);
    await assert.rejects(client.request('after-exit'), /closed/);
  } finally { await client.close(); }
  const missing = new AppServer('feishu-codex-nonexistent-executable');
  await assert.rejects(missing.initialize(), /ENOENT/);
  await missing.close();
});
