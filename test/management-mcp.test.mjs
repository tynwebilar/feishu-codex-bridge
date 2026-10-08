import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('management MCP discovers tools, redacts status, validates input and stops only selected profile', { skip: process.platform !== 'win32' }, async () => {
  const data = await mkdtemp(join(tmpdir(), 'bridge-mcp-'));
  await writeFile(join(data, 'status.json'), JSON.stringify({updatedAt:new Date().toISOString(),stopped:true,secret:'MUST_NOT_LEAK'}));
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
    assert.equal(list.length,5);
    const status=await call('tools/call',{name:'bridge_status',arguments:{dataDirectory:data}});
    assert.equal(status.result.structuredContent.stopped,true);
    assert.ok(!JSON.stringify(status).includes('MUST_NOT_LEAK'));
    assert.equal((await call('tools/call',{name:'bridge_stop',arguments:{dataDirectory:data,command:'bad'}})).result.isError,true);
    assert.equal((await call('tools/call',{name:'bridge_stop',arguments:{dataDirectory:data}})).result.isError,false);
    assert.equal(await readFile(join(data,'stop.request'),'utf8'),'stop');
    assert.equal((await call('tools/call',{name:'bridge_start',arguments:{runtimePath:'relative'}})).result.isError,true);
  } finally { child.stdin.end(); await new Promise(r=>child.once('exit',r));lines.close(); }
});
