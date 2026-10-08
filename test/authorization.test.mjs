import test from 'node:test';
import assert from 'node:assert/strict';
import {authorize,authorizationUrl,cliEnvironment} from '../src/authorization.mjs';
test('bridge CLI identity is isolated from inherited application credentials',()=>{
 const original={PATH:'fixture',LARKSUITE_CLI_APP_SECRET:'foreign',LARKSUITE_CLI_PROFILE:'other',OPENCLAW_HOME:'foreign'};
 const env=cliEnvironment(original);
 assert.equal(env.PATH,'fixture');assert.equal(env.LARKSUITE_CLI_APP_SECRET,undefined);assert.equal(env.LARKSUITE_CLI_PROFILE,undefined);
 assert.equal(env.OPENCLAW_HOME,undefined);assert.ok(env.LARKSUITE_CLI_CONFIG_DIR.endsWith('lark-cli'));
 assert.equal(original.LARKSUITE_CLI_APP_SECRET,'foreign');
});
test('authorization delivers card before polling, verifies owner, and resumes only after CLI success',async()=>{
 const cfg={appId:'cli_test',ownerId:'ou_owner',cwd:process.cwd()};
 const events=[];let other=false,fail=false;
 const run=async args=>{
  events.push(args[1]+(args.includes('--device-code')?'-poll':''));
  if(args[1]==='status') return {appId:'cli_test',identities:{user:{openId:other?'ou_other':'ou_owner',available:true}}};
  if(args.includes('--no-wait')) return {device_code:'opaque',verification_url:'https://accounts.feishu.cn/oauth/v1/device/verify?opaque=x',expires_in:600};
  if(args.includes('--device-code')&&fail) throw new Error('expired');
  return {};
 };
 const feishu={uploadImage:async()=> 'img',sendAuth:async()=>{events.push('card');return 'card1';},updateAuth:async(id,text)=>events.push(text)};
 const message={id:'om_1',group:false};
 assert.match(await authorize(cfg,message,feishu,['docx:document:readonly'],undefined,run),/授权成功/);
 assert.ok(events.indexOf('card')<events.indexOf('login-poll'));
 other=true;await assert.rejects(authorize(cfg,message,feishu,['docx:document:readonly'],undefined,run),/不一致/);
 other=false;fail=true;await assert.rejects(authorize(cfg,message,feishu,['docx:document:readonly'],undefined,run),/expired/);
 assert.match(events.at(-1),/未完成/);
 await assert.rejects(authorize(cfg,{...message,group:true},feishu,['docx:document:readonly'],undefined,run),/私聊/);
 assert.throws(()=>authorizationUrl('https://accounts.feishu.cn.evil.test/oauth/a'));
 assert.throws(()=>authorizationUrl('http://accounts.feishu.cn/oauth/a'));
});
