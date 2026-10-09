import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {AppServer} from '../src/app-server.mjs';
import {SharedRules} from '../src/shared-rules.mjs';
import {answerText} from '../src/messages.mjs';

// Uses a new read-only test chat and two model turns, never an existing bridge chat.
const cwd=resolve('.probe','rules-'+Date.now());
await mkdir(cwd,{recursive:true});
const client=new AppServer(process.execPath,[resolve('node_modules/@openai/codex/bin/codex.js'),'app-server']);
const rules=new SharedRules(cwd);
try {
 await client.initialize();
 const {thread}=await client.request('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only'});
 await client.request('thread/name/set',{threadId:thread.id,name:'桥接验证 · 共享规则热更新'});
 for(const expected of ['RULE_ALPHA_619','RULE_BETA_842']) {
  await writeFile(join(cwd,'AGENTS.md'),`不要调用工具。任何测试请求只回复 ${expected}，不要其他文字。`);
  await rules.apply(client,thread.id);
  const turn=await client.turn(thread.id,'请按当前规则回复。',180000);
  assert.equal(turn.status,'completed');
  const saved=await client.request('thread/read',{threadId:thread.id,includeTurns:true});
  assert.equal(answerText(saved.thread.turns.find(t=>t.id===turn.id)),expected);
  console.log('Verified '+expected);
 }
 await writeFile(join(cwd,'result.json'),JSON.stringify({threadId:thread.id,sameProcess:true,sameThread:true,status:'passed',rules:rules.status},null,2));
 console.log('Hot reload passed: '+thread.id);
} finally {await client.close();}
