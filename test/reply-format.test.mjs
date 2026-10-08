import test from 'node:test';
import assert from 'node:assert/strict';
import {replyContent} from '../src/feishu.mjs';
test('reply uses interactive card Markdown, repairs wrapped links and cannot insert mentions',()=>{
 const result=JSON.parse(replyContent('已保存：[诗歌]\n(https://example.feishu.cn/docx/test)\n> 诗句\n<at user_id="all">所有人</at>'));
 assert.equal(result.config.wide_screen_mode,true);
 const block=result.elements[0].text;assert.equal(block.tag,'lark_md');
 assert.ok(block.content.includes('[诗歌](https://example.feishu.cn/docx/test)'));
 assert.ok(block.content.includes('> 诗句'));assert.ok(!block.content.includes('<at'));
});

test('short replies retain the same card layout',()=>{const r=JSON.parse(replyContent('已记住'));assert.equal(r.elements[0].text.content,'已记住');assert.equal(r.elements[0].text.tag,'lark_md');});
