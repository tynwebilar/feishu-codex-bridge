import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, linkSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { parseEvent, chunks, answerText } from '../src/messages.mjs';
import { Bridge } from '../src/bridge.mjs';
import { attachmentRoot, snapshotOutput, byteLimit, prepareInput } from '../src/attachments.mjs';
import { sendFile, deliveryFailure, typingReaction } from '../src/feishu.mjs';

test('typing reaction uses original message and failures do not block replies', async () => {
  const calls = [];
  const client = { im: { messageReaction: {
    create: async p => { calls.push(p); return {code:0,data:{reaction_id:'reaction1'}}; },
    delete: async p => { calls.push(p); return {code:0}; },
  } } };
  assert.equal(await typingReaction(client,'om_1'), 'reaction1');
  await typingReaction(client,'om_1','reaction1');
  assert.equal(calls[0].data.reaction_type.emoji_type,'Typing');
  assert.deepEqual(calls[1].path,{message_id:'om_1',reaction_id:'reaction1'});
  client.im.messageReaction.create=async()=>{throw new Error('permission denied');};
  assert.equal(await typingReaction(client,'om_1'),null);
});

test('delivery diagnostics redact secrets and retries retain UUID, deadline and chat isolation', () => {
  const db = new Store(':memory:');
  try {
    const failure = deliveryFailure({ response: { status: 400, data: { code: 99991672, msg: 'SECRET' }, headers: { authorization: 'SECRET' } } });
    assert.equal(failure.code, 99991672);
    assert.ok(!JSON.stringify(failure).includes('SECRET'));
    assert.equal(deliveryFailure({ code: 'SECRET' }).code, null);
    for (const id of ['recent','expired','foreign']) {
      const m = { id, chat: id === 'foreign' ? 'other-chat' : 'chat', chatId: 'oc_test' };
      db.accept(m); db.enqueue(id, m, 'answer');
      const row = db.db.prepare('SELECT * FROM outbox WHERE source=?').get(id);
      db.sending(row); db.retry({ ...row, attempt: 8 }, failure);
    }
    db.db.prepare('UPDATE outbox SET first_attempt=? WHERE source=?').run(Date.now() - 46 * 60_000, 'expired');
    const before = db.db.prepare("SELECT * FROM outbox WHERE source='recent'").get();
    assert.equal(db.deliveryErrors('chat').length, 2);
    assert.equal(db.retryDeliveries('chat'), 1);
    const after = db.delivery();
    assert.equal(after.source, 'recent');
    assert.equal(JSON.parse(after.payload).uuid, JSON.parse(before.payload).uuid);
    assert.equal(after.first_attempt, before.first_attempt);
    assert.equal(db.db.prepare("SELECT state FROM outbox WHERE source='expired'").get().state, 'unknown');
    assert.equal(db.db.prepare("SELECT state FROM outbox WHERE source='foreign'").get().state, 'unknown');
    db.delivered(after.id, 'om_done');
    assert.equal(db.deliveryErrors('chat').length, 1);
  } finally { db.close(); }
});

test('file delivery accepts the SDK unwrapped upload result and preserves reply UUID', async () => {
  let upload = { file_key: 'file_test' }, replies = 0;
  const client = { im: { file: { create: async ({ data }) => {
    for await (const chunk of data.file) assert.ok(chunk.length);
    return upload;
  } }, message: { reply: async ({ path, data }) => {
    replies++;
    assert.equal(path.message_id, 'om_test');
    assert.equal(data.uuid, 'stable-uuid');
    assert.deepEqual(JSON.parse(data.content), { file_key: 'file_test' });
    assert.equal(data.msg_type, 'file');
    return { code: 0, data: { message_id: 'om_sent' } };
  } } } };
  const payload = { replyTo: 'om_test', uuid: 'stable-uuid', file: { path: new URL('../package.json', import.meta.url), name: 'test.json' } };
  assert.equal(await sendFile(client, payload), 'om_sent');
  upload = null;
  await assert.rejects(sendFile(client, payload), /文件上传失败/);
  assert.equal(replies, 1);
});

