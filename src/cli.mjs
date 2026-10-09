#!/usr/bin/env node
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { dataDir, loadConfig, saveConfig, protect, UserError } from './config.mjs';
import { AppServer } from './app-server.mjs';
import { connectFeishu } from './feishu.mjs';
import { listWorkspaceProjects, resolveProjectBinding } from './projects.mjs';
import { Store } from './store.mjs';
import { Bridge } from './bridge.mjs';
import { parseEvent } from './messages.mjs';
import { loadRemovalGuard, observePlugin } from './plugin-lifecycle.mjs';
import { scanApp } from './onboarding.mjs';
import { cliEnvironment, cliShellOverride, cliPath, ensureCli } from './authorization.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const statusPath = join(dataDir, 'status.json');
const stopPath = join(dataDir, 'stop.request');
const command = process.argv[2] ?? 'help';
async function requireStopped() {
  const status = await readFile(statusPath, 'utf8').then(JSON.parse, () => null);
  if (status && !status.stopped && Date.now() - Date.parse(status.updatedAt) < 10_000) throw new UserError('请先停止桥接，再修改配置。');
}
async function setup() {
  await requireStopped();
  if (!process.stdin.isTTY) throw new UserError('请在本机终端运行 setup，密钥不会回显。');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const previous = await readFile(join(dataDir, 'config.json'), 'utf8').then(JSON.parse, () => null);
    if(previous) throw new UserError('已有配置，初始化不会覆盖配对和群设置。新应用请使用独立 FEISHU_CODEX_HOME。');
    const mode=(await rl.question('1 使用已有应用（默认）  2 扫码创建新机器人：')).trim() || '1';
    if(!['1','2'].includes(mode)) throw new UserError('选择无效。');
    let created;
    if(mode==='2') created=await scanApp();
    const appId = created?.client_id ?? (await rl.question('飞书 App ID：')).trim();
    let secret=created?.client_secret;
    if(!secret) {
      process.stdout.write('飞书 App Secret（隐藏输入）：'); muted = true;
      secret = (await rl.question('')).trim(); muted = false; process.stdout.write('\n');
    }
    const cwd = resolve((await rl.question('工作区绝对路径：')).trim());
    console.log('工作区目录不等于桌面项目。请在 Codex 中添加该目录，再使用 project 命令选择已有项目；不会自动创建后台项目。');
    const cliUserEnabled=(await rl.question('启用个人飞书资源访问？将在独立 CLI 配置中绑定此应用，具体权限仍需卡片授权。输入 Y 启用（默认不启用）：')).trim().toUpperCase()==='Y';
    if(cliUserEnabled) cliPath();
    console.log('权限：1 只读（默认）  2 可写工作区  3 完全访问本机');
    const choice = (await rl.question('选择 1/2/3：')).trim() || '1';
    if (!['1','2','3'].includes(choice)) throw new UserError('权限选择无效。');
    if (choice === '3' && await rl.question('完全访问仅应供你本人使用。输入 FULL 确认：') !== 'FULL') throw new UserError('未确认完全访问。');
    const config = { version: 1, appId, cwd, cliUserEnabled, secretDpapi: await protect(secret), ownerId: '', groups: [],
      sandbox: { 1: 'read-only', 2: 'workspace-write', 3: 'danger-full-access' }[choice] };
    await saveConfig(config);
    console.log('配置已加密保存。运行 serve --pair 并按提示私聊机器人。');
  } finally { rl.close(); }
}
async function groups() {
  await requireStopped();
  const config = await loadConfig();
  const feishu = await connectFeishu(config);
  const chats = [];
  let pageToken;
  try {
    do {
      const page = await feishu.client.im.chat.list({ params: { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) } });
      if (page.code !== 0) throw new UserError('无法读取机器人所在群。请确认已将机器人加入群，并授予读取群列表权限。');
      chats.push(...page.data?.items ?? []);
      pageToken = page.data?.has_more ? page.data.page_token : null;
    } while (pageToken && chats.length < 1000);
    if (!chats.length) throw new UserError('机器人还未加入可用群，请先在飞书中将机器人加入测试群。');
    if (!process.stdin.isTTY) throw new UserError('请在本机终端配置群白名单。');
    chats.forEach((chat, i) => console.log(`${i + 1}. ${String(chat.name).replace(/[\x00-\x1f\x7f]/g, ' ')} (${chat.chat_id})`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question('允许使用的群编号（逗号分隔，留空关闭群聊）：')).trim();
      const indexes = answer ? answer.split(',').map(x => Number(x.trim()) - 1) : [];
      if (indexes.some(i => !Number.isInteger(i) || !chats[i])) throw new UserError('群编号无效，未保存。');
      config.groups = [...new Set(indexes.map(i => chats[i].chat_id))];
      await saveConfig(config);
      console.log('群白名单已保存，重新启动后生效。只有已配对主人 @ 机器人才能触发任务。');
    } finally { rl.close(); }
  } finally { feishu.close(); }
}
async function resolveUnknown() {
  await requireStopped();
  if (!process.stdin.isTTY) throw new UserError('请在本机终端核对未知任务。');
  const config = await loadConfig();
  const store = new Store(join(dataDir, 'bridge.sqlite'));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    store.assertAccount(config.appId);
    const rows = store.db.prepare("SELECT * FROM inbox WHERE state='unknown' ORDER BY created").all();
    if (!rows.length) { console.log('没有状态未知的执行任务。'); return; }
    rows.forEach((row, i) => console.log(`${i + 1}. ${new Date(row.created).toLocaleString()}  消息 ${row.id}  Codex ${row.thread ?? '未取得 ID'}`));
    const index = Number(await rl.question('选择已在 Codex 中核对过的任务编号（0 退出）：')) - 1;
    if (index === -1) return;
    const row = rows[index];
    if (!row) throw new UserError('编号无效。');
    const confirm = await rl.question('请先确认 Codex 中该任务已结束或已停止。此操作不重跑原任务，并取消本聊天后续排队消息。输入 RESOLVED 确认：');
    if (confirm !== 'RESOLVED') return;
    store.transaction(() => {
      store.set(row.id, 'resolved', { error: `confirmed-by-local-owner:${new Date().toISOString()}` });
      store.enqueue(row.id, JSON.parse(row.payload), '本机主人已核对并关闭此前状态未知的任务；未重跑，后续排队消息已取消。', 'resolution');
      for (const queued of store.db.prepare("SELECT * FROM inbox WHERE chat=? AND state='queued'").all(row.chat)) {
        store.set(queued.id, 'cancelled');
        store.enqueue(queued.id, JSON.parse(queued.payload), '人工核对后已取消此排队消息，未启动执行。', 'cancelled');
      }
    });
    console.log('已记录人工核对。重新启动桥接后可接收新消息。');
  } finally { rl.close(); store.close(); }
}
async function selectProject() {
  await requireStopped();
  const config = await loadConfig();
  const client = new AppServer(process.execPath, [join(root, 'node_modules/@openai/codex/bin/codex.js'), 'app-server']);
  let rl;
  try {
    await client.initialize();
    const projects = await listWorkspaceProjects(client, config.cwd);
    if (!projects.length) throw new UserError('没有匹配工作目录的后台项目。请先在 Codex 桌面添加该目录，再重试；不会自动创建重复项目。');
    let id = process.argv[3];
    if (!id) {
      if (!process.stdin.isTTY) throw new UserError('请在本机终端运行 project 选择项目，或传入已核实的后台项目 ID。');
      projects.forEach((p, i) => console.log(`${i + 1}. ${p.name} (${p.id})`));
      rl = createInterface({ input: process.stdin, output: process.stdout });
      const choice = (await rl.question('选择与桌面目标项目对应的编号：')).trim();
      if (!/^[1-9][0-9]*$/.test(choice)) throw new UserError('项目选择无效。');
      id = projects[Number(choice) - 1]?.id;
    }
    if (!projects.some(p => p.id === id)) throw new UserError('项目不匹配当前工作目录，未修改配置。');
    await saveConfig({ ...config, projectId: id });
    console.log('已保存后台项目选择，仅影响后续新会话。桌面归组尚未验证；已有会话请右键“移动到项目”，并在项目下确认显示。');
  } finally { rl?.close(); await client.close(); }
}
async function serve() {
  const config = await loadConfig();
  const pairing = process.argv.includes('--pair');
  if (!config.ownerId && !pairing) throw new UserError('尚未配对主人，请先运行 serve --pair。');
  if (config.ownerId && pairing) throw new UserError('已配对主人；如需更换，请停止服务后重新 setup。');
  const key = createHash('sha256').update(config.appId).digest('hex').slice(0, 24);
  const lock = createServer(socket => socket.destroy());
  await new Promise((resolveLock, reject) => {
    lock.once('error', () => reject(new UserError('此应用已有桥接进程，不能重复启动。')));
    lock.listen(`\\\\.\\pipe\\feishu-codex-${key}`, resolveLock);
  });
  await mkdir(dataDir, { recursive: true });
  await rm(stopPath, { force: true });
  let feishu, codex, store, timer, stopping = false;
  try {
    const cliStatus=await ensureCli(config).catch(error=>({state:'unavailable',message:error instanceof UserError ? error.message : 'CLI 初始化未完成。'}));
    feishu = await connectFeishu(config);
    config.botId = feishu.botId;
    const env = cliEnvironment(); delete env.FEISHU_APP_SECRET; env.FEISHU_BRIDGE_REMOTE='1';
    codex = new AppServer(process.execPath, [join(root, 'node_modules/@openai/codex/bin/codex.js'), '-c', cliShellOverride(), 'app-server'], { env });
    await codex.initialize();
    const projectBinding = await resolveProjectBinding(codex, config.cwd, config.projectId);
    const { projectId } = projectBinding;
    store = new Store(join(dataDir, 'bridge.sqlite'));
    store.assertAccount(config.appId);
    const bridge = new Bridge(config, store, codex, feishu, projectId);
    await bridge.recover();
    for (const chat of store.db.prepare("SELECT DISTINCT chat FROM inbox WHERE state='unknown'").all()) await bridge.recover(store.unknown(chat.chat));
    await bridge.claimThreads();
    const code = pairing ? randomBytes(12).toString('hex') : '';
    const expires = Date.now() + 10 * 60_000;
    if (pairing) console.log(`请在 10 分钟内私聊机器人“${feishu.name}”发送：/pair ${code}`);
    let pairingBusy = false;
    await feishu.start(async event => {
      if (stopping) throw new UserError('Stopping');
      if (!config.ownerId) {
        const m = event.message, sender = event.sender;
        if (pairingBusy || Date.now() > expires || sender?.sender_type !== 'user' || m?.chat_type !== 'p2p' || m.message_type !== 'text' || !/^ou_[a-zA-Z0-9]+$/.test(sender.sender_id?.open_id ?? '')) return;
        let text; try { text = JSON.parse(m.content).text; } catch { return; }
        if (text !== `/pair ${code}`) return;
        pairingBusy = true;
        const candidate = { ...config, ownerId: sender.sender_id.open_id };
        const message = parseEvent(event, candidate);
        if (!message) { pairingBusy = false; return; }
        try {
          await saveConfig(candidate);
          config.ownerId = candidate.ownerId;
          message.text = '/pair [redacted]';
          store.accept(message);
          store.finish(store.get(message.id), '配对成功。现在可以直接对话。发送 /help 查看命令；当前权限由本机配置决定。');
          console.log('主人配对成功。');
        } finally { pairingBusy = false; }
        return;
      }
      bridge.receive(event);
    });
    const removalGuard=process.env.FEISHU_BRIDGE_SUPERVISED==='1' ? await loadRemovalGuard(dataDir) : null;
    let lifecycleBusy=false, lastLifecycleCheck=0, removedByPlugin=false;
    const checkLifecycle=async()=>{
      if(!removalGuard || lifecycleBusy || stopping || Date.now()-lastLifecycleCheck<30000) return;
      lifecycleBusy=true;lastLifecycleCheck=Date.now();
      try {
        const observation=await observePlugin(codex,removalGuard.binding).catch(()=>({state:'unknown'}));
        if(removalGuard.accept(observation) && !stopping) {removedByPlugin=true;stopping=true;}
      }finally{lifecycleBusy=false;}
    };
    let ticking = false;
    const tick = async () => {
      if (ticking || stopping) return;
      ticking = true;
      try {
        if (await readFile(stopPath, 'utf8').then(() => true, () => false)) { stopping = true; return; }
        void checkLifecycle();
        void bridge.work().catch(() => { stopping = true; });
        void bridge.deliver().catch(() => { stopping = true; });
        const status = { updatedAt: new Date().toISOString(), pid: process.pid, appId: config.appId,
          cli:cliStatus,
          sharedRules:bridge.sharedRules.status,
          feishu: feishu.status(), codex: codex.closed ? 'disconnected' : 'connected',
          paired: !!config.ownerId, active: !!bridge.active, ownershipConflicts: bridge.ownershipConflicts,
          pluginLifecycle:removalGuard?.status ?? 'not_enrolled',
          pausedForUnknownExecution: bridge.uncertain ?? null, projectId, projectBinding, counts: store.stats() };
        await writeFile(statusPath + '.tmp', JSON.stringify(status, null, 2));
        await rename(statusPath + '.tmp', statusPath);
        if (codex.closed) stopping = true;
      } finally { ticking = false; }
    };
    timer = setInterval(() => { tick().catch(() => { stopping = true; }); }, 500);
    await tick();
    process.once('SIGINT', () => { stopping = true; });
    process.once('SIGTERM', () => { stopping = true; });
    console.log('桥接进程已启动。连接是否就绪请查看 status。');
    while (!stopping) await new Promise(resolveWait => setTimeout(resolveWait, 500));
    clearInterval(timer);
    feishu.close();
    bridge.authorization?.abort();
    // Mark uncertain work on next startup; never replay a turn merely because shutdown cut it off.
    if (bridge.active?.turn) await codex.interrupt(bridge.active.thread, bridge.active.turn).catch(() => {});
    for (const q of bridge.questions.values()) q.reject();
    await codex.close();
    while (bridge.active || bridge.delivering || ticking) await new Promise(r => setTimeout(r, 100));
    await bridge.clearReactions();
    if(removedByPlugin) process.exitCode=42;
  } finally {
    clearInterval(timer);
    feishu?.close();
    await codex?.close();
    store?.close();
    lock.close();
    await writeFile(statusPath, JSON.stringify({ updatedAt: new Date().toISOString(), stopped: true }));
    await rm(stopPath, { force: true });
  }
}
try {
  if (command === 'setup') await setup();
  else if (command === 'project') await selectProject();
  else if (command === 'groups') await groups();
  else if (command === 'resolve') await resolveUnknown();
  else if (command === 'serve') await serve();
  else if (command === 'stop') { await mkdir(dataDir, { recursive: true }); await writeFile(stopPath, 'stop'); console.log('已请求停止；用 status 确认终态。'); }
  else if (command === 'status') {
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    console.log(JSON.stringify({ ...status, stale: Date.now() - Date.parse(status.updatedAt) > 10_000 }, null, 2));
  } else if (command === 'doctor') {
    const config = await loadConfig();
    const f = await connectFeishu(config);
    console.log(JSON.stringify({ appId: config.appId, bot: f.name, credentials: 'ok', paired: !!config.ownerId, cwd: config.cwd, sandbox: config.sandbox }, null, 2));
    f.close();
  } else console.log('Feishu Codex Bridge (开发预览)\nsetup 配置\nproject [项目ID] 选择已有后台项目（需停止服务）\ngroups 群白名单\nresolve 本机核对未知任务\nserve [--pair] 启动/首次配对\nstatus 状态\nstop 停止\ndoctor 检查配置和飞书身份');
} catch (error) {
  console.error(error instanceof UserError ? error.message : error.code === 'ENOENT'
    ? '未找到配置、工作区或状态文件。首次使用请打开 Start.cmd 选择“配置”。'
    : '操作失败。检查应用权限、网络或 Codex 登录。打开 Start.cmd 选择“诊断”；原始错误不会直接输出，以免泄露凭据。');
  process.exitCode = 1;
}
