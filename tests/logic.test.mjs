import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageInfo, mealsForDate, nineMonthDate, expiryDate, buildPlan, forecast,
  matchRecipes, applyConsumption, restoreConsumption, guessCategory, addMonths, daysLeft, isUsable,
  reservedFromPlans, eatenInfo, evaluateMeal,
} from '../web/js/logic.js';
import { scoreCombo } from '../web/js/nutrition.js';

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

test('궁합·영양이 같으면 소비기한 임박 큐브를 먼저 (3순위)', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10),
    cube('b', '소고기', 'beef', '2026-10-06', 5),
    cube('v1', '가나채소', 'veg', '2026-10-06', 5),
    cube('v2', '다라채소', 'veg', '2026-09-25', 5), // 10/08 만료 → 10/06 기준 D-2
  ];
  const { days } = buildPlan({ cubes, settings: { vegKindsPerMeal: 1 }, birth: BIRTH, startDate: '2026-10-06', days: 1 });
  const lunch = days[0].meals.lunch;
  assert.ok(lunch.items.some((it) => it.name === '다라채소'));
  assert.match(lunch.comment, /다라채소 기한 D-2/);
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

test('영양 궁합: 소고기 점심엔 비타민C 채소를 골라 철분 흡수를 돕는다', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10),
    cube('b', '소고기', 'beef', '2026-10-06', 5),
    cube('v1', '오이', 'veg', '2026-10-05', 5), // 기한은 더 빠르지만 영양 궁합이 약함
    cube('v2', '브로콜리', 'veg', '2026-10-06', 5),
  ];
  const { days } = buildPlan({ cubes, settings: { vegKindsPerMeal: 1 }, birth: BIRTH, startDate: '2026-10-06', days: 1 });
  const lunch = days[0].meals.lunch;
  assert.deepEqual(lunch.items.filter((i) => i.category === 'veg').map((i) => i.name), ['브로콜리']);
  assert.match(lunch.comment, /철분 흡수/);
});

test('음식 궁합 1순위: 소고기+고구마는 기한이 임박해도 절대 추천하지 않는다', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10),
    cube('b', '소고기', 'beef', '2026-10-06', 5),
    cube('v1', '고구마', 'veg', '2026-09-25', 5), // D-2, 영양 점수도 높음
    cube('v2', '무', 'veg', '2026-10-06', 5),
    cube('v3', '오이', 'veg', '2026-10-06', 5),
  ];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 3 });
  for (const d of days) {
    assert.ok(!d.meals.lunch.items.some((i) => i.name === '고구마'), `${d.date} 점심에 고구마`);
    // 궁합 좋은 무가 들어가고, 그 이유가 맨 앞에 나온다
    assert.ok(d.meals.lunch.items.some((i) => i.name === '무'));
  }
  assert.match(days[0].meals.lunch.comment, /^소고기\+무는 궁합이 좋은 조합/);
  assert.match(days[0].meals.lunch.comment, /고구마.*제외/);
});

test('음식 궁합이 영양 점수보다 우선', () => {
  // 고구마(베타카로틴·비타민C)는 영양 점수가 높지만 궁합표에 소고기와 나쁜 조합 → 제외
  assert.ok(scoreCombo([{ name: '소고기', category: 'beef' }], ['고구마']).excluded);
  // 좋은 궁합 하나가 영양 점수 차이보다 크다
  const good = scoreCombo([{ name: '소고기', category: 'beef' }], ['애호박']); // 궁합 O, 영양 보통
  const nutri = scoreCombo([{ name: '소고기', category: 'beef' }], ['파프리카']); // 궁합표 없음, 비타민C·베타카로틴
  assert.ok(good.score > nutri.score);
  // 사용자가 바꾼 궁합표를 따른다
  assert.ok(!scoreCombo([{ name: '소고기', category: 'beef' }], ['고구마'], { pairs: { good: [], bad: [] } }).excluded);
});

