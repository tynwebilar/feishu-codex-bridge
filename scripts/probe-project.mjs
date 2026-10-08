import { AppServer } from '../src/app-server.mjs';
import { ensureProject } from '../src/projects.mjs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const client = new AppServer(process.execPath, [resolve('node_modules/@openai/codex/bin/codex.js'), 'app-server']);
try {
  await client.initialize();
  const projectId = await ensureProject(client, resolve('.'));
  const { thread } = await client.request('thread/start', { cwd: resolve('.'), projectId, approvalPolicy: 'never', sandbox: 'read-only' });
  await client.request('thread/name/set', { threadId: thread.id, name: '桥接验证 · 创建时绑定项目' });
  const turn = await client.turn(thread.id, '项目归组测试。不要调用工具，只回复“项目绑定测试完成”。');
  const { thread: saved } = await client.request('thread/read', { threadId: thread.id, includeTurns: true });
  const report = { threadId: saved.id, projectId: saved.projectId, expectedProjectId: projectId, turnStatus: turn.status, turns: saved.turns.length };
  await writeFile('.probe/project-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await client.close(); }
