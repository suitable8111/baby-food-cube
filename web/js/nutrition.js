// 이유식 재료 영양 정보와 조합(궁합) 점수.
// 일반적인 영유아 영양 가이드를 바탕으로 한 단순화된 규칙이며, 의학적 판단을 대신하지 않는다.

export const NUTRIENTS = {
  protein: '단백질',
  iron: '철분',
  vitC: '비타민C',
  carotene: '베타카로틴',
  calcium: '칼슘',
  dha: 'DHA',
  vitD: '비타민D',
  fiber: '식이섬유',
  folate: '엽산',
  fat: '지방',
};
/** 하루 식단에서 챙길 핵심 영양소 (영양 체크 표시용) */
export const KEY_NUTRIENTS = ['protein', 'iron', 'vitC', 'carotene', 'calcium', 'dha', 'fiber'];

export const COLORS = { green: '초록', orange: '주황·노랑', white: '흰색', red: '빨강·보라' };

// [이름 패턴, 정보]. 위에서부터 먼저 맞는 항목을 쓴다.
// tags: 영양 태그 / color: 채소 색 / group: 채소 분류 / caRich: 칼슘이 많은 유제품·두부 / oxalate: 옥살산 많음
const DB = [
  // 단백질
  ['연어', { tags: ['protein', 'dha', 'vitD', 'fat'] }],
  ['고등어|삼치', { tags: ['protein', 'dha', 'vitD', 'fat'] }],
  ['대구|광어|가자미|도미|명태|동태|흰살|조기|민어|생선', { tags: ['protein', 'dha', 'vitD'] }],
  ['닭', { tags: ['protein'] }],
  ['소고기|한우|안심|우둔|홍두깨|채끝', { tags: ['protein', 'iron', 'fat'] }],
  ['두부', { tags: ['protein', 'calcium', 'iron'], caRich: true }],
  ['노른자|달걀|계란', { tags: ['protein', 'iron', 'fat'] }],
  ['치즈', { tags: ['protein', 'calcium', 'fat'], caRich: true }],
  ['요거트|요구르트', { tags: ['protein', 'calcium'], caRich: true }],
  // 곡류
  ['현미|오트|귀리', { tags: ['fiber', 'iron'] }],
  ['쌀|밥|죽|미음', { tags: [] }],
  // 채소
  ['시금치', { tags: ['iron', 'folate', 'carotene', 'vitC'], color: 'green', group: 'leafy', oxalate: true }],
  ['청경채', { tags: ['calcium', 'vitC', 'carotene'], color: 'green', group: 'leafy' }],
  ['아욱|근대', { tags: ['calcium', 'iron', 'carotene'], color: 'green', group: 'leafy' }],
  ['양배추', { tags: ['vitC', 'fiber'], color: 'green', group: 'cruciferous' }],
  ['배추', { tags: ['vitC', 'fiber'], color: 'white', group: 'leafy' }],
  ['브로콜리', { tags: ['vitC', 'folate', 'calcium', 'fiber'], color: 'green', group: 'cruciferous' }],
  ['콜리플라워', { tags: ['vitC', 'fiber'], color: 'white', group: 'cruciferous' }],
  ['당근', { tags: ['carotene', 'fiber'], color: 'orange', group: 'root' }],
  ['단호박', { tags: ['carotene', 'fiber', 'vitC'], color: 'orange', group: 'squash' }],
  ['고구마', { tags: ['carotene', 'fiber', 'vitC'], color: 'orange', group: 'root' }],
  ['옥수수', { tags: ['fiber'], color: 'orange', group: 'grain' }],
  ['애호박|호박', { tags: ['fiber'], color: 'green', group: 'squash' }],
  ['오이', { tags: [], color: 'green', group: 'squash' }],
  ['감자', { tags: ['vitC'], color: 'white', group: 'root' }],
  ['무', { tags: ['vitC', 'fiber'], color: 'white', group: 'root' }],
  ['연근', { tags: ['vitC', 'fiber'], color: 'white', group: 'root' }],
  ['양파', { tags: [], color: 'white', group: 'allium' }],
  ['표고|양송이|느타리|버섯', { tags: ['vitD', 'fiber'], color: 'white', group: 'mushroom' }],
  ['완두|콩', { tags: ['protein', 'iron', 'fiber'], color: 'green', group: 'legume' }],
  ['파프리카|피망', { tags: ['vitC', 'carotene'], color: 'red', group: 'fruitveg' }],
  ['토마토', { tags: ['vitC'], color: 'red', group: 'fruitveg' }],
  ['비트', { tags: ['folate', 'fiber'], color: 'red', group: 'root' }],
  ['가지', { tags: ['fiber'], color: 'red', group: 'fruitveg' }],
  ['미역|다시마', { tags: ['calcium', 'fiber'], color: 'green', group: 'sea' }],
  // 과일
  ['아보카도', { tags: ['fat', 'fiber', 'folate'], color: 'green' }],
  ['키위|딸기|귤|오렌지', { tags: ['vitC', 'fiber'], color: 'red' }],
  ['블루베리', { tags: ['vitC', 'fiber'], color: 'red' }],
  ['바나나', { tags: ['fiber'], color: 'orange' }],
  ['복숭아|망고', { tags: ['vitC', 'carotene'], color: 'orange' }],
  ['사과|배$|^배|수박|참외|포도|자두', { tags: ['fiber'], color: 'red' }],
].map(([p, v]) => [new RegExp(p), v]);

