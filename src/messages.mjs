import {permissions, admitted} from './permissions.mjs';
import { createHash } from 'node:crypto';

export function parseEvent(event, config) {
  if (event.app_id && event.app_id !== config.appId) return null;
  const m = event.message, s = event.sender;
  if (!m || s?.sender_type !== 'user' || !/^ou_[a-zA-Z0-9]+$/.test(s.sender_id?.open_id ?? '')) return null;
  if (typeof m.message_id !== 'string' || !/^om_[\w-]+$/.test(m.message_id) ||
      typeof m.chat_id !== 'string' || !/^oc_[\w-]+$/.test(m.chat_id)) return null;
  const group = m.chat_type === 'group';
  if (m.chat_type !== 'p2p' && !group) return null;
  if(!admitted(config,group,m.chat_id,s.sender_id.open_id)) return null;
  // Feishu cannot provide sticker pixels; ignore them without a reply or model turn.
  if (m.message_type === 'sticker') return null;
  const rule=group && permissions(config).groups.find(g=>g.chatId===m.chat_id);
  if(group && rule.requireMention && !m.mentions?.some(x=>x.id?.open_id===config.botId)) return null;
  if (typeof m.content !== 'string' || Buffer.byteLength(m.content) > 100_000) return null;
  let body;
  try { body = JSON.parse(m.content); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  let text = '', attachments = [], unsupported = false;
  if (m.message_type === 'text') text = body.text;
  else if (m.message_type === 'image') attachments = [{ type: 'image', key: body.image_key }];
  else if (m.message_type === 'file') attachments = [{ type: 'file', key: body.file_key, name: body.file_name }];
  else if (m.message_type === 'post') {
    const post = Array.isArray(body.content) ? body : body.zh_cn ?? body.en_us;
    if (!post || !Array.isArray(post.content)) return null;
    text = typeof post.title === 'string' ? post.title + '\n' : '';
    for (const line of post.content) {
      if (!Array.isArray(line)) return null;
      for (const node of line) {
        if (!node || typeof node !== 'object') return null;
        if (node.tag === 'text' || node.tag === 'a' || node.tag === 'md') {
          if (typeof node.text !== 'string') return null;
          text += node.text;
        }
        else if (node.tag === 'code_block') {
          if (typeof node.text !== 'string') return null;
          const language = typeof node.language === 'string' && /^[\w+#.-]{1,40}$/.test(node.language) ? node.language : '';
          // A longer fence keeps embedded Markdown fences inside the code block.
          const fence = '`'.repeat((node.text.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length + 1), 3));
          text += `\n${fence}${language}\n${node.text}${node.text.endsWith('\n') ? '' : '\n'}${fence}\n`;
        }
        else if (node.tag === 'emotion') {
          if (typeof node.emoji_type !== 'string') return null;
          text += `[表情:${node.emoji_type}]`;
        }
        else if (node.tag === 'hr') text += '\n---\n';
        else if (node.tag === 'img') attachments.push({ type: 'image', key: node.image_key });
        else if (node.tag !== 'at') unsupported = true;
      }
      text += '\n';
    }
  } else unsupported = true;
  if (typeof text !== 'string') return null;
  for (const mention of m.mentions ?? []) {
    if (mention.id?.open_id === config.botId && typeof mention.key === 'string') text = text.replaceAll(mention.key, '');
  }
  text = text.trim();
  if (text.length > 30_000 || attachments.length > 5 || attachments.some(a => typeof a.key !== 'string' || a.key.length > 256)) unsupported = true;
  // Group members never share the owner's private conversation; topics stay isolated.
  const chat = JSON.stringify([config.appId, m.chat_type, m.chat_id, group && permissions(config).groupContext==='shared' ? '*' : s.sender_id.open_id, group && permissions(config).groupContext!=='shared' ? m.thread_id ?? '' : '']);
  return { id: m.message_id, chat, chatId: m.chat_id, senderId:s.sender_id.open_id, group, text, attachments, unsupported,
    title: `飞书${group ? '群聊' : '私聊'} · ${createHash('sha256').update(chat).digest('hex').slice(0, 8)}` };
}

export function chunks(text, limit = 4000) {
  const result = []; let part = '';
  for (const char of text) { if (part.length + char.length > limit) { result.push(part); part = ''; } part += char; }
  if (part) result.push(part);
  return result;
}

export function answerText(turn) {
  const final = turn.items?.filter(i => i.type === 'agentMessage' && i.phase !== 'commentary').map(i => i.text).filter(Boolean).join('\n\n');
  if (turn.status === 'interrupted') return `${final ? final + '\n\n' : ''}任务已停止。停止前的操作可能已执行。`;
  if (turn.status !== 'completed') return 'Codex 执行失败。请在本机查看对应会话；未自动重试。';
  const text = final?.trim() ?? '';
  return text === 'NO_REPLY' ? '' : text;
}