test('uncertain runtime execution pauses sibling chats until terminal recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-uncertain-'));
  const db = new Store(':memory:');
  let starts = 0, terminal = false;
  const codex = {
    request: async method => method === 'thread/read'
      ? { thread: { turns: [{ id: 'turn1', status: terminal ? 'completed' : 'inProgress', items: [] }] } }
      : { thread: { id: 'thread1' } },
    turn: async (thread, input, timeout, started) => { starts++; await started('turn1'); throw Error('lost completion'); },
  };
  const cfg = { appId:'cli_test', ownerId:'ou_owner', botId:'ou_bot', groups:[], cwd:dir, sandbox:'read-only' };
  const bridge = new Bridge(cfg, db, codex, {}, 'project1');
  const msg = (id, chatId) => ({ id, chatId, chat:JSON.stringify(['cli_test','p2p',chatId,'ou_owner','']), text:'test', attachments:[], title:'test' });
  try {
    const first = msg('om_one','oc_one'); db.accept(first);
    db.accept(msg('om_two','oc_two'));
    await bridge.work(); await bridge.work();
    assert.equal(starts, 1);
    assert.equal(db.get('om_two').state, 'queued');
    await bridge.recover(db.unknown(first.chat));
    assert.equal(bridge.uncertain, first.id);
    terminal = true;
    await bridge.recover(db.unknown(first.chat));
    assert.equal(bridge.uncertain, null);
    assert.equal(db.get(first.id).state, 'completed');
    assert.equal(starts, 1); // Recovery must not replay the model.
    await bridge.work();
    assert.equal(starts, 2);
  } finally { db.close(); rmSync(dir, { recursive:true, force:true }); }
});

