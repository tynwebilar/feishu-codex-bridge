import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {scanApp} from '../src/onboarding.mjs';
test('scan setup renders QR, creates only a new app, and handles async rendering failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scan-test-'));const old=process.env.PATH;
 await writeFile(join(dir,'lark-cli.exe'),'fixture');process.env.PATH=dir+delimiter+old;
 try {
  let shown=false;
  const register=async options=>{
   assert.equal(options.createOnly,true);
   assert.ok(options.addons.events.items.tenant.includes('im.message.receive_v1'));
   options.onQRCodeReady({url:'https://example.invalid/test'});
   return {client_id:'cli_test',client_secret:'fixture'};
  };
  const result=await scanApp(register,async()=>{},()=>{shown=true;});
  assert.equal(result.client_id,'cli_test');assert.equal(shown,true);
  await assert.rejects(scanApp(register,async()=>{throw new Error('render failed');},()=>{}),/扫码创建未完成/);
 }finally{process.env.PATH=old;await rm(dir,{recursive:true,force:true});}
});
