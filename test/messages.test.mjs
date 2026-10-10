import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent } from '../src/messages.mjs';
import { Bridge } from '../src/bridge.mjs';

const config = { appId: 'cli_test', ownerId: 'ou_owner', botId: 'ou_bot', groups: [] };
test('standalone stickers are ignored before storage, replies or typing in private and group chats', () => {
  const cfg = { ...config, permissions: { groupContext: 'shared', groups: [
    { chatId: 'oc_test', enabled: true, requireMention: false, senderIds: ['ou_owner'], trustedLocalAccess: false },
  ] } };
  for (const chat_type of ['p2p', 'group']) {
    const sticker = event([]);
    Object.assign(sticker.message, { chat_type, message_type: 'sticker', content: JSON.stringify({ file_key: 'file_sticker' }) });
    assert.equal(parseEvent(sticker, cfg), null);
    const unexpected = () => assert.fail('sticker must not enter the processing pipeline');
    new Bridge(cfg, { accept: unexpected, enqueue: unexpected, finish: unexpected }, {}, { typing: unexpected }).receive(sticker);
    sticker.message.message_type = 'image';
    sticker.message.content = JSON.stringify({ image_key: 'img_test' });
    assert.deepEqual(parseEvent(sticker, cfg).attachments, [{ type: 'image', key: 'img_test' }]);
  }
});
function event(content, locale) {
  const post = { title: '', content };
  return {
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
    message: { message_id: 'om_test', chat_id: 'oc_test', chat_type: 'p2p', message_type: 'post',
      content: JSON.stringify(locale ? { [locale]: post } : post) },
  };
}

test('native code blocks retain language, indentation, blank lines and trailing spaces', () => {
  const code = '\n  def example():\n\treturn 1  \n\n';
  for (const locale of [undefined, 'zh_cn', 'en_us']) {
    const parsed = parseEvent(event([[{ tag: 'code_block', language: 'Python', text: code }]], locale), config);
    assert.equal(parsed.unsupported, false);
    assert.equal(parsed.text, '```Python\n' + code + '```');
  }
});

test('code fences cannot close early or become bridge control commands', () => {
  const parsed = parseEvent(event([[{ tag: 'code_block', language: 'bad\n/stop', text: '/stop\n```\n````' }]]), config);
  assert.equal(parsed.unsupported, false);
  assert.equal(parsed.text, '`````\n/stop\n```\n````\n`````');
  assert.equal(parsed.text.startsWith('/'), false);
});

test('image, text and emotion stay together instead of rejecting the entire post', () => {
  const parsed = parseEvent(event([
    [{ tag: 'img', image_key: 'img_test' }],
    [{ tag: 'text', text: '这个情况怎么办' }, { tag: 'emotion', emoji_type: 'SMILE' }],
  ]), config);
  assert.equal(parsed.unsupported, false);
  assert.equal(parsed.text, '这个情况怎么办[表情:SMILE]');
  assert.deepEqual(parsed.attachments, [{ type: 'image', key: 'img_test' }]);
});

test('Markdown, separators, links and mentions preserve post order', () => {
  const parsed = parseEvent(event([
    [{ tag: 'at', user_id: 'ou_bot' }, { tag: 'md', text: '**look**' }],
    [{ tag: 'hr' }],
    [{ tag: 'code_block', language: 'SQL', text: 'select 1;' }, { tag: 'a', text: 'more', href: 'https://example.com' }],
  ]), config);
  assert.equal(parsed.unsupported, false);
  assert.match(parsed.text, /\*\*look\*\*[\s\S]*---[\s\S]*```SQL\nselect 1;\n```\nmore/);
});

test('unknown meaningful nodes are still rejected rather than silently discarded', () => {
  const parsed = parseEvent(event([[{ tag: 'text', text: 'see video' }, { tag: 'media', file_key: 'file_test' }]]), config);
  assert.equal(parsed.unsupported, true);
});

test('malformed rich text is rejected without coercing objects into prompts', () => {
  for (const node of [{ tag: 'code_block', text: {} }, { tag: 'emotion', emoji_type: [] }, { tag: 'md', text: 42 }]) {
    assert.equal(parseEvent(event([[node]]), config), null);
  }
});

test('code and emotion support retains text and attachment limits', () => {
  assert.equal(parseEvent(event([[{ tag: 'code_block', text: 'x'.repeat(30001) }]]), config).unsupported, true);
  assert.equal(parseEvent(event([[{ tag: 'emotion', emoji_type: 'x'.repeat(30001) }]]), config).unsupported, true);
  assert.equal(parseEvent(event([Array.from({ length: 6 }, () => ({ tag: 'img', image_key: 'img_test' }))]), config).unsupported, true);
});

test('bridge receives code and image/emotion posts as model inputs, not rejected messages', () => {
  for (const nodes of [
    [{ tag: 'code_block', language: 'Python', text: 'print(1)' }],
    [{ tag: 'img', image_key: 'img_test' }, { tag: 'text', text: 'help' }, { tag: 'emotion', emoji_type: 'SMILE' }],
  ]) {
    let accepted, rejected = false;
    const store = { accept: m => { accepted = m; return 'queued'; }, unknown: () => [],
      get: () => ({}), finish: () => { rejected = true; } };
    new Bridge(config, store, {}, {}).receive(event([nodes]));
    assert.equal(accepted.unsupported, false);
    assert.equal(rejected, false);
  }
});
