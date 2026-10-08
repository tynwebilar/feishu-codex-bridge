import { UserError } from './config.mjs';
import { registerApp } from '@larksuiteoapi/node-sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { cliPath, runLark } from './authorization.mjs';

export async function scanApp(register=registerApp,qr=runLark,show=path=>spawn('explorer.exe',[path],{windowsHide:true})) {
  cliPath(); // Check QR renderer before creating a remote application.
  const dir=await mkdtemp(join(tmpdir(),'feishu-setup-'));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),600000);
  let rendering=Promise.resolve(),renderError;
  try {
    const result=await register({createOnly:true,signal:controller.signal,appPreset:{name:'Codex 助手'},
      addons:{scopes:{tenant:['im:message:send_as_bot','im:message.reactions:write_only','im:resource:upload']},events:{items:{tenant:['im.message.receive_v1']}}},
      onQRCodeReady:({url})=>{
        console.log(`请在飞书中扫码创建机器人，或打开：${url}`);
        rendering=qr(['auth','qrcode',url,'--output','qr.png'],dir,controller.signal).then(()=>show(join(dir,'qr.png'))).catch(error=>{renderError=error;controller.abort();});
      },
    });
    await rendering;
    if(renderError || !result?.client_id || !result?.client_secret) throw new Error('Incomplete registration');
    return result;
  } catch {throw new UserError('扫码创建未完成；请检查是否过期或被取消。若已创建应用，请使用已有应用入口，避免重复创建。');}
  finally {clearTimeout(timer);controller.abort();await rendering;await rm(dir,{recursive:true,force:true});}
}
