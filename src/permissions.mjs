import {createHash} from 'node:crypto';
export function validatePermissions(p) {
  if (!p || Object.keys(p).some(k=>!['groupContext','groups'].includes(k)) || !['shared','per-sender'].includes(p.groupContext) || !Array.isArray(p.groups) || p.groups.length>100) throw new Error('INVALID_PERMISSIONS');
  const seen=new Set();
  for(const g of p.groups){
    if(!g || Object.keys(g).some(k=>!['chatId','enabled','requireMention','senderIds','trustedLocalAccess'].includes(k)) || !/^oc_[a-zA-Z0-9]+$/.test(g.chatId) || seen.has(g.chatId) || typeof g.enabled!=='boolean' || typeof g.requireMention!=='boolean' || typeof g.trustedLocalAccess!=='boolean' || !Array.isArray(g.senderIds) || g.senderIds.length>100 || g.senderIds.some(id=>!/^ou_[a-zA-Z0-9]+$/.test(id))) throw new Error('INVALID_PERMISSIONS');
    seen.add(g.chatId);
  }
  return p;
}
export function permissions(config){return config.permissions ?? {groupContext:'per-sender',groups:config.groups.map(chatId=>({chatId,enabled:true,requireMention:true,senderIds:[config.ownerId],trustedLocalAccess:false}))};}
export function admitted(config,group,chatId,sender){
  if(!sender || !config.ownerId)return false;
  if(!group)return sender===config.ownerId;
  const g=permissions(config).groups.find(g=>g.chatId===chatId);
  return !!g?.enabled && g.senderIds.includes(sender) && (sender===config.ownerId || g.trustedLocalAccess);
}
export function revision(config){return createHash('sha256').update(JSON.stringify(permissions(config))).digest('hex');}
