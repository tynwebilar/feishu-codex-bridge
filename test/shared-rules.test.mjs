import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SharedRules} from '../src/shared-rules.mjs';

test('shared rules refresh loaded threads independently without turns, private files or duplicate injection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bridge-rules-'));
 try {
  const rules=new SharedRules(root),calls=[];
  const codex={request:async(method,params)=>calls.push({method,...params})};
  await rules.apply(codex,'one');assert.equal(calls.length,0);
  await writeFile(join(root,'private.md'),'PRIVATE_SECRET');
  await writeFile(join(root,'AGENTS.md'),'RULE_A');
  await rules.apply(codex,'one');await rules.apply(codex,'one');
  assert.equal(calls.length,1);assert.equal(calls[0].method,'thread/inject_items');
  assert.equal(calls[0].items[0].role,'developer');
  const old=rules.status.revision;
  await writeFile(join(root,'AGENTS.md'),'RULE_B');
  await rules.apply(codex,'one');await rules.apply(codex,'two');
  assert.equal(calls.length,3);assert.notEqual(rules.status.revision,old);
  assert.match(calls[1].items[0].content[0].text,/RULE_B/);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_SECRET'));
  assert.ok(!JSON.stringify(rules.status).includes('RULE_B'));
  const restarted=new SharedRules(root);await restarted.apply(codex,'one');assert.equal(calls.length,4);
  await writeFile(join(root,'AGENTS.md'),'RULE_C');
  await assert.rejects(rules.apply({request:async()=>{throw Error('offline');}},'one'),/注入失败/);
  assert.equal(rules.applied.get('one'),restarted.status.revision);
  await rules.apply(codex,'one');assert.equal(calls.length,5);
  for(const text of [' ', 'x'.repeat(65537)]) {
   await writeFile(join(root,'AGENTS.md'),text);await assert.rejects(rules.apply(codex,'one'),/读取失败/);
  }
  await rm(join(root,'AGENTS.md'));await assert.rejects(rules.apply(codex,'one'),/读取失败/);
 } finally {await rm(root,{recursive:true,force:true});}
});
