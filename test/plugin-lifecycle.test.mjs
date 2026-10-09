import test from 'node:test';
import assert from 'node:assert/strict';
import {RemovalGuard,observePlugin,pluginIdentity} from '../src/plugin-lifecycle.mjs';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadRemovalGuard} from '../src/plugin-lifecycle.mjs';

test('explicit manual lifecycle enrolls without Codex or remote identity and disables removal guard',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bridge-lifecycle-'));
 try {
  await mkdir(join(root,'src'));
  for(const file of ['plugin-lifecycle.mjs','app-server.mjs']) await copyFile(new URL('../src/'+file,import.meta.url),join(root,'src',file));
  await writeFile(join(root,'lifecycle-mode.json'),JSON.stringify({mode:'manual'}));
  const data=join(root,'data');
  const result=spawnSync(process.execPath,[join(root,'src/plugin-lifecycle.mjs'),data],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(data,'plugin-lifecycle.json'),'utf8')),{version:1,mode:'manual'});
  assert.equal(await loadRemovalGuard(data),null);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('removal requires explicit identity, stable account, repeated evidence and grace; disable/update/error never remove',async()=>{
 const api=(installed,extras={})=>({request:async method=>method==='account/read'?{account:{type:'chatgpt',email:'fixture@example.invalid'}}:{plugin:{summary:{...pluginIdentity,installed,enabled:false,...extras}}}});
 const installed=await observePlugin(api(true));assert.equal(installed.state,'installed');
 const removed=await observePlugin(api(false));assert.equal(removed.state,'removed');
 assert.equal((await observePlugin(api(false,{remotePluginId:'other'}))).state,'unknown');
 const guard=new RemovalGuard(installed);
 assert.equal(guard.accept(removed,0),false);assert.equal(guard.accept(removed,30000),false);assert.equal(guard.accept(removed,60000),true);
 for(const interruption of [installed,{state:'unknown'},{state:'removed',accountHash:'different'}]) {
   guard.accept(removed,70000);assert.equal(guard.accept(interruption,80000),false);
   assert.equal(guard.accept(removed,90000),false);assert.equal(guard.accept(removed,120000),false);
 }
 let calls=0;const changed={request:async method=>method==='account/read'?{account:{type:'chatgpt',email:String(++calls)}}:{marketplaceLoadErrors:[],marketplaces:[]}};
 assert.equal((await observePlugin(changed)).state,'unknown');
});