const CATEGORY_DEFAULT = {
  beef: { tags: ['protein', 'iron', 'fat'] },
  chicken: { tags: ['protein'] },
  fish: { tags: ['protein', 'dha', 'vitD'] },
  rice: { tags: [] },
  veg: { tags: [] },
  fruit: { tags: [] },
  etc: { tags: [] },
};

const cache = new Map();
/** 재료 이름 → 영양 정보. known=false면 DB에 없는 재료 (분류 기본값만 적용) */
export function info(name, category) {
  const key = `${category}|${name}`;
  if (cache.has(key)) return cache.get(key);
  const n = (name || '').replace(/\s/g, '');
  const hit = DB.find(([re]) => re.test(n));
  const v = hit ? { ...hit[1], known: true } : { ...(CATEGORY_DEFAULT[category] || { tags: [] }), known: false };
  const res = { name, category, tags: v.tags || [], color: v.color || null, group: v.group || null, caRich: !!v.caRich, oxalate: !!v.oxalate, known: v.known };
  cache.set(key, res);
  return res;
}

// ---------- 음식 궁합 (1순위) ----------
// 기본 궁합 표. 설정 화면에서 가족 기준대로 추가·삭제할 수 있다(state.settings.pairs).
// 토큰 '소고기'·'닭고기'·'생선'은 해당 분류의 모든 큐브와 맞는다.
export const DEFAULT_PAIRS = {
  bad: [
    ['소고기', '고구마', '함께 먹으면 소화가 더디고 궁합이 맞지 않는 조합으로 알려져 있어요'],
    ['시금치', '두부', '시금치의 옥살산이 두부의 칼슘 흡수를 방해해요'],
    ['시금치', '치즈', '시금치의 옥살산이 치즈의 칼슘 흡수를 방해해요'],
    ['시금치', '요거트', '시금치의 옥살산이 요거트의 칼슘 흡수를 방해해요'],
    ['당근', '오이', '오이의 효소가 당근·오이의 비타민C를 파괴한다고 알려져 있어요'],
    ['당근', '무', '당근의 효소가 무의 비타민C를 파괴한다고 알려져 있어요'],
  ],
  good: [
    ['소고기', '무'], ['소고기', '애호박'], ['소고기', '양파'], ['소고기', '감자'], ['소고기', '버섯'],
    ['소고기', '표고'], ['소고기', '양송이'], ['소고기', '새송이'], ['소고기', '시금치'], ['소고기', '미역'],
    ['소고기', '배추'], ['소고기', '청경채'], ['소고기', '브로콜리'], ['소고기', '당근'],
    ['닭고기', '단호박'], ['닭고기', '늙은호박'], ['닭고기', '브로콜리'], ['닭고기', '감자'], ['닭고기', '당근'],
    ['닭고기', '양파'], ['닭고기', '고구마'], ['닭고기', '양배추'], ['닭고기', '옥수수'], ['닭고기', '애호박'], ['닭고기', '버섯'],
    ['생선', '시금치'], ['생선', '감자'], ['생선', '애호박'], ['생선', '브로콜리'], ['생선', '청경채'],
    ['생선', '무'], ['생선', '양파'], ['생선', '두부'], ['생선', '미역'],
    ['감자', '당근'], ['애호박', '양파'], ['단호박', '양파'], ['브로콜리', '콜리플라워'], ['양배추', '당근'],
    ['무', '배추'], ['단호박', '브로콜리'], ['감자', '브로콜리'], ['애호박', '당근'], ['버섯', '양파'],
    ['애호박', '버섯'], ['청경채', '버섯'], ['고구마', '사과'], ['단호박', '사과'],
  ],
};

