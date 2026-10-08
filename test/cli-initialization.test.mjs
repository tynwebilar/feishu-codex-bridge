import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureCli} from '../src/authorization.mjs';
test('native startup initializes only opted-in isolated CLI, verifies credentials and preserves foreign identity',async()=>{
 const config={appId:'cli_test',ownerId:'ou_test',cliUserEnabled:true,cwd:process.cwd()};
 const calls=[];let foreign=false,missing=false;
 const run=async(args,cwd,signal,timeout,input)=>{
  calls.push({args,input});
  if(args[1]==='status')return {appId:foreign?'cli_other':'cli_test',identities:{user:{openId:'ou_test'}}};
  if(args[0]==='api'&&missing){missing=false;throw Object.assign(new Error('missing'),{missingSecret:true});}
  return {};
 };
 assert.deepEqual(await ensureCli({...config,cliUserEnabled:false},run,async()=> 'fixture',false),{state:'not_enabled'});
 assert.equal(calls.length,0);
 assert.equal((await ensureCli(config,run,async()=> 'fixture',false)).state,'ready');
 assert.equal(calls[0].input,'fixture');assert.ok(!calls[0].args.includes('fixture'));assert.equal(calls.at(-1).args[2],'/open-apis/bot/v3/info');
 calls.length=0;foreign=true;await assert.rejects(ensureCli(config,run,async()=> 'fixture',true),/不匹配/);assert.equal(calls.length,1);
 foreign=false;missing=true;calls.length=0;await ensureCli(config,run,async()=> 'fixture',true);assert.equal(calls.filter(c=>c.args[1]==='init').length,1);
});
