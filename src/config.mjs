import {validatePermissions} from './permissions.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
export class UserError extends Error {}

export const dataDir = resolve(process.env.FEISHU_CODEX_HOME || join(homedir(), '.feishu-codex-bridge'));
export function validate(config) {
  if (config.version !== 1 || !/^cli_[0-9a-f]{16}$/i.test(config.appId ?? '')) throw new UserError('应用 ID 或配置版本无效，请重新配置。');
  if (config.ownerId && !/^ou_[a-zA-Z0-9]+$/.test(config.ownerId)) throw new UserError('用户 open_id 格式无效。');
  if (!Array.isArray(config.groups) || config.groups.some(id => !/^oc_[a-zA-Z0-9]+$/.test(id))) throw new UserError('群白名单无效。');
  if (!isAbsolute(config.cwd ?? '') || !['read-only','workspace-write','danger-full-access'].includes(config.sandbox)) throw new UserError('工作区或权限配置无效。');
  if (config.projectId != null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(config.projectId)) throw new UserError('项目 ID 无效。');
  if (!config.secretDpapi && !process.env.FEISHU_APP_SECRET) throw new UserError('缺少应用密钥，请重新配置。');
  if(config.permissions) validatePermissions(config.permissions);
  return config;
}
export async function loadConfig() {
  const config = validate(JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')));
  if (!(await stat(config.cwd)).isDirectory()) throw new UserError('工作区不存在。');
  return config;
}
export async function saveConfig(config) {
  validate(config);
  await mkdir(dataDir, { recursive: true });
  const temp = join(dataDir, `config-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await rename(temp, join(dataDir, 'config.json'));
}
export function protect(value, decrypt = false) {
  if (process.platform !== 'win32') throw new UserError('当前加密配置只支持 Windows。');
  const script = `$ErrorActionPreference='Stop'; $v=[Console]::In.ReadToEnd(); ` + (decrypt
    ? `$s=ConvertTo-SecureString $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}`
    : `[Console]::Out.Write((ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString))`);
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    // PowerShell 7's module path cannot be loaded by Windows PowerShell 5.1.
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.resume();
    child.on('error', () => reject(new UserError('无法启动 Windows 凭据加密组件。')));
    child.on('close', code => code === 0 ? resolvePromise(output.trim()) : reject(new UserError('Windows 密钥解密失败，请在当前用户下重新配置。')));
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}
export async function getSecret(config) { return process.env.FEISHU_APP_SECRET || await protect(config.secretDpapi, true); }