const CAT_TOKEN = { 소고기: 'beef', 닭고기: 'chicken', 생선: 'fish' };
const has = (name, k) => (name || '').includes(k);
/** 궁합 표의 토큰이 재료와 맞는지 */
export function tokenMatch(token, item) {
  return CAT_TOKEN[token] ? item.category === CAT_TOKEN[token] : has(item.name, token);
}
/** 재료 목록 안에서 궁합 표에 걸리는 조합 찾기 */
export function findPairs(items, pairs = DEFAULT_PAIRS) {
  const hit = (list) => list
    .map(([a, b, why]) => {
      const x = items.find((it) => tokenMatch(a, it));
      const y = items.find((it) => it !== x && tokenMatch(b, it));
      return x && y ? { a: x.name, b: y.name, why } : null;
    })
    .filter(Boolean);
  return { good: hit(pairs.good || []), bad: hit(pairs.bad || []) };
}

/** 받침 유무에 따라 조사 선택: j('당근','은','는') → '당근은' */
export function j(word, withBatchim, without) {
  const ch = (word || '').charCodeAt(word.length - 1);
  const hasB = ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0;
  return word + (hasB ? withBatchim : without);
}

/**
 * 한 끼 채소(또는 과일) 조합 평가. 우선순위:
 *   1순위 음식 궁합 — 나쁜 궁합이 하나라도 있으면 제외(excluded), 좋은 궁합 수가 많을수록 우선
 *   2순위 영양 보완 — 흡수를 돕는 영양 조합, 색 다양성, 하루 중 부족한 영양 보충, 반복 피하기
 *   3순위 소비기한 — 같은 조건이면 기한 임박한 큐브
 * score = 궁합×1000 + 영양×10 + 기한 (상위 순위가 항상 하위 순위를 이긴다)
 *
 * @param base   밥·단백질·기타 등 이미 정해진 재료 [{name, category}]
 * @param vegs   후보 이름 배열
 * @param ctx    { pairs, category, todayTags, todayColors, prevVeg, yesterdayVeg, urgency:Map(name→남은일수) }
 */
