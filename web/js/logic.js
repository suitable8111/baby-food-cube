// 순수 로직 모듈: 날짜/월령 계산, 소비기한, 식단 배정, 소진 예측, 레시피 매칭.
// DOM·localStorage에 의존하지 않으므로 node --test로 검증할 수 있다.
import { info, scoreCombo, combinations, nutritionCheck, DEFAULT_PAIRS, j } from './nutrition.js';

export const CATEGORIES = {
  rice: { label: '밥', emoji: '🍚' },
  beef: { label: '소고기', emoji: '🥩' },
  chicken: { label: '닭고기', emoji: '🍗' },
  fish: { label: '생선', emoji: '🐟' },
  veg: { label: '채소', emoji: '🥦' },
  fruit: { label: '과일', emoji: '🍎' },
  etc: { label: '기타', emoji: '🥣' },
};

export const MEALS = {
  breakfast: { label: '아침', order: 0 },
  lunch: { label: '점심', order: 1 },
  dinner: { label: '저녁', order: 2 },
};

export const DEFAULT_SETTINGS = {
  shelfDays: 14, // 원칙: 만든 날 포함 14일 내 소진
  riceCubesPerMeal: 2,
  proteinCubesPerMeal: 1,
  vegKindsPerMeal: 2,
  vegCubesEach: 1,
  fruitAtBreakfast: true,
  forecastHorizon: 45,
  pairs: DEFAULT_PAIRS, // 음식 궁합 표 (설정에서 편집)
};

