import { createInterface } from 'node:readline';
let interrupts = 0;
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (!m.id) continue;
  if (m.method === 'exit') process.exit(1);
  if (m.method === 'timeout') continue;
  if (m.method === 'turn/interrupt' && ++interrupts === 1) {
    console.log(JSON.stringify({ id: m.id, error: { message: 'no active turn to interrupt' } }));
    continue;
  }
  if (m.method === 'thread/read') {
    console.log(JSON.stringify({ id: m.id, error: { message: 'rollout is empty' } }));
    continue;
  }
  if (m.method === 'turn/start') {
    console.log(JSON.stringify({ method: 'turn/completed', params: { threadId: m.params.threadId, turn: { id: 't1', status: 'completed' } } }));
    console.log(JSON.stringify({ id: m.id, result: { turn: { id: 't1' } } }));
  } else console.log(JSON.stringify({ id: m.id, result: { ok: true } }));
}
