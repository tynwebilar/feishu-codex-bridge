import { AppServer } from '../src/app-server.mjs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { ensureProject } from '../src/projects.mjs';
const client = new AppServer(process.execPath, [resolve('node_modules/@openai/codex/bin/codex.js'), 'app-server']);
try {
  await client.initialize();
  const projectId = await ensureProject(client, resolve('.'));
  const { thread: created } = await client.request('thread/start', { cwd: resolve('.'), projectId, approvalPolicy: 'never', sandbox: 'read-only' });
  const threadId = created.id;
  await client.request('thread/name/set', { threadId, name: '桥接验证 · 取消执行' });
  const turn = await client.turn(threadId, '取消测试。不要调用任何工具，不修改文件。请写一篇长文解释二分查找。', 60_000,
    async turnId => { await client.interrupt(threadId, turnId); });
  assert.equal(turn.status, 'interrupted');
  const { thread } = await client.request('thread/read', { threadId, includeTurns: true });
  assert.equal(thread.turns.find(t => t.id === turn.id)?.status, 'interrupted');
  const result = { threadId, turnId: turn.id, status: turn.status, persisted: true };
  await writeFile('.probe/interrupt-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await client.close(); }
