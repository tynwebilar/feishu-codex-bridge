import test from 'node:test';
import assert from 'node:assert/strict';
import {RemovalGuard,observePlugin,pluginIdentity} from '../src/plugin-lifecycle.mjs';
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
