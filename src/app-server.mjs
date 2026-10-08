import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// One client owns its child process. Never attach to a desktop's private socket.
export class AppServer extends EventEmitter {
  constructor(command, args = [], options = {}) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.processClosed = new Promise(resolve => this.child.once('close', resolve));
    this.child.stderr.on('data', () => {}); // Do not publish raw runtime logs or credentials.
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => this.fail(new Error(`App Server exited (${code ?? signal})`)));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.method && message.id !== undefined) {
          Promise.resolve().then(() => {
            if (!this.onRequest) throw new Error('Unsupported interactive request');
            return this.onRequest(message);
          }).then(result => {
            if (!this.closed) this.write({ id: message.id, result });
          }, () => {
            if (!this.closed) this.write({ id: message.id, error: { code: -32601, message: 'Request declined or timed out' } });
          }).catch(error => this.fail(error));
        } else if (message.id !== undefined) {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
          else request.resolve(message.result);
        } else if (message.method) this.emit('notification', message);
      } catch (error) { this.fail(error); this.terminate(); }
    });
  }

  write(message) {
    if (this.closed) throw new Error('App Server is closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(new Error('App Server is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timeout; execution state may be unknown, do not blindly retry`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: { name: 'feishu_codex_bridge', title: 'Feishu Codex Bridge', version: '0.0.1' },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: 'initialized', params: {} });
    return result;
  }

  async interrupt(threadId, turnId) {
    // turn/start may acknowledge before the runtime installs its active-turn handle.
    for (let attempt = 0; attempt < 10; attempt++) {
      try { return await this.request('turn/interrupt', { threadId, turnId }); }
      catch (error) {
        if (!error.message.includes('no active turn to interrupt')) throw error;
        // A newly created rollout can also be empty until its first flush.
        const result = await this.request('thread/read', { threadId, includeTurns: true }).catch(() => null);
        const turn = result?.thread.turns.find(t => t.id === turnId);
        if (turn && ['completed','failed','interrupted'].includes(turn.status)) return {};
        if (attempt === 9) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  async turn(threadId, text, timeoutMs = 120_000, onStarted = () => {}) {
    if (this.active) throw new Error('One active turn per client');
    this.active = true;
    let onEvent, onClose, timer, expectedTurnId, earlyCompletion, complete;
    // Subscribe before turn/start: completion can arrive before its response.
    const completion = new Promise((resolve, reject) => {
      complete = resolve;
      onEvent = event => {
        if (event.method !== 'turn/completed' || event.params?.threadId !== threadId) return;
        if (!expectedTurnId) earlyCompletion = event.params.turn;
        else if (event.params.turn.id === expectedTurnId) resolve(event.params.turn);
      };
      onClose = reject;
      this.on('notification', onEvent);
      this.on('closed', onClose);
      timer = setTimeout(() => reject(new Error('Turn timed out; inspect its state before retrying')), timeoutMs);
    });
    completion.catch(() => {});
    try {
      const started = await this.request('turn/start', { threadId, input: typeof text === 'string' ? [{ type: 'text', text, text_elements: [] }] : text });
      expectedTurnId = started.turn?.id;
      if (!expectedTurnId) throw new Error('turn/start returned no turn ID');
      await onStarted(expectedTurnId);
      if (earlyCompletion?.id === expectedTurnId) complete(earlyCompletion);
      return await completion;
    } finally {
      clearTimeout(timer);
      this.off('notification', onEvent);
      this.off('closed', onClose);
      this.active = false;
    }
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.emit('closed', error);
  }

  async close() {
    this.child.stdin.end();
    const timer = setTimeout(() => this.terminate(), 3000);
    await this.processClosed;
    clearTimeout(timer);
    this.lines.close();
  }

  terminate() {
    if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) return;
    // The npm launcher owns a native Codex child; terminate only this owned process tree.
    if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else this.child.kill();
  }
}
