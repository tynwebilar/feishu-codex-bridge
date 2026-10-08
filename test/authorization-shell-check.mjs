// Run explicitly on Windows with the installed Codex dependency.
import assert from 'node:assert/strict';
import {AppServer} from '../src/app-server.mjs';
import {cliEnvironment,cliShellOverride} from '../src/authorization.mjs';
const server=new AppServer(process.execPath,['node_modules/@openai/codex/bin/codex.js','-c','shell_environment_policy.inherit="core"','-c',cliShellOverride(),'app-server'],{env:cliEnvironment()});
try{await server.initialize();const result=await server.request('command/exec',{command:['powershell.exe','-NoProfile','-Command','[Console]::Write($env:LARKSUITE_CLI_CONFIG_DIR)'],cwd:process.cwd(),timeoutMs:15000});assert.equal(result.stdout.trim(),cliEnvironment().LARKSUITE_CLI_CONFIG_DIR);console.log('PASS: core inheritance retains the explicit bridge CLI directory');}finally{await server.close()}
