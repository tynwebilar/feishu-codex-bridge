import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { resolveProjectBinding } from '../src/projects.mjs';
import { validate } from '../src/config.mjs';

const cwd = resolve('.');
const project = id => ({ id, name: id, roots: [{ path: cwd }] });
function client(pages) {
  let index = 0;
  return { request: async (method, params) => {
    assert.equal(method, 'project/list', 'must not create projects or change threads');
    assert.equal(params.cursor, index ? String(index) : undefined);
    return { data: pages[index++], nextCursor: index < pages.length ? String(index) : null };
  } };
}
test('project binding scans all pages and requires selection for duplicate roots', async () => {
  const pages = [[project('old')], [project('desktop')]];
  assert.deepEqual(await resolveProjectBinding(client(pages), cwd), {
    projectId: null, state: 'selection_required', desktopVisibility: 'unverified',
  });
  assert.equal((await resolveProjectBinding(client(pages), cwd, 'desktop')).projectId, 'desktop');
  assert.equal((await resolveProjectBinding(client([...pages].reverse()), cwd, 'desktop')).projectId, 'desktop');
});
test('missing project is not created; deleted or wrong-root selection never silently rebinds', async () => {
  assert.equal((await resolveProjectBinding(client([[]]), cwd)).state, 'project_missing');
  const binding = await resolveProjectBinding(client([[project('other')]]), cwd, 'deleted');
  assert.equal(binding.state, 'selection_missing');
  assert.equal(binding.projectId, null);
  assert.equal((await resolveProjectBinding(client([[{id:'wrong',roots:[{path:resolve('../other')}]}]]), cwd, 'wrong')).state, 'selection_missing');
});
test('unique backend selection never claims desktop visibility', async () => {
  assert.deepEqual(await resolveProjectBinding(client([[project('only')]]), cwd), {
    projectId: 'only', state: 'backend_selected', desktopVisibility: 'unverified',
  });
});
test('optional project ID validates without changing legacy configuration', () => {
  const config = {version:1,appId:'cli_0123456789abcdef',groups:[],cwd,sandbox:'read-only',secretDpapi:'fixture'};
  assert.equal(validate(config), config);
  assert.doesNotThrow(() => validate({...config,projectId:'01a11a66-46d0-76e0-a5b6-de3395c33609'}));
  assert.throws(() => validate({...config,projectId:'arbitrary'}), /项目 ID/);
});
