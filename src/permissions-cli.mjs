import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {loadConfig,saveConfig} from './config.mjs';
import {permissions,revision,validatePermissions} from './permissions.mjs';
let lock;
try {
 let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>100000)throw new Error('INVALID_PERMISSIONS');}
 const args=JSON.parse(raw),config=await loadConfig();
 if(args.operation==='get'){console.log(JSON.stringify({revision:revision(config),permissions:permissions(config),ownerId:config.ownerId,appId:config.appId}));}
 else if(args.operation==='set'){
  validatePermissions(args.permissions);
  if(args.permissions.groups.some(g=>(g.allowAllMembers || g.senderIds.some(id=>id!==config.ownerId))&&!g.trustedLocalAccess))throw new Error('TRUST_ACK_REQUIRED');
  lock=createServer(s=>s.destroy());
  const key=createHash('sha256').update(config.appId).digest('hex').slice(0,24);
  await new Promise((ok,no)=>{lock.once('error',()=>no(new Error('STOP_REQUIRED')));lock.listen(`\\\\.\\pipe\\feishu-codex-${key}`,ok);});
  const latest=await loadConfig();if(revision(latest)!==args.expectedRevision)throw new Error('REVISION_CONFLICT');
  const before=permissions(latest);latest.permissions=args.permissions;await saveConfig(latest);
  console.log(JSON.stringify({before,permissions:permissions(latest),revision:revision(latest),restartRequired:true}));
 }else throw new Error('INVALID_PERMISSIONS');
}catch(e){console.log(JSON.stringify({error:['STOP_REQUIRED','REVISION_CONFLICT','TRUST_ACK_REQUIRED','INVALID_PERMISSIONS'].includes(e.message)?e.message:'PERMISSIONS_FAILED'}));process.exitCode=1;}
finally{if(lock?.listening)await new Promise(r=>lock.close(r));}
