import * as Lark from '@larksuiteoapi/node-sdk';
import { getSecret, UserError } from './config.mjs';
import { createReadStream } from 'node:fs';

// SDK logs can contain request headers; expose only structured status from this adapter.
const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} };
export function replyContent(text) {
  // Match the native post/Markdown path used by openclaw-lark; never accept model card JSON.
  const markdown=String(text).replace(/(\[[^\]\n]{1,200}\])\s+\((https?:\/\/[^\s)]+)\)/g,'$1($2)')
    .replace(/<(?=\/?at\b)/gi,'&lt;');
  return JSON.stringify({zh_cn:{content:[[{tag:'md',text:markdown}]]}});
}
Lark.defaultHttpInstance.defaults.timeout = 30_000;
export function deliveryFailure(error) {
  const code = error?.response?.data?.code ?? error?.code;
  const http = error?.response?.status;
  return {
    code: Number.isSafeInteger(code) ? code : null,
    http: Number.isInteger(http) && http >= 100 && http <= 599 ? http : null,
    hint: code === 99991672 ? '飞书应用缺少权限；文件上传需 im:resource:upload，开通并生效后重试。'
      : '交付未确认；检查网络、应用权限及飞书服务状态。',
  };
}
export async function sendFile(client, payload) {
  // SDK file.create unwraps the API data object, unlike message.reply.
  const uploaded = await client.im.file.create({ data: { file_type: 'stream', file_name: payload.file.name, file: createReadStream(payload.file.path) } });
  if (!uploaded?.file_key) throw Object.assign(new UserError('文件上传失败'), { code: uploaded?.code });
  const result = await client.im.message.reply({ path: { message_id: payload.replyTo }, data: {
    msg_type: 'file', content: JSON.stringify({ file_key: uploaded.file_key }), uuid: payload.uuid,
  } });
  if (result.code !== 0 || !result.data?.message_id) throw Object.assign(new UserError('文件回复未确认送达'), { code: result.code });
  return result.data.message_id;
}
export async function typingReaction(client, messageId, reactionId) {
  // Best-effort decoration: a permission/network failure must not block the reply.
  try {
    if (reactionId) {
      await client.im.messageReaction.delete({ path: { message_id: messageId, reaction_id: reactionId } });
      return null;
    }
    const result = await client.im.messageReaction.create({ path: { message_id: messageId }, data: { reaction_type: { emoji_type: 'Typing' } } });
    return result.code === 0 ? result.data?.reaction_id ?? null : null;
  } catch { return null; }
}
export async function connectFeishu(config) {
  const appSecret = await getSecret(config);
  const options = { appId: config.appId, appSecret, logger };
  const client = new Lark.Client(options);
  const identity = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' });
  if (identity.code !== 0 || !identity.bot?.open_id) throw new UserError('飞书应用校验失败：检查密钥、机器人能力和应用发布状态。');
  const ws = new Lark.WSClient(options);
  return {
    client, botId: identity.bot.open_id, name: identity.bot.app_name,
    async start(receive) {
      await ws.start({ eventDispatcher: new Lark.EventDispatcher({ logger }).register({ 'im.message.receive_v1': receive }) });
    },
    status() { return ws.getConnectionStatus().state; },
    close() { ws.close({ force: true }); },
    typing(messageId, reactionId) { return typingReaction(client, messageId, reactionId); },
    async uploadImage(path) {
      const result=await client.im.image.create({data:{image_type:'message',image:createReadStream(path)}});
      if(!result?.image_key) throw new UserError('二维码上传失败，请检查图片上传权限。');
      return result.image_key;
    },
    async sendAuth(payload) {
      const content=JSON.stringify({config:{wide_screen_mode:true},header:{title:{tag:'plain_text',content:'飞书个人授权'}},elements:[
        {tag:'div',text:{tag:'plain_text',content:`当前任务需要以下权限：\n${payload.scopes.join('\n')}\n点击按钮或扫码授权。${Number.isFinite(payload.expires) ? `有效期 ${payload.expires} 秒。` : ''}链接过期后请重新发起；完成后自动继续。`}},
        {tag:'action',actions:[{tag:'button',text:{tag:'plain_text',content:'去授权'},type:'primary',url:payload.url}]},
        {tag:'img',img_key:payload.image,alt:{tag:'plain_text',content:'飞书授权二维码'}},
      ]});
      const r=await client.im.message.reply({path:{message_id:payload.replyTo},data:{msg_type:'interactive',content,uuid:payload.uuid}});
      if(r.code!==0 || !r.data?.message_id) throw new UserError('授权卡片未确认送达。');
      return r.data.message_id;
    },
    async updateAuth(messageId,text) {
      const r=await client.im.message.patch({path:{message_id:messageId},data:{content:JSON.stringify({elements:[{tag:'div',text:{tag:'plain_text',content:text}}]})}});
      if(r.code!==0) throw new UserError('授权卡片更新失败。');
    },
    async send(payload) {
      if (payload.file) {
        return sendFile(client, payload);
      }
      const content = replyContent(payload.text);
      const result = await client.im.message.reply({ path: { message_id: payload.replyTo },
        data: { msg_type: 'post', content, uuid: payload.uuid } });
      if (result.code !== 0 || !result.data?.message_id) throw Object.assign(new UserError('飞书回复未确认送达'), { code: result.code });
      return result.data.message_id;
    },
  };
}