test('나쁜 궁합 없이 채울 수 없으면 종류를 줄이고 부족으로 표시', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10),
    cube('b', '소고기', 'beef', '2026-10-06', 5),
    cube('v1', '고구마', 'veg', '2026-10-06', 5),
    cube('v2', '무', 'veg', '2026-10-06', 5),
  ];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 1 });
  const lunch = days[0].meals.lunch;
  assert.deepEqual(lunch.items.filter((i) => i.category === 'veg' && !i.missing).map((i) => i.name), ['무']);
  assert.ok(lunch.items.some((i) => i.missing && /궁합 맞는 채소/.test(i.name)));
});

test('영양 보완: 시금치+두부는 피할 조합, 베타카로틴+지방은 좋은 조합', () => {
  assert.ok(scoreCombo([{ name: '두부', category: 'etc' }], ['시금치']).excluded);
  const r = scoreCombo([{ name: '소고기', category: 'beef' }], ['당근']);
  assert.ok(r.reasons.some((x) => /베타카로틴/.test(x.text)));
  // 색이 다른 조합이 같은 색 조합보다 점수가 높다
  assert.ok(scoreCombo([], ['당근', '브로콜리']).score > scoreCombo([], ['당근', '단호박']).score);
});

test('생선 주 2회: 최근 저녁이 닭고기뿐이면 생선 우선', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10),
    cube('c', '닭고기', 'chicken', '2026-09-25', 5), // 10/08 만료 (D-2)
    cube('f', '대구', 'fish', '2026-10-06', 5),
  ];
  const { days } = buildPlan({
    cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 1, recentDinners: ['chicken', 'chicken', 'chicken', 'chicken'],
  });
  const dinner = days[0].meals.dinner;
  assert.ok(dinner.items.some((i) => i.category === 'fish'));
  assert.match(dinner.comment, /주 2회/);
});

test('같은 날 점심·저녁 채소는 절대 겹치지 않는다 (모자라면 부족 표시)', () => {
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 20),
    cube('b', '소고기', 'beef', '2026-10-06', 5),
    cube('c', '닭고기', 'chicken', '2026-10-06', 5),
    cube('v1', '애호박', 'veg', '2026-10-06', 10),
    cube('v2', '당근', 'veg', '2026-10-06', 10),
    cube('v3', '브로콜리', 'veg', '2026-10-06', 10),
  ];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 3 });
  for (const d of days) {
    const veg = (m) => d.meals[m].items.filter((i) => i.category === 'veg' && !i.missing).map((i) => i.name);
    const both = veg('lunch').filter((n) => veg('dinner').includes(n));
    assert.deepEqual(both, [], `${d.date} 겹침: ${both}`);
    // 채소가 3종뿐이라 저녁은 1종 + 부족 표시
    assert.ok(d.meals.dinner.items.some((i) => i.missing && /오늘 안 먹은 채소/.test(i.name)));
  }
  // 이미 먹은 점심 채소도 저녁에서 빠진다
  const eaten = { '2026-10-06': [{ cubeId: 'v1', name: '애호박', category: 'veg', qty: 1 }] };
  const r = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 1, skipMeals: { '2026-10-06': ['lunch'] }, eatenItems: eaten });
  assert.ok(!r.days[0].meals.dinner.items.some((i) => i.name === '애호박'));
});

test('시판 큐브는 소비기한이 없다', () => {
  const store = { ...cube('s', '시판 단호박', 'veg', '2026-08-01', 5), commercial: true };
  assert.equal(daysLeft(store, '2026-10-10'), Infinity);
  assert.ok(isUsable(store, '2026-12-31'));
  // 오래전에 등록했어도 식단에 쓰이고, 폐기 예상에도 안 잡힌다
  const cubes = [cube('r', '쌀밥', 'rice', '2026-10-10', 10), cube('b', '소고기', 'beef', '2026-10-10', 5), store];
  const { days } = buildPlan({ cubes, settings: { vegKindsPerMeal: 1 }, birth: BIRTH, startDate: '2026-10-10', days: 1 });
  assert.ok(days[0].meals.lunch.items.some((i) => i.name === '시판 단호박'));
  const f = forecast({ cubes, settings: {}, birth: BIRTH, today: '2026-10-10' });
  assert.ok(!f.waste.some((w) => w.cube.id === 's'));
});

