import test from 'node:test';
import assert from 'node:assert/strict';
import { stampChanges, mergeStates } from '../web/js/merge.js';

const base = () => ({ baby: { name: 'a', birth: '2026-02-25' }, settings: {}, cubes: [], plans: {}, log: [] });
const cube = (id, count, createdAt = id) => ({ id, name: id, category: 'veg', madeDate: '2026-10-10', count, createdAt });

test('기기 기록과 빈 클라우드를 합쳐도 큐브가 사라지지 않는다', () => {
  const local = stampChanges(null, { ...base(), cubes: [cube('a', 6), cube('b', 3)] }, 100);
  const cloud = stampChanges(null, base(), 200); // 다른 기기에서 빈 상태로 나중에 만든 공간
  const m = mergeStates(local, cloud, 300);
  assert.deepEqual(m.cubes.map((c) => c.id), ['a', 'b']);
});

test('같은 큐브는 나중에 바뀐 쪽, 서로 다른 큐브는 모두 남는다', () => {
  const s0 = stampChanges(null, { ...base(), cubes: [cube('a', 6)] }, 100);
  const phone = stampChanges(s0, { ...structuredClone(s0), cubes: [cube('a', 5)] }, 200); // 폰에서 1개 사용
  const pc = stampChanges(s0, { ...structuredClone(s0), cubes: [cube('a', 6), cube('c', 4)] }, 150); // PC에서 새 큐브
  const m = mergeStates(pc, phone, 300);
  assert.equal(m.cubes.find((c) => c.id === 'a').count, 5);
  assert.ok(m.cubes.some((c) => c.id === 'c'));
});

test('삭제는 다른 기기에도 전달되고, 삭제 후 다시 바꾼 건 살아난다', () => {
  const s0 = stampChanges(null, { ...base(), cubes: [cube('a', 6), cube('b', 2)] }, 100);
  const del = stampChanges(s0, { ...structuredClone(s0), cubes: [cube('b', 2)] }, 200); // a 삭제
  const m = mergeStates(s0, del, 300);
  assert.deepEqual(m.cubes.map((c) => c.id), ['b']);
});

test('기록(log)은 합집합', () => {
  const a = { ...base(), log: [{ id: '1', at: '2026-10-10T01:00:00Z' }] };
  const b = { ...base(), log: [{ id: '2', at: '2026-10-10T02:00:00Z' }] };
  assert.deepEqual(mergeStates(a, b).log.map((l) => l.id), ['2', '1']);
});
