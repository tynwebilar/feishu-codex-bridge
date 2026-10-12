import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { prepareInput, attachmentRoot } from '../src/attachments.mjs';

test('files are discoverable without resource access while mixed images still load', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'bridge-lazy-'));
  try {
    const calls = [];
    const client = { im: { messageResource: { get: async request => {
      calls.push(request);
      assert.equal(request.params.type, 'image');
      return { getReadableStream: () => Readable.from([Buffer.from('GIF89a image fixture')]) };
    } } } };
    const message = { id: 'om_file', chatId: 'oc_current', chat: 'current', text: '', replyTo: 'om_parent',
      attachments: [{ type: 'file', key: 'file_csv', name: 'usage.csv' }] };
    const input = await prepareInput(client, cwd, message);
    assert.equal(calls.length, 0);
    assert.deepEqual(await readdir(join(attachmentRoot(cwd, message.chat), 'incoming')), []);
    for (const value of ['usage.csv', 'file_csv', 'om_file', 'oc_current', 'om_parent', '--as bot', '尚未下载'])
      assert.ok(input[0].text.includes(value));
    message.attachments.push({ type: 'image', key: 'img_test' });
    const mixed = await prepareInput(client, cwd, message);
    assert.equal(calls.length, 1);
    assert.equal(mixed[1].type, 'localImage');
    assert.equal((await readdir(join(attachmentRoot(cwd, message.chat), 'incoming'))).length, 1);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
