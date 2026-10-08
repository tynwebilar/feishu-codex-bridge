import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

const normalize = p => {
  const path = resolve(p.replace(/^\\\\\?\\/, ''));
  return process.platform === 'win32' ? path.toLowerCase() : path;
};
export async function ensureProject(client, cwd) {
  let cursor;
  do {
    const page = await client.request('project/list', { limit: 100, ...(cursor ? { cursor } : {}) });
    const found = page.data.find(p => p.roots.some(r => normalize(r.path) === normalize(cwd)));
    if (found) return found.id;
    cursor = page.nextCursor;
  } while (cursor);
  const { project } = await client.request('project/create', {
    idempotencyKey: `feishu-bridge-${createHash('sha256').update(normalize(cwd)).digest('hex')}`,
    name: basename(cwd), roots: [{ path: resolve(cwd) }],
  });
  return project.id;
}
