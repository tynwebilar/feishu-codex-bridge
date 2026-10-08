import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('management MCP discovers tools, redacts status, validates input and stops only selected profile', { skip: process.platform !== 'win32' }, async () => {
  const data = await mkdtemp(join(tmpdir(), 'bridge-mcp-'));
  await writeFile(join(data, 'status.json'), JSON.stringify({updatedAt:new Date().toISOString(),stopped:true,secret:'MUST_NOT_LEAK',projectBinding:{projectId:'p1',state:'backend_selected',desktopVisibility:'unverified',secret:'MUST_NOT_LEAK'}}));
  const child = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('src/management-mcp.ps1')], {windowsHide:true});
  let next = 0, stderr = '';
  child.stderr.on('data', x => stderr += x);
  const pending = new Map();
  const lines = createInterface({input:child.stdout});
  lines.on('line', line => { const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id); });
  const call = (method, params={}) => new Promise((done,reject) => {
    const id=++next;const timer=setTimeout(()=>reject(new Error('MCP timeout '+stderr)),10000);
    pending.set(id,r=>{clearTimeout(timer);done(r);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  try {
    assert.equal((await call('initialize',{protocolVersion:'2024-11-05'})).result.serverInfo.name,'feishu-bridge-management');
    const list=(await call('tools/list')).result.tools;
    assert.equal(list.length,7);
    await writeFile(join(data,'config.json'),JSON.stringify({version:1,appId:'cli_0123456789abcdef',ownerId:'ou_owner',secretDpapi:'fixture',groups:[],cwd:resolve('.'),sandbox:'read-only'}));
    const args={dataDirectory:data,runtimePath:resolve('.')};
    const before=(await call('tools/call',{name:'bridge_permissions_get',arguments:args})).result.structuredContent;
    const permissions={groupContext:'shared',groups:[{chatId:'oc_test',enabled:true,requireMention:false,senderIds:['ou_owner'],trustedLocalAccess:false}]};
    const changed=await call('tools/call',{name:'bridge_permissions_set',arguments:{...args,permissions,expectedRevision:before.revision}});
    assert.equal(changed.result.isError,false);assert.equal(changed.result.structuredContent.restartRequired,true);
    assert.equal((await call('tools/call',{name:'bridge_permissions_set',arguments:{...args,permissions,expectedRevision:before.revision}})).result.isError,true);
    assert.equal(JSON.parse(await readFile(join(data,'config.json'),'utf8')).secretDpapi,'fixture');
    const lock=createServer(socket=>socket.destroy());
    const key=createHash('sha256').update('cli_0123456789abcdef').digest('hex').slice(0,24);
    await new Promise(r=>lock.listen(`\\\\.\\pipe\\feishu-codex-${key}`,r));
    try {
      const blocked=await call('tools/call',{name:'bridge_permissions_set',arguments:{...args,permissions,expectedRevision:changed.result.structuredContent.revision}});
      assert.equal(blocked.result.content[0].text,'STOP_REQUIRED');
    }finally{await new Promise(r=>lock.close(r));}


    const status=await call('tools/call',{name:'bridge_status',arguments:{dataDirectory:data}});
    assert.equal(status.result.structuredContent.stopped,true);
    assert.deepEqual(status.result.structuredContent.projectBinding,{projectId:'p1',state:'backend_selected',desktopVisibility:'unverified'});
    assert.ok(!JSON.stringify(status).includes('MUST_NOT_LEAK'));
    assert.equal((await call('tools/call',{name:'bridge_stop',arguments:{dataDirectory:data,command:'bad'}})).result.isError,true);
    assert.equal((await call('tools/call',{name:'bridge_stop',arguments:{dataDirectory:data}})).result.isError,false);
    assert.equal(await readFile(join(data,'stop.request'),'utf8'),'stop');
    assert.equal((await call('tools/call',{name:'bridge_start',arguments:{runtimePath:'relative'}})).result.isError,true);
  } finally { child.stdin.end(); await new Promise(r=>child.once('exit',r));lines.close(); }
});
