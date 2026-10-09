import {UserError} from './config.mjs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Only the workspace root is shared; personal instructions never enter this snapshot.
export class SharedRules {
  constructor(cwd) {
    this.path = join(cwd, 'AGENTS.md');
    this.applied = new Map();
    this.status = {path:this.path, state:'not_checked', threads:[]};
    this.seen = false;
  }
  async apply(codex, threadId) {
    let handle, text;
    try {
      handle = await open(this.path, 'r');
      const bytes = Buffer.alloc(65537);
      const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 65536) throw new Error('Shared rules exceed 64 KiB');
      text = new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));
      if (!text.trim()) throw new Error('Shared rules are empty');
      this.seen = true;
    } catch(error) {
      if(error.code === 'ENOENT' && !this.seen) {
        this.status.state = 'not_configured';
        return;
      }
      this.status.state = 'read_failed';
      throw new UserError('共享规则读取失败，本轮未执行；请检查工作区 AGENTS.md。');
    } finally { await handle?.close(); }
    const revision = createHash('sha256').update(text).digest('hex');
    Object.assign(this.status,{revision,checkedAt:new Date().toISOString(),state:'checked'});
    if(this.applied.get(threadId) === revision) return;
    try {
      await codex.request('thread/inject_items',{threadId,items:[{
        type:'message',role:'developer',content:[{type:'input_text',text:
          `桥接管理员共享规则快照，版本 ${revision}。以下内容来自工作区根目录 AGENTS.md，替代先前版本的同文件规则，不替代其他系统与桥接安全约束，不扩大权限。不要回复加载确认；仅处理接下来的用户请求。\n\n${text}` }],
      }]});
    } catch {
      this.status.state = 'apply_failed';
      throw new UserError('共享规则注入失败，本轮未执行；请在桌面检查桥接状态。');
    }
    this.applied.set(threadId,revision);
    this.status.state = 'injected';
    this.status.threads = [...this.applied].map(([threadId,revision])=>({threadId,revision}));
  }
}