export function scoreCombo(base, vegs, ctx = {}) {
  const cat = ctx.category || 'veg';
  const bi = base.map((b) => info(b.name, b.category));
  const vi = vegs.map((n) => info(n, cat));
  const all = [...bi, ...vi];
  const reasons = [];

  // 1순위: 궁합 — 이번에 고르는 재료가 포함된 조합만 본다
  const pr = findPairs(all, ctx.pairs || DEFAULT_PAIRS);
  const involves = (p) => vegs.includes(p.a) || vegs.includes(p.b);
  const bad = pr.bad.filter(involves);
  const good = pr.good.filter(involves);
  if (bad.length) return { excluded: true, bad, score: -Infinity, pairScore: -1, reasons: [], warnings: bad.map((p) => `${p.a}+${p.b}: ${p.why}`) };
  for (const p of good) reasons.push({ tier: 1, w: 1, text: `${p.a}+${j(p.b, '은', '는')} 궁합이 좋은 조합` });
  // 궁합 점수 = 좋은 궁합이 하나 이상 있는 재료 수. (조합 수를 세면 늘 같은 조합만 이겨서 반복된다)
  const pairScore = vegs.filter((v) => good.some((p) => p.a === v || p.b === v)).length;

  // 2순위: 영양 보완
  let nutri = 0;
  const add = (w, text) => {
    nutri += w;
    if (text) reasons.push({ tier: 2, w, text });
  };
  const ironSrc = all.find((i) => i.tags.includes('iron'));
  const vitC = vi.find((i) => i.tags.includes('vitC'));
  if (ironSrc && vitC) add(3, `${vitC.name}의 비타민C가 ${ironSrc.name} 철분 흡수를 도와요`);
  else if (ironSrc) add(-1);

  const car = vi.find((i) => i.tags.includes('carotene'));
  const fat = bi.find((i) => i.tags.includes('fat'));
  if (car && fat) add(2, `${car.name}의 베타카로틴은 ${fat.name}의 지방과 함께 흡수가 잘 돼요`);
  else if (car) add(0.5, `${car.name}에는 참기름·올리브유 한 방울을 더하면 베타카로틴 흡수가 좋아져요`);

  const vd = all.find((i) => i.tags.includes('vitD'));
  const ca = all.find((i) => i.tags.includes('calcium') && i !== vd);
  if (vd && ca) add(1.5, `${vd.name}의 비타민D가 ${ca.name}의 칼슘 흡수를 도와요`);

  const colors = new Set(vi.map((i) => i.color).filter(Boolean));
  if (colors.size >= 2) add(colors.size - 1, `${[...colors].map((c) => COLORS[c]).join('+')} 서로 다른 색 채소로 영양소를 넓게`);
  const groups = new Set(vi.map((i) => i.group).filter(Boolean));
  if (groups.size >= 2) add(0.5 * (groups.size - 1));

  if (ctx.todayTags) {
    const missing = ['vitC', 'carotene', 'calcium', 'iron', 'folate', 'fiber'].filter(
      (t) => !ctx.todayTags.has(t) && vi.some((i) => i.tags.includes(t)),
    );
    if (missing.length) add(0.8 * missing.length, ctx.todayTags.size ? `오늘 아직 부족한 ${missing.slice(0, 2).map((t) => NUTRIENTS[t]).join('·')} 보충` : null);
    add(0.4 * [...colors].filter((c) => !ctx.todayColors?.has(c)).length);
  }
  for (const v of vegs) {
    if (ctx.prevVeg?.has(v)) add(-4.5);
    else if (ctx.yesterdayVeg?.has(v)) add(-0.7);
  }
  add(-0.3 * vi.filter((i) => !i.known).length);

  // 3순위: 소비기한 (0~9점)
  let expiry = 0;
  for (const v of vegs) {
    const d = ctx.urgency?.get(v);
    if (d === undefined) continue;
    if (d <= 2) expiry += 4;
    else if (d <= 4) expiry += 1;
  }
  expiry = Math.min(9, expiry);

  nutri = Math.max(-40, Math.min(40, nutri));
  const score = pairScore * 1000 + nutri * 10 + expiry;
  reasons.sort((a, b) => a.tier - b.tier || b.w - a.w);
  return {
    excluded: false, score, pairScore, nutri, expiry,
    reasons: reasons.filter((r) => r.w > 0),
    warnings: [],
  };
}

export function combinations(arr, k) {
  if (k <= 0) return [[]];
  if (arr.length < k) return [];
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) return out.push([...acc]);
    for (let i = start; i < arr.length; i++) rec(i + 1, [...acc, arr[i]]);
  };
  rec(0, []);
  return out;
}

/** 끼니/하루 재료 목록으로 핵심 영양소 충족 여부 */
export function nutritionCheck(items) {
  const tags = new Set();
  const colors = new Set();
  for (const it of items) {
    if (it.missing) continue;
    const i = info(it.name, it.category);
    i.tags.forEach((t) => tags.add(t));
    if (i.color && (it.category === 'veg' || it.category === 'fruit')) colors.add(i.color);
  }
  return { tags, colors, covered: KEY_NUTRIENTS.filter((t) => tags.has(t)), lacking: KEY_NUTRIENTS.filter((t) => !tags.has(t)) };
}
