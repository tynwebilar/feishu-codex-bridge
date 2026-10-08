import { resolve } from 'node:path';

const normalize = p => {
  const path = resolve(p.replace(/^\\\\\?\\/, ''));
  return process.platform === 'win32' ? path.toLowerCase() : path;
};
export async function listWorkspaceProjects(client, cwd) {
  const projects = [];
  let cursor;
  do {
    const page = await client.request('project/list', { limit: 100, ...(cursor ? { cursor } : {}) });
    projects.push(...page.data.filter(p => p.roots.some(r => normalize(r.path) === normalize(cwd))));
    cursor = page.nextCursor;
  } while (cursor);
  return projects;
}

export async function resolveProjectBinding(client, cwd, preferredId) {
  const projects = await listWorkspaceProjects(client, cwd);
  const selected = preferredId ? projects.find(p => p.id === preferredId) : projects.length === 1 ? projects[0] : null;
  return {
    projectId: selected?.id ?? null,
    state: selected ? 'backend_selected' : preferredId ? 'selection_missing' : projects.length ? 'selection_required' : 'project_missing',
    // ponytail: App Server selection cannot attest desktop visibility; require UI acceptance until a supported API exists.
    desktopVisibility: 'unverified',
  };
}

export async function ensureProject(client, cwd) {
  return (await resolveProjectBinding(client, cwd)).projectId;
}