test('identity and mention gates, durable dedupe, unknown execution blocks its chat', () => {
  const cfg = { appId: 'cli_test', ownerId: 'ou_owner', botId: 'ou_bot', groups: ['oc_group'] };
  const event = { sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
    message: { message_id: 'om_1', chat_id: 'oc_private', chat_type: 'p2p', message_type: 'text', content: '{"text":"hello"}' } };
  const m = parseEvent(event, cfg);
  assert.equal(m.text, 'hello');
  assert.equal(parseEvent({ ...event, sender: { sender_type: 'app' } }, cfg), null);
  assert.equal(parseEvent({ ...event, sender: { sender_type: 'user', sender_id: { open_id: 'ou_other' } } }, cfg), null);
  const group = { ...event, message: { ...event.message, chat_id: 'oc_group', chat_type: 'group' } };
  assert.equal(parseEvent(group, cfg), null);
  group.message.mentions = [{ id: { open_id: 'ou_bot' }, key: '@bot' }];
  assert.notEqual(parseEvent(group, cfg).chat, m.chat);
  const dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  let db = new Store(join(dir, 'state.sqlite'));
  try {
    assert.equal(db.accept(m), 'queued');
    assert.equal(db.accept(m), 'duplicate');
    db.set(m.id, 'running', { thread: 't1', turn: 'r1' });
    db.close(); db = new Store(join(dir, 'state.sqlite'));
    assert.equal(db.accept(m), 'duplicate');
    assert.equal(db.interrupted().length, 1);
    db.set(m.id, 'unknown');
    db.accept({ ...m, id: 'om_2' });
    assert.equal(db.next(), undefined);
    db.accept({ ...m, id: 'om_3', chat: 'another' });
    assert.equal(db.next().id, 'om_3');
    db.finish(db.get('om_3'), 'done'); db.finish(db.get('om_3'), 'done');
    assert.equal(db.stats().outbox[0].count, 1);
    const out = db.delivery(); db.sending(out); db.retry({ ...out, attempt: 9 });
    assert.equal(db.delivery(), undefined);
    assert.equal(db.stats().outbox[0].state, 'unknown');
    assert.equal(chunks('😀'.repeat(3000)).join(''), '😀'.repeat(3000));
    assert.equal(answerText({ status: 'completed', items: [{type:'agentMessage',phase:'commentary',text:'private'}, {type:'agentMessage',phase:'final_answer',text:'answer'}] }), 'answer');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('attachments cap streams and prevent cross-chat/path/link exports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-files-'));
  try {
    const outgoing = join(attachmentRoot(dir, 'chat1'), 'outgoing');
    mkdirSync(outgoing, { recursive: true });
    const safe = join(outgoing, 'report.txt'); writeFileSync(safe, 'report');
    const copied = await snapshotOutput(dir, 'chat1', safe, join(dir, 'spool'));
    assert.equal(readFileSync(copied.path, 'utf8'), 'report');
    const outside = join(dir, 'private.txt'); writeFileSync(outside, 'private');
    await assert.rejects(snapshotOutput(dir, 'chat1', outside, join(dir, 'spool')), /当前聊天/);
    await assert.rejects(snapshotOutput(dir, 'chat2', safe, join(dir, 'spool')));
    const link = join(outgoing, 'link.txt'); linkSync(outside, link);
    await assert.rejects(snapshotOutput(dir, 'chat1', link, join(dir, 'spool')), /硬链接/);
    await assert.rejects(pipeline(Readable.from([Buffer.alloc(20)]), byteLimit(10), new Writable({ write(c,e,done) { done(); } })), /大小上限/);
    const client = { im: { messageResource: { get: async () => ({ getReadableStream: () => Readable.from([Buffer.from('not-an-image')]) }) } } };
    await assert.rejects(prepareInput(client, dir, { id:'om_test', chat:'chat1', text:'', attachments:[{type:'image',key:'img_test'}] }), /图片格式/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test('bridge resumes the same thread, controls bypass the queue and recovery never re-executes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-engine-'));
  const db = new Store(join(dir, 'state.sqlite'));
  const cfg = { appId: 'cli_test', ownerId: 'ou_owner', botId: 'ou_bot', groups: [], cwd: dir, sandbox: 'read-only' };
  const turns = [], calls = [];
  const codex = {
    async request(method, params) {
      calls.push([method, params]);
      if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread1' } };
      if (method === 'thread/read') return { thread: { turns } };
      return {};
    },
    async turn(thread, text, timeout, started) {
      const turn = { id: `turn${turns.length + 1}`, status: 'completed', items: [{ type: 'agentMessage', text: `reply:${text}` }] };
      started(turn.id); turns.push(turn); return turn;
    },
  };
  let deliveries = 0;
  const reactions=[];
  const feishu = { status: () => 'connected', send: async () => `sent${++deliveries}`,
    typing: async (id,reaction) => { reactions.push([id,reaction]); return reaction ? null : `reaction-${id}`; } };
  const bridge = new Bridge(cfg, db, codex, feishu, 'project1');
  const event = (id, text) => ({ sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
    message: { message_id: id, chat_id: 'oc_private', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } });
  try {
    bridge.receive(event('om_a', 'first')); bridge.receive(event('om_a', 'first'));
    bridge.receive(event('om_b', 'second'));
    assert.equal(db.delivery(),undefined); // No receipt/running messages to clutter the conversation.
    assert.equal(reactions.length,2); // Duplicate inbound delivery does not add another reaction.
    writeFileSync(join(dir,'AGENTS.md'),'SHARED_FIRST');
    await bridge.work();
    writeFileSync(join(dir,'AGENTS.md'),'SHARED_SECOND');
    await bridge.work();
    const injected=calls.filter(c=>c[0]==='thread/inject_items');
    assert.equal(injected.length,2);
    assert.match(injected[1][1].items[0].content[0].text,/SHARED_SECOND/);
    assert.equal(turns.length, 2);
    assert.equal(calls.filter(c => c[0] === 'thread/start').length, 1);
    assert.equal(calls.filter(c => c[0] === 'thread/resume').length, 1);
    assert.equal(calls.filter(c => c[0] === 'thread/unsubscribe').length, 0);
    assert.equal(calls.find(c => c[0] === 'thread/start')[1].projectId, 'project1');
    await bridge.claimThreads();
    assert.deepEqual(bridge.ownershipConflicts, []);
    assert.equal(calls.filter(c => c[0] === 'thread/resume').length, 2);
    while (db.delivery()) await bridge.deliver();
    await new Promise(r => setImmediate(r));
    assert.ok(reactions.some(([id,r])=>id==='om_a' && r==='reaction-om_a'));
    assert.equal(deliveries, 2); // Completed jobs supersede progress that was never sent.
    bridge.receive(event('om_c', 'third'));
    bridge.receive(event('om_stop', '/stop'));
    await new Promise(r => setImmediate(r));
    assert.equal(db.get('om_c').state, 'cancelled');
    const saved = db.get('om_a');
    db.set(saved.id, 'running');
    await bridge.recover();
    assert.equal(db.get(saved.id).state, 'completed');
    assert.equal(turns.length, 2);
    db.set(saved.id, 'starting', { turn: null });
    await bridge.recover();
    assert.equal(db.get(saved.id).state, 'unknown');
    bridge.receive(event('om_d', 'must wait'));
    await bridge.work(); assert.equal(turns.length, 2);
    bridge.active = { ...saved, thread: 'thread1', turn: 'turn1' };
    const response = bridge.ask({ method: 'item/tool/requestUserInput', params: {
      threadId: 'thread1', turnId: 'turn1', questions: [{ id: 'choice', question: 'Pick one', options: [] }],
    } });
    const questionId = [...bridge.questions.keys()][0];
    const foreign = event('om_foreign', `/answer ${questionId} wrong`); foreign.message.chat_id = 'oc_other';
    bridge.receive(foreign);
    await new Promise(r => setImmediate(r));
    assert.equal(bridge.questions.size, 1);
    bridge.receive(event('om_answer', `/answer ${questionId} correct`));
    assert.deepEqual(JSON.parse(JSON.stringify(await response)), { answers: { choice: { answers: ['correct'] } } });
    await assert.rejects(bridge.ask({ method: 'item/tool/requestUserInput', params: { threadId:'thread1',turnId:'old',questions:[] } }), /Stale/);
    await assert.rejects(bridge.ask({ method: 'item/commandExecution/requestApproval', params: {threadId:'thread1',turnId:'turn1'} }), /Unsupported/);
    bridge.active = null;
    db.assertAccount(cfg.appId);
    assert.throws(() => db.assertAccount('cli_other'), /another application/);
    cfg.ownerId = 'ou_new';
    const before = deliveries;
    await bridge.deliver();
    assert.equal(deliveries, before);
    assert.ok(db.stats().outbox.some(x => x.state === 'blocked'));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