test('직접 수정한 끼니는 다시 짤 때 유지되고, 그 큐브는 재고에 잡혀 있다', () => {
  const plans = {
    '2026-10-06': {
      meals: {
        lunch: { edited: true, done: false, items: [{ cubeId: 'b', name: '소고기', category: 'beef', qty: 2 }, { cubeId: 'v1', name: '애호박', category: 'veg', qty: 1 }] },
        dinner: { done: false, items: [{ cubeId: 'c', name: '닭고기', category: 'chicken', qty: 1 }] },
      },
    },
  };
  // 그날을 다시 짜도 수정한 점심의 큐브는 잡혀 있고, 수정 안 한 저녁 것은 풀린다
  assert.deepEqual(reservedFromPlans(plans, ['2026-10-06']), { b: 2, v1: 1 });
  // 다시 짤 때 수정한 점심은 건너뛰고, 그 채소는 저녁에서 빠진다
  const { skipMeals, eatenItems } = eatenInfo(plans, ['2026-10-06'], { includeEdited: true });
  assert.deepEqual(skipMeals['2026-10-06'], ['lunch']);
  const cubes = [
    cube('r', '쌀밥', 'rice', '2026-10-06', 10), cube('b', '소고기', 'beef', '2026-10-06', 5), cube('c', '닭고기', 'chicken', '2026-10-06', 5),
    cube('v1', '애호박', 'veg', '2026-10-06', 5), cube('v2', '당근', 'veg', '2026-10-06', 5), cube('v3', '브로콜리', 'veg', '2026-10-06', 5),
  ];
  const { days } = buildPlan({ cubes, settings: {}, birth: BIRTH, startDate: '2026-10-06', days: 1, skipMeals, eatenItems });
  assert.ok(!days[0].meals.lunch);
  assert.ok(!days[0].meals.dinner.items.some((i) => i.name === '애호박'));
});

test('직접 수정한 끼니 평가', () => {
  const it = (name, category) => ({ cubeId: name, name, category, qty: 1 });
  const stock = [cube('v9', '브로콜리', 'veg', '2026-10-10', 5), cube('v8', '무', 'veg', '2026-10-10', 5)];
  const ev = (meal, items, sameDayVeg) => evaluateMeal({ meal, items, date: '2026-10-10', cubes: stock, sameDayVeg });

  // 좋은 조합: 궁합 + 철분·비타민C + 베타카로틴·지방 + 색 다양
  const great = ev('lunch', [it('밥', 'rice'), it('소고기', 'beef'), it('브로콜리', 'veg'), it('당근', 'veg')]);
  assert.equal(great.grade, 'great');
  assert.ok(great.points.some((p) => p.type === 'good' && /소고기\+브로콜리/.test(p.text)));

  // 나쁜 궁합·규칙 위반·같은 날 중복은 경고
  const bad = ev('lunch', [it('밥', 'rice'), it('소고기', 'beef'), it('고구마', 'veg')]);
  assert.equal(bad.grade, 'warn');
  assert.ok(bad.points.some((p) => /고구마.*맞지 않아요/.test(p.text)));
  assert.ok(ev('lunch', [it('밥', 'rice'), it('닭고기', 'chicken'), it('브로콜리', 'veg')]).points.some((p) => /점심 소고기/.test(p.text)));
  assert.equal(ev('dinner', [it('밥', 'rice'), it('닭고기', 'chicken'), it('애호박', 'veg')], new Set(['애호박'])).grade, 'warn');

  // 아쉬운 점에는 재고 기반 제안
  const meh = ev('lunch', [it('밥', 'rice'), it('소고기', 'beef'), it('오이', 'veg')]);
  assert.ok(meh.points.some((p) => p.type === 'tip' && /브로콜리/.test(p.text)));
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
