import { AppServer } from '../src/app-server.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { ensureProject } from '../src/projects.mjs';

const cwd = resolve('.');
await mkdir('.probe', { recursive: true });
const report = { startedAt: new Date().toISOString(), cwd, threads: [], checks: [], desktopGrouping: 'pending' };
let client;
async function connect() {
  client = new AppServer(process.execPath, [resolve('node_modules/@openai/codex/bin/codex.js'), 'app-server']);
  report.server = await client.initialize();
}
async function create(name) {
  const projectId = await ensureProject(client, cwd);
  const { thread } = await client.request('thread/start', { cwd, projectId, approvalPolicy: 'never', sandbox: 'read-only' });
  report.threads.push(thread.id);
  await client.request('thread/name/set', { threadId: thread.id, name });
  return thread.id;
}
async function send(id, text) {
  const turn = await client.turn(id, text);
  assert.equal(turn.status, 'completed', JSON.stringify(turn.error));
  report.checks.push({ threadId: id, turnId: turn.id, status: turn.status });
  console.log(`Completed turn ${report.checks.length}: ${id}`);
}
try {
  await connect();
  const id = await create('桥接验证 · 私聊连续上下文');
  await send(id, '这是桥接协议测试，不调用工具、不修改文件。请记住测试口令 MAPLE-731，只回复“已记住”。');
  await send(id, '这是第二轮测试。不要调用工具，只回复测试口令。');
  await send(id, '这是第三轮测试。不要调用工具，只回复“第三轮完成”。');
  await client.close();
  await connect();
  const resumed = await client.request('thread/resume', { threadId: id, cwd, approvalPolicy: 'never', sandbox: 'read-only' });
  assert.equal(resumed.thread.id, id);
  await send(id, '进程重启后的第四轮。不要调用工具，只回复此前记住的测试口令。');
  await send(id, '第五轮。不要调用工具，只回复“恢复完成”。');
  const { thread } = await client.request('thread/read', { threadId: id, includeTurns: true });
  assert.equal(thread.turns.length, 5);
  const replies = thread.turns.map(t => t.items.filter(i => i.type === 'agentMessage').map(i => i.text).join('\n'));
  assert.ok(replies[1].includes('MAPLE-731') && replies[3].includes('MAPLE-731'), 'Context recall failed');
  report.contextRecall = true;
  const second = await create('桥接验证 · 群聊独立上下文');
  assert.notEqual(second, id);
  await send(second, '这是独立群聊测试。不要调用工具，只回复“独立会话正常”。');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  if (client) await client.close();
  await writeFile('.probe/result.json', JSON.stringify(report, null, 2));
  console.log(`Probe ${report.status}; see .probe/result.json`);
}
