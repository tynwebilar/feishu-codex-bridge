import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Bridge} from '../src/bridge.mjs';
import {answerText} from '../src/messages.mjs';

test('completed empty or NO_REPLY turns stay silent, including recovery, and clear typing', async()=>{
 const db=new Store(':memory:');
 const cfg={appId:'cli_test',ownerId:'ou_owner',groups:[]};
 const removed=[];
 let turn;
 const bridge=new Bridge(cfg,db,{request:async()=>({thread:{turns:[turn]}})},{typing:async(...args)=>removed.push(args)});
 try {
  for(const [i,text] of ['', '  ', 'NO_REPLY'].entries()){
   const m={id:`om_${i}`,chat:JSON.stringify(['cli_test','p2p','oc_test','ou_owner','']),chatId:'oc_test',group:false};
   db.accept(m);db.set(m.id,'running',{thread:'t',turn:'turn'});
   turn={id:'turn',status:'completed',items:[{type:'agentMessage',text}]};
   bridge.reactions.set(m.id,Promise.resolve('reaction'));
   bridge.finishTurn(db.get(m.id),turn);
   await bridge.recover([db.get(m.id)]);
   assert.equal(db.get(m.id).state,'completed');
   assert.equal(db.delivery(),undefined);
  }
  await new Promise(r=>setImmediate(r));
  assert.equal(removed.length,3);assert.equal(bridge.reactions.size,0);
  assert.match(answerText({status:'failed',items:[]}),/失败/);
  assert.match(answerText({status:'interrupted',items:[]}),/停止/);
  assert.equal(answerText({status:'completed',items:[{type:'agentMessage',text:'Example: NO_REPLY'}]}),'Example: NO_REPLY');
 }finally{db.close();}
});
