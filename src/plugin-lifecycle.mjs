import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppServer } from './app-server.mjs';

export const pluginIdentity = { id:'feishu-codex-bridge@created-by-me-remote', remotePluginId:'plugins_6ac6fb06e0e881919330d1c155d2010a' };
const digest = value => createHash('sha256').update(value).digest('hex');
export async function observePlugin(codex, identity=pluginIdentity) {
  const before=await codex.request('account/read',{},8000);
  const detail=await codex.request('plugin/read',{pluginName:identity.remotePluginId,remoteMarketplaceName:(identity.id || pluginIdentity.id).split('@')[1]},10000);
  const after=await codex.request('account/read',{},8000);
  const account=a=>a?.account?.type==='chatgpt' && a.account.email ? digest(a.account.type+':'+a.account.email) : null;
  const accountHash=account(before);
  if (!accountHash || accountHash!==account(after)) return {state:'unknown'};
  const plugin=detail?.plugin?.summary;
  if(!plugin || (identity.id && plugin.id!==identity.id) || plugin.remotePluginId!==identity.remotePluginId || typeof plugin.installed!=='boolean') return {state:'unknown'};
  // enabled=false means disabled, not uninstalled. Missing catalog entries aren't evidence.
  return {state:plugin.installed?'installed':'removed',accountHash,id:plugin.id};
}
export class RemovalGuard {
  constructor(binding) { this.binding=binding;this.since=null;this.count=0;this.status='checking'; }
  accept(observation,now=Date.now()) {
    if (observation.accountHash!==this.binding.accountHash || observation.state==='unknown') {
      this.since=null;this.count=0;this.status='unavailable';return false;
    }
    if(observation.state==='installed') {this.since=null;this.count=0;this.status='watching';return false;}
    if(observation.state!=='removed') {this.since=null;this.count=0;this.status='unavailable';return false;}
    this.since??=now;this.count++;this.status='confirming_removal';
    return this.count>=3 && now-this.since>=60000;
  }
}
export async function loadRemovalGuard(data) {
  try {
    const b=JSON.parse(await readFile(join(data,'plugin-lifecycle.json'),'utf8'));
    if(b.version!==1 || typeof b.id!=='string' || !b.id.startsWith('feishu-codex-bridge@') || b.remotePluginId!==pluginIdentity.remotePluginId || !/^[a-f0-9]{64}$/.test(b.accountHash)) return null;
    return new RemovalGuard(b);
  }catch{return null;}
}
// ponytail: poll the native catalog until an official uninstall callback is available.
// Only explicit, stable removed results are actionable; no cache-directory watcher.
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const data=process.argv[2];
  if(!data) throw new Error('Data directory required');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const mode=await readFile(join(root,'lifecycle-mode.json'),'utf8').then(JSON.parse,()=>null);
  if(mode?.mode==='manual') {
    await mkdir(data,{recursive:true});
    await writeFile(join(data,'plugin-lifecycle.json'),JSON.stringify({version:1,mode:'manual'}));
    console.log('Manual lifecycle: run bridge_uninstall before removing the Git/local plugin.');
    process.exit(0);
  }
  const codex=new AppServer(process.execPath,[join(root,'node_modules/@openai/codex/bin/codex.js'),'app-server']);
  try {
    await codex.initialize();const observation=await observePlugin(codex,{remotePluginId:pluginIdentity.remotePluginId});
    if(observation.state!=='installed') throw new Error('Plugin installation could not be confirmed');
    await mkdir(data,{recursive:true});
    await writeFile(join(data,'plugin-lifecycle.json'),JSON.stringify({version:1,...pluginIdentity,id:observation.id,accountHash:observation.accountHash}));
    console.log('Plugin removal detection enrolled.');
  }catch {console.error('Plugin removal detection unavailable; installation and account must be verifiable.');process.exitCode=1;}
  finally {await codex.close();}
}
