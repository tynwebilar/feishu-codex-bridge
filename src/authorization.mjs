import { UserError, dataDir, getSecret } from './config.mjs';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export function cliEnvironment(base=process.env) {
  const env={...base};
  for(const key of Object.keys(env)) {
    if(/^LARKSUITE_CLI_(APP_ID|APP_SECRET|USER_ACCESS_TOKEN|TENANT_ACCESS_TOKEN|AUTH_PROXY|PROFILE|STRICT_MODE|DEFAULT_AS|BRAND)$/i.test(key) || /^(OPENCLAW_HOME|HERMES_HOME|LARK_CHANNEL|LARK_CHANNEL_CONFIG)$/i.test(key)) delete env[key];
  }
  return {...env,LARKSUITE_CLI_CONFIG_DIR:join(dataDir,'lark-cli'),LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'};
}
export function cliShellOverride() {
  // Codex inherit=core drops ambient CLI variables; pin this non-secret path for shell tools.
  return `shell_environment_policy.set.LARKSUITE_CLI_CONFIG_DIR=${JSON.stringify(join(dataDir,'lark-cli'))}`;
}

export function cliPath() {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const file of ['lark-cli.exe','node_modules/@larksuite/cli/bin/lark-cli.exe']) {
      const path=join(dir,file); if(existsSync(path)) return path;
    }
  }
  throw new UserError('需要先在本机安装官方 lark-cli。');
}
export function runLark(args,cwd,signal,timeout=30000,input) {
  return new Promise((resolve,reject)=>{const child=execFile(cliPath(),args,{cwd,signal,timeout,windowsHide:true,maxBuffer:1024*1024,
    env:cliEnvironment()},(error,stdout,stderr)=>{
    if(error) {
      const failure=new UserError(`飞书 CLI ${args[1]} 未完成，请检查登录、权限或授权是否过期。`);
      try { const detail=JSON.parse(stderr).error; failure.missingSecret=detail?.type==='authentication' && /missing.*secret/i.test(detail.message); } catch {}
      return reject(failure);
    }
    if(args[0]==='config') return resolve({}); // Config commands may print human text or credentials; never return their output.
    try {const result=JSON.parse(stdout); if(result.ok===false) throw new UserError(); resolve(result.data ?? result);}
    catch {reject(new UserError('飞书 CLI 未返回有效结果。'));}
  });child.stdin.on('error',()=>{});child.stdin.end(input);});
}
export async function ensureCli(config,run=runLark,secret=getSecret,configured=existsSync(join(dataDir,'lark-cli','config.json'))) {
  if(!config.cliUserEnabled && !configured) return {state:'not_enabled'};
  if(configured) {
    const status=await run(['auth','status','--json'],config.cwd);
    if(status.appId!==config.appId || (status.identities?.user?.openId && status.identities.user.openId!==config.ownerId)) throw new UserError('独立 CLI 应用或用户不匹配，未覆盖现有配置。');
  }
  const initialize=async()=>run(['config','init','--app-id',config.appId,'--app-secret-stdin','--brand','feishu'],config.cwd,undefined,30000,await secret(config));
  if(!configured) {
    await initialize();
    await run(['config','strict-mode','off'],config.cwd);
    await run(['config','default-as','user'],config.cwd);
  }
  const verify=()=>run(['api','GET','/open-apis/bot/v3/info','--as','bot'],config.cwd);
  try {await verify();}
  catch(error) {
    if(!error.missingSecret) throw error;
    await initialize();
    await verify();
  }
  return {state:'ready'};
}
export function authorizationUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.hostname!=='accounts.feishu.cn' || url.username || url.password || !url.pathname.startsWith('/oauth/')) throw new UserError('授权地址无效。');
  return value;
}
export const authTool={type:'function',name:'bridge_feishu_authorize',description:'当当前飞书主人请求访问个人资源且 lark-cli 提示用户授权缺失时使用。发送授权卡片并等待官方登录确认，成功后在当前任务继续，无需用户回复已授权。仅私聊；只申请当前任务必需 scopes，不用于机器人应用权限。',inputSchema:{type:'object',properties:{scopes:{type:'array',items:{type:'string'},minItems:1,maxItems:50}},required:['scopes'],additionalProperties:false}};
export async function authorize(config,message,feishu,scopes,signal,run=runLark) {
  if(message.group) throw new UserError('请在机器人私聊中发起个人授权。');
  if(!Array.isArray(scopes)||!scopes.length||scopes.length>50||scopes.some(s=>typeof s!=='string'||!/^[a-z][a-z0-9_.]*:[a-z0-9_.:]+$/.test(s))) throw new UserError('权限范围无效。');
  const before=await run(['auth','status','--json'],config.cwd,signal);
  if(before.appId!==config.appId || (before.identities?.user?.openId && before.identities.user.openId!==config.ownerId)) throw new UserError('CLI 应用或用户与桥接不一致，请先在本机配置绑定，不会修改其他应用登录。');
  const flow=await run(['auth','login','--scope',scopes.join(' '),'--no-wait','--json'],config.cwd,signal);
  const url=authorizationUrl(flow.verification_url ?? flow.verification_uri_complete);
  if(typeof flow.device_code!=='string'||!flow.device_code) throw new UserError('未获得授权会话。');
  const dir=await mkdtemp(join(tmpdir(),'feishu-auth-'));
  let card;
  try {
    await run(['auth','qrcode',url,'--output','qr.png'],dir,signal);
    const image=await feishu.uploadImage(join(dir,'qr.png'));
    card=await feishu.sendAuth({replyTo:message.id,uuid:randomUUID(),url,image,scopes,expires:flow.expires_in});
    // Card is delivered before polling; the original tool call resumes exactly once.
    await run(['auth','login','--device-code',flow.device_code,'--json'],config.cwd,signal,600000);
    const after=await run(['auth','status','--json','--verify'],config.cwd,signal);
    if(after.appId!==config.appId || after.identities?.user?.openId!==config.ownerId || after.identities.user.available!==true) throw new UserError('授权身份未通过校验。');
    await feishu.updateAuth(card,'授权成功，正在继续原请求。').catch(()=>{});
    return '飞书用户授权成功，身份已核对。继续当前请求；不要重做已经成功的写入操作。';
  } catch(error) {
    if(card) await feishu.updateAuth(card,'授权未完成或未通过身份校验。请重新发起授权。').catch(()=>{});
    throw error;
  } finally {await rm(dir,{recursive:true,force:true});}
}
