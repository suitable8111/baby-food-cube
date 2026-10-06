import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageInfo, mealsForDate, nineMonthDate, expiryDate, buildPlan, forecast,
  matchRecipes, applyConsumption, restoreConsumption, guessCategory, addMonths,
} from '../web/js/logic.js';

const BIRTH = '2026-02-25';
const cube = (id, name, category, madeDate, count) => ({ id, name, category, madeDate, sizeG: 30, count, initialCount: count });

test('월령 계산과 9개월 기준일', () => {
  assert.deepEqual(ageInfo(BIRTH, '2026-10-06'), { months: 7, days: 11, totalDays: 223 });
  assert.equal(nineMonthDate(BIRTH), '2026-11-25');
  assert.deepEqual(mealsForDate(BIRTH, '2026-11-24'), ['lunch', 'dinner']);
  assert.deepEqual(mealsForDate(BIRTH, '2026-11-25'), ['breakfast', 'lunch', 'dinner']);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

test('소비기한은 만든 날 포함 14일', () => {
  assert.equal(expiryDate({ madeDate: '2026-10-01' }), '2026-10-14');
});

test('분류 추정', () => {
  assert.equal(guessCategory('한우 안심'), 'beef');
  assert.equal(guessCategory('닭안심'), 'chicken');
  assert.equal(guessCategory('대구살'), 'fish');
  assert.equal(guessCategory('쌀죽'), 'rice');
  assert.equal(guessCategory('애호박'), 'veg');
});

test('식단 규칙: 매끼 밥, 점심 소고기, 저녁 닭/생선', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-01', 40),
    cube('b', '소고기', 'beef', '2026-10-01', 10),
    cube('c', '닭고기', 'chicken', '2026-10-01', 10),
    cube('f', '대구', 'fish', '2026-10-02', 10),
    cube('v1', '애호박', 'veg', '2026-10-01', 10),
    cube('v2', '당근', 'veg', '2026-10-01', 10),
    cube('v3', '브로콜리', 'veg', '2026-10-02', 10),
  ];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 3 });
  for (const d of days) {
    assert.deepEqual(Object.keys(d.meals), ['lunch', 'dinner']);
    for (const m of Object.values(d.meals)) assert.ok(m.items.some((it) => it.category === 'rice' && !it.missing));
    assert.ok(d.meals.lunch.items.some((it) => it.category === 'beef'));
    assert.ok(d.meals.dinner.items.some((it) => it.category === 'chicken' || it.category === 'fish'));
  }
  // 저녁 단백질은 번갈아
  const dinners = days.map((d) => d.meals.dinner.items.find((it) => ['chicken', 'fish'].includes(it.category)).category);
  assert.notEqual(dinners[0], dinners[1]);
  // 선택 이유가 남는다
  assert.match(days[1].meals.dinner.comment, /번갈아/);
});

test('소비기한 임박 큐브는 이유와 함께 먼저 사용', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10),
    cube('b', '소고기', 'beef', '2026-10-06', 5),
    cube('v1', '애호박', 'veg', '2026-10-06', 5),
    cube('v2', '당근', 'veg', '2026-10-06', 5),
    cube('v3', '브로콜리', 'veg', '2026-09-25', 5), // 10/08 만료 → 10/06 기준 D-2
  ];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 1 });
  const lunch = days[0].meals.lunch;
  assert.ok(lunch.items.some((it) => it.name === '브로콜리'));
  assert.match(lunch.comment, /브로콜리 기한 D-2/);
});

test('9개월 이후 3끼, 소비기한 지난 큐브는 사용 안 함', () => {
  const cubes = [cube('r', '쌀밥', 'rice', '2026-11-01', 10), cube('b', '소고기', 'beef', '2026-11-20', 5)];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-11-25', days: 1 });
  assert.deepEqual(Object.keys(days[0].meals), ['breakfast', 'lunch', 'dinner']);
  // 11/01 쌀은 11/14 만료 → 부족 표시
  assert.ok(days[0].meals.breakfast.items.some((it) => it.category === 'rice' && it.missing));
});

test('소진 예측', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 8), // 하루 4개 → 2일
    cube('b', '소고기', 'beef', '2026-10-06', 3),
    cube('c', '닭고기', 'chicken', '2026-10-06', 20),
  ];
  const f = forecast({ cubes, settings: {}, birth: BIRTH, today: '2026-10-06' });
  assert.equal(f.categories.rice.lastUse, '2026-10-07');
  assert.equal(f.categories.rice.stockOut, '2026-10-08');
  assert.equal(f.categories.rice.makeBy, '2026-10-07');
  assert.equal(f.categories.beef.stockOut, '2026-10-09');
  // 닭고기 20개 중 14일 내 하루 1개 → 14개 사용, 6개 폐기 예상
  assert.equal(f.waste.find((w) => w.cube.id === 'c').qty, 6);
});

test('레시피 매칭과 소비/복구', () => {
  const cubes = [cube('r', '쌀밥', 'rice', '2026-11-25', 4), cube('b', '소고기', 'beef', '2026-11-25', 2), cube('v', '당근', 'veg', '2026-11-25', 2)];
  const rs = matchRecipes({ cubes, settings: {}, date: '2026-11-26' });
  assert.ok(rs.some((r) => r.id === 'beef-veg-jinbap'));
  assert.ok(!rs.some((r) => r.id.startsWith('chicken')));
  const { cubes: after, applied } = applyConsumption(cubes, [{ cubeId: 'b', qty: 5 }]);
  assert.equal(after.find((c) => c.id === 'b').count, 0);
  assert.equal(restoreConsumption(after, applied).find((c) => c.id === 'b').count, 2);
});
