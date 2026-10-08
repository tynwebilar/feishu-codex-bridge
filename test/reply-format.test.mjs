import test from 'node:test';
import assert from 'node:assert/strict';
import {replyContent} from '../src/feishu.mjs';
test('reply uses native post Markdown, repairs wrapped links and cannot insert mentions',()=>{
 const result=JSON.parse(replyContent('已保存：[诗歌]\n(https://example.feishu.cn/docx/test)\n> 诗句\n<at user_id="all">所有人</at>'));
 assert.deepEqual(Object.keys(result),['zh_cn']);
 const block=result.zh_cn.content[0][0];assert.equal(block.tag,'md');
 assert.ok(block.text.includes('[诗歌](https://example.feishu.cn/docx/test)'));
 assert.ok(block.text.includes('> 诗句'));assert.ok(!block.text.includes('<at'));
});