// ---------- 날짜 ----------
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}
/** b - a (일) */
export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
export function todayStr(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fmtDate(new Date(Date.UTC(y, m - 1 + n, Math.min(d, lastDay))));
}
export function shortDate(s) {
  const d = parseDate(s);
  const w = '일월화수목금토'[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

// ---------- 월령 ----------
export function ageInfo(birth, date) {
  const b = parseDate(birth);
  const t = parseDate(date);
  let months = (t.getUTCFullYear() - b.getUTCFullYear()) * 12 + (t.getUTCMonth() - b.getUTCMonth());
  if (addMonths(birth, months) > date) months--;
  return { months, days: diffDays(addMonths(birth, months), date), totalDays: diffDays(birth, date) };
}
export function nineMonthDate(birth) {
  return addMonths(birth, 9);
}
export function mealsForDate(birth, date) {
  return ageInfo(birth, date).months >= 9 ? ['breakfast', 'lunch', 'dinner'] : ['lunch', 'dinner'];
}

// ---------- 소비기한 ----------
/** 시판 큐브는 소비기한이 없다 (정렬 시 맨 뒤로 가도록 아주 먼 날짜) */
export const NO_EXPIRY = '9999-12-31';

/** 소비기한(마지막 사용 가능일) = 만든 날 + (shelfDays - 1). 시판 큐브는 없음 */
export function expiryDate(cube, shelfDays = DEFAULT_SETTINGS.shelfDays) {
  if (cube.commercial) return NO_EXPIRY;
  return addDays(cube.madeDate, shelfDays - 1);
}
export function daysLeft(cube, today, shelfDays) {
  if (cube.commercial) return Infinity;
  return diffDays(today, expiryDate(cube, shelfDays));
}
export function isUsable(cube, date, shelfDays) {
  return date >= cube.madeDate && date <= expiryDate(cube, shelfDays);
}

export function guessCategory(name) {
  const n = (name || '').replace(/\s/g, '');
  if (/닭|가슴살/.test(n)) return 'chicken';
  if (/소고기|한우|우둔|안심|홍두깨|채끝/.test(n)) return 'beef';
  if (/생선|대구|연어|광어|가자미|도미|흰살|명태|동태|조기|민어|고등어/.test(n)) return 'fish';
  if (/쌀|밥|죽|현미|오트|귀리|찹쌀|미음/.test(n)) return 'rice';
  if (/사과|배$|바나나|딸기|블루베리|복숭아|자두|키위|망고|수박|참외|포도|귤|오렌지|아보카도/.test(n)) return 'fruit';
  if (/두부|치즈|요거트|달걀|계란|노른자/.test(n)) return 'etc';
  return 'veg';
}

// ---------- 재고 배정 ----------
/**
 * 미완료 식단이 이미 잡아둔 큐브 수량.
 * excludeDates(다시 짤 날짜)의 끼니는 빼되, 사용자가 직접 수정한 끼니는 다시 짜지 않으므로 계속 잡아둔다.
 */
export function reservedFromPlans(plans, excludeDates = []) {
  const reserved = {};
  for (const [date, day] of Object.entries(plans || {})) {
    const regen = excludeDates.includes(date);
    for (const meal of Object.values(day.meals || {})) {
      if (meal.done || (regen && !meal.edited)) continue;
      for (const it of meal.items || []) {
        if (it.cubeId) reserved[it.cubeId] = (reserved[it.cubeId] || 0) + it.qty;
      }
    }
  }
  return reserved;
}

export class Allocator {
  constructor(cubes, settings, reserved = {}) {
    this.cubes = cubes;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.avail = new Map(cubes.map((c) => [c.id, Math.max(0, c.count - (reserved[c.id] || 0))]));
  }
  lots(date, pred) {
    const shelf = this.settings.shelfDays;
    return this.cubes
      .filter((c) => pred(c) && this.avail.get(c.id) > 0 && isUsable(c, date, shelf))
      .sort((a, b) => expiryDate(a, shelf).localeCompare(expiryDate(b, shelf)) || a.madeDate.localeCompare(b.madeDate));
  }
  usableQty(date, pred) {
    return this.lots(date, pred).reduce((s, c) => s + this.avail.get(c.id), 0);
  }
  earliestExpiry(date, pred) {
    const l = this.lots(date, pred);
    return l.length ? expiryDate(l[0], this.settings.shelfDays) : null;
  }
  /** 소비기한 임박 순(FEFO)으로 qty만큼 꺼낸다. 부족분은 missing 항목으로 반환. */
  take(date, category, qty, { name, optional = false, missingLabel } = {}) {
    const items = [];
    let need = qty;
    for (const c of this.lots(date, (c) => c.category === category && (!name || c.name === name))) {
      if (need <= 0) break;
      const n = Math.min(need, this.avail.get(c.id));
      this.avail.set(c.id, this.avail.get(c.id) - n);
      items.push({ cubeId: c.id, name: c.name, category, qty: n });
      need -= n;
    }
    if (need > 0 && !optional) {
      items.push({ missing: true, category, name: missingLabel || name || CATEGORIES[category].label, qty: need });
    }
    return items;
  }
  /** 특정 큐브를 지정해서 꺼낸다 (AI 결과 검증용). 가능한 수량만 반환. */
  takeSpecific(date, cubeId, qty) {
    const c = this.cubes.find((x) => x.id === cubeId);
    if (!c || !isUsable(c, date, this.settings.shelfDays)) return null;
    const n = Math.min(qty, this.avail.get(c.id));
    if (n <= 0) return null;
    this.avail.set(c.id, this.avail.get(c.id) - n);
    return { cubeId: c.id, name: c.name, category: c.category, qty: n };
  }
}

const L = (cat) => CATEGORIES[cat].label;
const other = (cat) => (cat === 'chicken' ? 'fish' : 'chicken');

/** 저녁 단백질 선택. { cat, why } — why는 화면에 보여줄 선택 이유 */
function pickDinnerProtein(alloc, date, need, recentDinners = []) {
  const lastDinner = recentDinners.at(-1);
  const ok = ['chicken', 'fish'].filter((cat) => alloc.usableQty(date, (c) => c.category === cat) >= need);
  if (ok.length === 0) {
    // 둘 다 부족하면 남은 쪽이라도 사용
    const any = ['chicken', 'fish'].filter((cat) => alloc.usableQty(date, (c) => c.category === cat) > 0);
    return any[0] ? { cat: any[0], why: `닭고기·생선 모두 부족해 남은 ${L(any[0])} 사용` } : { cat: null, why: '' };
  }
  if (ok.length === 1) return { cat: ok[0], why: `${L(other(ok[0]))} 재고가 없어 ${L(ok[0])}` };
  // 생선은 일주일에 2번 이상(DHA·비타민D): 최근 6일 저녁 중 생선이 2번 미만이면 생선 우선.
  // 단, 닭고기가 오늘·내일 버려질 상황이면 닭고기를 먼저 쓴다.
  const fishWeek = recentDinners.slice(-6).filter((c) => c === 'fish').length;
  const chickenCritical = diffDays(date, alloc.earliestExpiry(date, (c) => c.category === 'chicken')) <= 1;
  if (recentDinners.length >= 4 && fishWeek < 2 && !chickenCritical) {
    return { cat: 'fish', why: `최근 6일 생선 ${fishWeek}번뿐 → 주 2회 생선(DHA·비타민D) 채우기` };
  }
  // 둘 다 가능: 2일 이내 소비기한 임박한 쪽 우선, 아니면 전날과 번갈아
  const urgent = ok.filter((cat) => diffDays(date, alloc.earliestExpiry(date, (c) => c.category === cat)) <= 2);
  if (urgent.length === 1) return { cat: urgent[0], why: `${L(urgent[0])} 소비기한이 임박해 먼저` };
  if (urgent.length === 2) {
    const [a, b] = urgent.map((cat) => alloc.earliestExpiry(date, (c) => c.category === cat));
    if (a !== b) {
      const cat = a < b ? 'chicken' : 'fish';
      return { cat, why: `둘 다 임박, 기한이 더 빠른 ${L(cat)} 먼저` };
    }
  }
  if (lastDinner === 'chicken' || lastDinner === 'fish') {
    return { cat: other(lastDinner), why: `전날 저녁 ${L(lastDinner)} → 번갈아 ${L(other(lastDinner))}` };
  }
  return { cat: 'chicken', why: '닭고기부터 시작해 생선과 번갈아' };
}

/**
 * k종 조합을 고른다 (nutrition.scoreCombo).
 * 1순위 음식 궁합(나쁜 궁합은 제외) → 2순위 영양 보완 → 3순위 소비기한.
 * 나쁜 궁합 없이 k종을 못 채우면 종류 수를 줄인다(부족분은 missing으로 표시).
 * 아무것도 꺼내지 않는다(조회만).
 */
function chooseCombo(alloc, date, category, base, k, minQty, ctx = {}) {
  const shelf = alloc.settings.shelfDays;
  const byName = new Map();
  for (const c of alloc.lots(date, (c) => c.category === category)) {
    const e = byName.get(c.name) || { name: c.name, qty: 0, exp: expiryDate(c, shelf) };
    e.qty += alloc.avail.get(c.id);
    byName.set(c.name, e);
  }
  // 같은 날 앞 끼니에 나온 재료는 절대 다시 쓰지 않는다 (ctx.excludeNames)
  const all = [...byName.values()].filter((v) => v.qty >= minQty);
  const cands = all.filter((v) => !ctx.excludeNames?.has(v.name));
  const sameDayShort = cands.length < all.length;
  const urgency = new Map(cands.map((v) => [v.name, diffDays(date, v.exp)]));
  const sctx = { pairs: alloc.settings.pairs, category, ...ctx, urgency };
  // 단독으로도 나쁜 궁합인 재료는 후보에서 뺀다
  const excludedNotes = [];
  let pool = cands.filter((v) => {
    const r = scoreCombo(base, [v.name], sctx);
    if (r.excluded) excludedNotes.push(...r.bad.map((p) => `${p.a}+${j(p.b, '은', '는')} 궁합이 맞지 않아 제외`));
    return !r.excluded;
  });
  if (pool.length > 10) {
    const solo = new Map(pool.map((v) => [v.name, scoreCombo(base, [v.name], sctx).score]));
    pool = [...pool].sort((a, b) => solo.get(b.name) - solo.get(a.name)).slice(0, 10);
  }
  for (let kk = Math.min(k, pool.length); kk >= 0; kk--) {
    let best = null;
    for (const combo of combinations(pool, kk)) {
      const names = combo.map((v) => v.name);
      const r = scoreCombo(base, names, sctx);
      if (r.excluded) continue;
      const tie = names.reduce((s, n) => s + urgency.get(n), 0);
      if (!best || r.score > best.r.score + 1e-9 || (Math.abs(r.score - best.r.score) < 1e-9 && tie < best.tie)) best = { names, r, tie };
    }
    if (best) return { ...best, excludedNotes: [...new Set(excludedNotes)], pairShort: kk < Math.min(k, pool.length), sameDayShort };
  }
  return { names: [], r: { reasons: [], pairScore: 0 }, excludedNotes, sameDayShort };
}

function pickVeg(alloc, date, s, base, ctx) {
  const best = chooseCombo(alloc, date, 'veg', base, s.vegKindsPerMeal, s.vegCubesEach, ctx);
  const items = [];
  for (const n of best.names) items.push(...alloc.take(date, 'veg', s.vegCubesEach, { name: n }));
  const lacking = s.vegKindsPerMeal - best.names.length;
  if (lacking > 0) {
    const byPair = best.pairShort || best.excludedNotes?.length;
    const label = best.sameDayShort ? `오늘 안 먹은 채소 ${lacking}종` : byPair ? `궁합 맞는 채소 ${lacking}종` : `채소 ${lacking}종`;
    items.push({ missing: true, category: 'veg', name: label, qty: lacking * s.vegCubesEach });
  }
  const rs = best.r.reasons;
  return {
    items,
    pairReasons: rs.filter((x) => x.tier === 1).map((x) => x.text),
    nutriReasons: rs.filter((x) => x.tier === 2).map((x) => x.text),
    excludedNotes: best.excludedNotes || [],
  };
}

/**
 * 한 끼 구성. 규칙: 매끼 밥 / 점심 소고기 / 저녁 닭고기 또는 생선 / 채소 n종 / 아침 단백질·과일(있으면)
 * 채소는 단백질·하루 섭취와의 영양 궁합 점수로 고른다.
 */
export function composeMeal(alloc, date, meal, ctx = {}) {
  const s = alloc.settings;
  const items = [...alloc.take(date, 'rice', s.riceCubesPerMeal)];
  const reasons = [];
  let protein = null;
  if (meal === 'lunch') {
    protein = 'beef';
    items.push(...alloc.take(date, 'beef', s.proteinCubesPerMeal));
  } else if (meal === 'dinner') {
    const pick = pickDinnerProtein(alloc, date, s.proteinCubesPerMeal, ctx.recentDinners || []);
    protein = pick.cat;
    let why = pick.why;
    // 궁합 우선: 지금 단백질과 궁합 맞는 채소가 하나도 없고 다른 단백질은 있으면 바꾼다
    // (번갈아·생선 주 2회 규칙은 유지, 기한 때문에 고른 경우도 유지)
    if (protein && !/임박|부족|재고가 없어/.test(why || '')) {
      const alt = protein === 'chicken' ? 'fish' : 'chicken';
      if (alloc.usableQty(date, (c) => c.category === alt) >= s.proteinCubesPerMeal) {
        const pairOf = (cat) => {
          const lot = alloc.lots(date, (c) => c.category === cat)[0];
          const b = [...items.filter((it) => !it.missing), { name: lot.name, category: cat }];
          return chooseCombo(alloc, date, 'veg', b, s.vegKindsPerMeal, s.vegCubesEach, {}).r.pairScore || 0;
        };
        const cur = pairOf(protein);
        const other = pairOf(alt);
        if (cur === 0 && other > 0) {
          why = `${L(protein)}와 궁합 맞는 채소가 없어 ${L(alt)}`;
          protein = alt;
        }
      }
    }
    if (why) reasons.push(why);
    if (protein) items.push(...alloc.take(date, protein, s.proteinCubesPerMeal, { missingLabel: '닭고기/생선' }));
    else items.push({ missing: true, category: 'chicken', name: '닭고기/생선', qty: s.proteinCubesPerMeal });
  } else if (meal === 'breakfast') {
    // 고기가 없는 아침은 두부·달걀노른자 같은 단백질 큐브가 있으면 1개 더한다
    const lot = alloc.lots(date, (c) => c.category === 'etc' && info(c.name, 'etc').tags.includes('protein'))[0];
    if (lot) {
      items.push(...alloc.take(date, 'etc', 1, { name: lot.name }));
      reasons.push(`고기 없는 아침이라 ${lot.name}로 단백질 보충`);
    }
  }

  const base = items.filter((it) => !it.missing).map((it) => ({ name: it.name, category: it.category }));
  const veg = pickVeg(alloc, date, s, base, {
    protein,
    todayTags: ctx.todayTags,
    todayColors: ctx.todayColors,
    prevVeg: ctx.avoidVeg,
    yesterdayVeg: ctx.yesterdayVeg,
    excludeNames: ctx.excludeVeg,
  });
  items.push(...veg.items);
  // 이유는 궁합 → 영양 보완 순으로
  reasons.push(...veg.pairReasons.slice(0, 2), ...veg.nutriReasons.slice(0, 2), ...veg.excludedNotes.slice(0, 1));
  if (ctx.excludeVeg?.size) reasons.push(`오늘 앞 끼니(${[...ctx.excludeVeg].join('·')})와 겹치지 않게 구성`);

  if (meal === 'breakfast' && s.fruitAtBreakfast) {
    const fb = items.filter((it) => !it.missing).map((it) => ({ name: it.name, category: it.category }));
    const fruit = chooseCombo(alloc, date, 'fruit', fb, 1, 1, { todayTags: ctx.todayTags });
    if (fruit.names[0]) {
      items.push(...alloc.take(date, 'fruit', 1, { name: fruit.names[0] }));
      const fr = fruit.r.reasons.find((r) => r.tier === 1 || /비타민C|흡수/.test(r.text));
      if (fr) reasons.push(fr.text);
    }
  }

  // 소비기한 임박·부족·피할 조합
  const urgent = new Set();
  for (const it of items) {
    if (it.missing) {
      reasons.push(`${it.name} 재고 부족 — 큐브를 만들어야 해요`);
      continue;
    }
    const c = alloc.cubes.find((x) => x.id === it.cubeId);
    const n = c ? daysLeft(c, date, s.shelfDays) : 99;
    if (n <= 2 && !urgent.has(it.name)) {
      urgent.add(it.name);
      reasons.push(`${it.name} 기한 ${n === 0 ? '오늘까지' : `D-${n}`} → 먼저 사용`);
    }
  }
  return { items, protein, reasons };
}

/**
 * 규칙 기반 식단 생성.
 * @param eatenItems  날짜별 이미 먹은 끼니의 재료 (하루 영양 균형·채소 반복 계산용)
 * @param recentDinners 시작일 이전 저녁 단백질 기록 ['chicken','fish',...] (오래된 → 최근)
 * @returns {{ days: Array<{date, meals}>, alloc: Allocator, stockByDay: Object }}
 */
export function buildPlan({ cubes, settings, birth, startDate, days, reserved = {}, skipMeals = {}, eatenItems = {}, recentDinners = [], lastDinner = null }) {
  const alloc = new Allocator(cubes, settings, reserved);
  const out = [];
  const stockByDay = {};
  const dinners = [...recentDinners];
  if (!dinners.length && lastDinner) dinners.push(lastDinner);
  let yesterdayVeg = new Set();
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    stockByDay[date] = Object.fromEntries(
      Object.keys(CATEGORIES).map((cat) => [cat, alloc.usableQty(date, (c) => c.category === cat)]),
    );
    const meals = {};
    // 이미 먹은 끼니도 하루 영양 균형·채소 반복 방지에 반영
    const eaten = eatenItems[date] || [];
    const vegOf = (items) => items.filter((it) => it.category === 'veg' && !it.missing).map((it) => it.name);
    let prevVeg = new Set(vegOf(eaten));
    const day = nutritionCheck(eaten);
    const todayVeg = new Set(prevVeg);
    for (const meal of mealsForDate(birth, date)) {
      if ((skipMeals[date] || []).includes(meal)) continue;
      const { items, protein, reasons } = composeMeal(alloc, date, meal, {
        recentDinners: dinners, avoidVeg: prevVeg, yesterdayVeg, todayTags: day.tags, todayColors: day.colors,
        excludeVeg: new Set(todayVeg), // 같은 날 채소 중복 금지
      });
      if (meal === 'dinner' && protein) dinners.push(protein);
      prevVeg = new Set(vegOf(items));
      prevVeg.forEach((n) => todayVeg.add(n));
      const n = nutritionCheck(items);
      n.tags.forEach((t) => day.tags.add(t));
      n.colors.forEach((c) => day.colors.add(c));
      meals[meal] = { items, done: false, comment: reasons.join(' · ') };
    }
    yesterdayVeg = todayVeg;
    out.push({ date, meals });
  }
  return { days: out, alloc, stockByDay };
}

/**
 * 날짜별로 다시 짜지 않을 끼니(먹은 끼니, includeEdited면 직접 수정한 끼니도)와 그 재료.
 * 재료는 같은 날 채소 중복 금지·하루 영양 계산에 쓰인다.
 */
export function eatenInfo(plans, dates, { includeEdited = false } = {}) {
  const skipMeals = {};
  const eatenItems = {};
  for (const d of dates) {
    const done = Object.entries(plans?.[d]?.meals || {}).filter(([, m]) => m.done || (includeEdited && m.edited));
    skipMeals[d] = done.map(([k]) => k);
    eatenItems[d] = done.flatMap(([, m]) => m.items.filter((it) => !it.missing));
  }
  return { skipMeals, eatenItems };
}

/** 시작일 이전 최근 저녁 단백질 기록 (오래된 → 최근) */
export function recentDinnerProteins(plans, beforeDate, n = 6) {
  return Object.keys(plans || {})
    .filter((d) => d < beforeDate && d >= addDays(beforeDate, -n))
    .sort()
    .map((d) => (plans[d].meals?.dinner?.items || []).find((x) => !x.missing && (x.category === 'chicken' || x.category === 'fish'))?.category)
    .filter(Boolean);
}

export function lastDinnerProtein(plans, beforeDate) {
  return recentDinnerProteins(plans, beforeDate, 30).at(-1) || null;
}

// ---------- 소진 예측 ----------
/**
 * 현재 재고로 규칙 식단을 horizon일 시뮬레이션해서
 * 카테고리별 마지막 사용일·부족 시작일·하루 평균 사용량, 그리고 소비기한 내 못 쓰는 큐브를 예측한다.
 */
export function forecast({ cubes, settings, birth, today, plans = {} }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const horizon = s.forecastHorizon;
  const todayPlan = plans[today];
  const { skipMeals, eatenItems } = eatenInfo(plans, [today]);
  const sim = buildPlan({
    cubes, settings: s, birth, startDate: today, days: horizon, skipMeals, eatenItems, recentDinners: recentDinnerProteins(plans, today),
  });

  const result = {};
  for (const cat of ['rice', 'beef', 'chicken', 'fish']) {
    let used = 0;
    let lastUse = null;
    for (const d of sim.days) {
      for (const m of Object.values(d.meals)) {
        for (const it of m.items) {
          if (it.category === cat && !it.missing) {
            used += it.qty;
            lastUse = d.date;
          }
        }
      }
    }
    const stockOut = sim.days.find((d) => sim.stockByDay[d.date][cat] === 0)?.date || null;
    const usableNow = sim.stockByDay[today]?.[cat] ?? 0;
    const activeDays = lastUse ? diffDays(today, lastUse) + 1 : 0;
    result[cat] = {
      usableNow,
      lastUse,
      stockOut,
      perDay: activeDays ? +(used / activeDays).toFixed(1) : 0,
      makeBy: stockOut ? addDays(stockOut, -1) : null,
    };
  }

  // 소비기한 내 소진 못 하는 큐브 (시뮬레이션 후에도 남았는데 기한이 horizon 안에 끝나는 것)
  const waste = [];
  const lastDay = addDays(today, horizon - 1);
  for (const c of cubes) {
    const left = sim.alloc.avail.get(c.id);
    const exp = expiryDate(c, s.shelfDays);
    if (left > 0 && exp <= lastDay) waste.push({ cube: c, qty: left, expiry: exp });
  }
  // 식단 부족 첫 발생
  const firstShortage = sim.days.find((d) => Object.values(d.meals).some((m) => m.items.some((it) => it.missing)));
  return { categories: result, waste, firstShortage: firstShortage?.date || null, sim };
}

// ---------- 레시피 (9개월 이상) ----------
export const RECIPES = [
  {
    id: 'beef-veg-jinbap', title: '소고기 채소 진밥', needs: [['rice', 2], ['beef', 1], ['veg', 1, 2]],
    extras: ['물 또는 육수 약간'],
    steps: ['{rice} 큐브와 {beef} 큐브를 냄비에 넣고 약불에서 녹인다.', '{veg} 큐브를 넣고 물을 조금씩 추가하며 저어준다.', '쌀알이 퍼지고 되직해지면 불을 끄고 한 김 식힌다.'],
  },
  {
    id: 'beef-rice-ball', title: '소고기 채소 주먹밥', needs: [['rice', 2], ['beef', 1], ['veg', 1, 1]],
    extras: ['참기름 한 방울(선택)', '아기김 약간(선택)'],
    steps: ['{rice}·{beef}·{veg} 큐브를 해동해 수분을 날리며 볶듯이 데운다.', '한 김 식힌 뒤 손에 쥐기 좋은 한입 크기로 뭉친다.', '아기김 가루를 겉에 묻혀 손으로 집어먹게 해준다.'],
  },
  {
    id: 'beef-tofu-steak', title: '소고기 두부 스테이크', needs: [['beef', 2], ['veg', 1, 2]],
    extras: ['두부 1/4모', '쌀가루 또는 전분 1큰술'],
    steps: ['물기를 짠 두부를 으깬다.', '해동한 {beef}·{veg} 큐브와 쌀가루를 넣고 반죽한다.', '작고 납작하게 빚어 약불에 앞뒤로 익힌다.'],
  },
  {
    id: 'beef-porridge-soup', title: '소고기 채소 국밥', needs: [['rice', 2], ['beef', 1], ['veg', 1, 2]],
    extras: ['무염 육수 50ml'],
    steps: ['육수에 {beef}·{veg} 큐브를 넣고 끓인다.', '{rice} 큐브를 넣고 한소끔 더 끓인다.', '건더기가 부드러워지면 미지근하게 식혀 준다.'],
  },
  {
    id: 'chicken-risotto', title: '닭고기 채소 리조또', needs: [['rice', 2], ['chicken', 1], ['veg', 1, 2]],
    extras: ['분유물 또는 아기 치즈 1/2장'],
    steps: ['{chicken}·{veg} 큐브를 팬에서 해동한다.', '{rice} 큐브와 분유물을 넣고 걸쭉해질 때까지 저어준다.', '불을 끄고 아기 치즈를 녹여 섞는다.'],
  },
  {
    id: 'chicken-meatball', title: '닭고기 채소 완자', needs: [['chicken', 2], ['veg', 1, 1]],
    extras: ['쌀가루 1큰술', '달걀노른자 1/2개(알레르기 확인 후)'],
    steps: ['해동한 {chicken}·{veg} 큐브의 물기를 살짝 날린다.', '쌀가루·노른자를 넣고 반죽해 작은 완자로 빚는다.', '찜기에 10분 쪄서 손으로 집어먹게 해준다.'],
  },
  {
    id: 'chicken-soup', title: '닭고기 채소 수프', needs: [['chicken', 1], ['veg', 1, 2]],
    extras: ['분유물 50ml', '쌀가루 1작은술'],
    steps: ['{chicken}·{veg} 큐브를 냄비에 녹인다.', '분유물과 쌀가루를 풀어 넣고 약불에서 저어 걸쭉하게 만든다.', '빵이나 진밥에 곁들여 준다.'],
  },
  {
    id: 'fish-patty', title: '생선 채소 전', needs: [['fish', 2], ['veg', 1, 1]],
    extras: ['쌀가루 1큰술', '달걀노른자 1/2개(알레르기 확인 후)'],
    steps: ['해동한 {fish}·{veg} 큐브에 쌀가루와 노른자를 섞는다.', '팬에 기름을 아주 살짝 두르고 작게 부친다.', '가시가 없는지 한 번 더 확인하고 식혀 준다.'],
  },
  {
    id: 'fish-jinbap', title: '생선 채소 진밥', needs: [['rice', 2], ['fish', 1], ['veg', 1, 2]],
    extras: ['물 약간'],
    steps: ['{rice}·{fish} 큐브를 약불에서 녹인다.', '{veg} 큐브를 넣고 고루 섞으며 익힌다.', '되직하게 졸여지면 식혀서 준다.'],
  },
  {
    id: 'veg-pancake', title: '채소 쌀가루 팬케이크', needs: [['veg', 1, 2]],
    extras: ['쌀가루 2큰술', '분유물 2큰술', '달걀노른자 1/2개(선택)'],
    steps: ['해동한 {veg} 큐브에 쌀가루·분유물을 섞어 반죽한다.', '작은 크기로 앞뒤 노릇하게 부친다.', '스틱 모양으로 잘라 핑거푸드로 준다.'],
  },
  {
    id: 'fruit-yogurt', title: '과일 요거트 간식', needs: [['fruit', 1, 1]],
    extras: ['무가당 아기 요거트 50g'],
    steps: ['{fruit} 큐브를 냉장 해동한다.', '아기 요거트와 섞어 간식으로 준다.'],
  },
];

/** 현재 재고로 만들 수 있는 레시피를 소비기한 임박 큐브 우선으로 채워 반환 */
export function matchRecipes({ cubes, settings, date, reserved = {} }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const out = [];
  for (const r of RECIPES) {
    const alloc = new Allocator(cubes, s, reserved);
    const used = [];
    const names = {};
    let ok = true;
    // 추가 재료(두부·노른자 등)도 궁합 계산에 넣는다
    const extrasBase = r.extras.map((e) => ({ name: e, category: 'etc' }));
    const protein = r.needs.map(([c]) => c).find((c) => ['beef', 'chicken', 'fish'].includes(c)) || null;
    let nutri = { score: 0, reasons: [] };
    for (const [cat, qty, kinds] of r.needs) {
      if (kinds) {
        const base = [...used.map((it) => ({ name: it.name, category: it.category })), ...extrasBase];
        const best = chooseCombo(alloc, date, cat, base, kinds, qty, { protein });
        const chosen = best.names;
        if (chosen.length === 0) { ok = false; break; }
        nutri = { score: nutri.score + best.r.score, reasons: [...nutri.reasons, ...best.r.reasons.map((x) => x.text)] };
        for (const n of chosen) used.push(...alloc.take(date, cat, qty, { name: n }));
        names[cat] = chosen.join('·');
      } else {
        const items = alloc.take(date, cat, qty);
        if (items.some((it) => it.missing)) { ok = false; break; }
        used.push(...items);
        names[cat] = [...new Set(items.map((it) => it.name))].join('·');
      }
    }
    if (!ok || used.some((it) => it.missing)) continue;
    const urgency = Math.min(...used.map((it) => daysLeft(cubes.find((c) => c.id === it.cubeId), date, s.shelfDays)));
    const fill = (t) => t.replace(/\{(\w+)\}/g, (_, k) => names[k] || CATEGORIES[k]?.label || k);
    // 영양 궁합 점수 순, 소비기한 임박 큐브를 쓰는 레시피는 가산
    const rank = nutri.score + (urgency <= 2 ? 3 : 0);
    out.push({ id: r.id, title: r.title, items: used, extras: r.extras, steps: r.steps.map(fill), urgency, rank, why: nutri.reasons.slice(0, 2) });
  }
  return out.sort((a, b) => b.rank - a.rank || a.urgency - b.urgency);
}

// ---------- 소비 처리 ----------
/**
 * items의 수량만큼 큐브 개수를 차감한다. 실제 차감된 수량(applied)을 함께 돌려줘서
 * 되돌릴 때(restoreConsumption) 정확히 그만큼만 복구한다.
 */
export function applyConsumption(cubes, items) {
  const want = {};
  for (const it of items) if (it.cubeId) want[it.cubeId] = (want[it.cubeId] || 0) + it.qty;
  const applied = [];
  const next = cubes.map((c) => {
    if (!want[c.id]) return c;
    const n = Math.min(c.count, want[c.id]);
    if (n > 0) applied.push({ cubeId: c.id, qty: n });
    return { ...c, count: c.count - n };
  });
  return { cubes: next, applied };
}
export function restoreConsumption(cubes, applied) {
  const back = Object.fromEntries((applied || []).map((a) => [a.cubeId, a.qty]));
  return cubes.map((c) => (back[c.id] ? { ...c, count: c.count + back[c.id] } : c));
}
