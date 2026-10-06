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

// 맛 궁합: 단백질별로 잘 어울리는 채소, 그리고 채소끼리 잘 어울리는 조합
const FLAVOR = {
  beef: ['무', '애호박', '양파', '감자', '버섯', '표고', '시금치', '미역', '당근', '배추', '청경채'],
  chicken: ['단호박', '브로콜리', '감자', '당근', '양파', '고구마', '양배추', '옥수수'],
  fish: ['시금치', '감자', '애호박', '브로콜리', '청경채', '무', '양파', '두부'],
};
const VEG_PAIRS = [
  ['감자', '당근'], ['애호박', '양파'], ['단호박', '양파'], ['브로콜리', '콜리플라워'], ['시금치', '당근'],
  ['양배추', '당근'], ['무', '배추'], ['고구마', '사과'], ['단호박', '브로콜리'], ['감자', '브로콜리'], ['애호박', '당근'],
];
const has = (name, k) => (name || '').includes(k);
/** 받침 유무에 따라 조사 선택: j('당근','은','는') → '당근은' */
export function j(word, withBatchim, without) {
  const ch = (word || '').charCodeAt(word.length - 1);
  const hasB = ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0;
  return word + (hasB ? withBatchim : without);
}

/**
 * 한 끼 채소 조합 점수와 이유.
 * @param base   밥·단백질·기타 등 이미 정해진 재료 [{name, category}]
 * @param vegs   후보 채소 이름 배열
 * @param ctx    { protein, todayTags:Set, todayColors:Set, prevVeg:Set, yesterdayVeg:Set, urgency:Map(name→남은일수) }
 */
export function scoreCombo(base, vegs, ctx = {}) {
  const bi = base.map((b) => info(b.name, b.category));
  const vi = vegs.map((n) => info(n, 'veg'));
  const all = [...bi, ...vi];
  const reasons = [];
  let score = 0;
  const add = (w, text) => {
    score += w;
    if (text) reasons.push({ w, text });
  };

  // 1) 철분 + 비타민C: 비타민C가 철분(특히 채소·곡류의 비헴철) 흡수를 돕는다
  const ironSrc = all.find((i) => i.tags.includes('iron'));
  const vitC = vi.find((i) => i.tags.includes('vitC'));
  if (ironSrc && vitC) add(3, `${vitC.name}의 비타민C가 ${ironSrc.name} 철분 흡수를 도와요`);
  else if (ironSrc && !vitC) add(-1);

  // 2) 베타카로틴 + 지방: 지용성이라 지방과 함께 먹을 때 흡수가 잘 된다
  const car = vi.find((i) => i.tags.includes('carotene'));
  const fat = bi.find((i) => i.tags.includes('fat'));
  if (car && fat) add(2, `${car.name}의 베타카로틴은 ${fat.name}의 지방과 함께 흡수가 잘 돼요`);
  else if (car) add(0.5, `${car.name}에는 참기름·올리브유 한 방울을 더하면 베타카로틴 흡수가 좋아져요`);

  // 3) 비타민D + 칼슘: 비타민D가 칼슘 흡수를 돕는다
  const vd = all.find((i) => i.tags.includes('vitD'));
  const ca = all.find((i) => i.tags.includes('calcium') && i !== vd);
  if (vd && ca) add(1.5, `${vd.name}의 비타민D가 ${ca.name}의 칼슘 흡수를 도와요`);

  // 4) 피할 조합: 옥살산(시금치)이 칼슘 많은 식품(두부·치즈·요거트)의 칼슘 흡수를 방해
  const ox = all.find((i) => i.oxalate);
  const caRich = all.find((i) => i.caRich);
  if (ox && caRich) add(-3, `${j(ox.name, '과', '와')} ${j(caRich.name, '은', '는')} 칼슘 흡수를 방해해 따로 주는 게 좋아요`);

  // 5) 색 다양성: 색이 다르면 서로 다른 항산화·비타민을 고르게 얻는다
  const colors = new Set(vi.map((i) => i.color).filter(Boolean));
  if (colors.size >= 2) add(colors.size - 1, `${[...colors].map((c) => COLORS[c]).join('+')} 서로 다른 색 채소로 영양소를 넓게`);
  // 6) 같은 분류(예: 뿌리채소 둘)보다 다른 분류
  const groups = new Set(vi.map((i) => i.group).filter(Boolean));
  if (groups.size >= 2) add(0.5 * (groups.size - 1));

  // 7) 하루 균형: 오늘 앞 끼니에서 아직 못 채운 영양소·색을 보충
  if (ctx.todayTags) {
    const missing = ['vitC', 'carotene', 'calcium', 'iron', 'folate', 'fiber'].filter(
      (t) => !ctx.todayTags.has(t) && vi.some((i) => i.tags.includes(t)),
    );
    if (missing.length) add(0.8 * missing.length, ctx.todayTags.size ? `오늘 아직 부족한 ${missing.slice(0, 2).map((t) => NUTRIENTS[t]).join('·')} 보충` : null);
    const newColors = [...colors].filter((c) => !ctx.todayColors?.has(c));
    add(0.4 * newColors.length);
  }

  // 8) 맛 궁합
  const pk = ctx.protein && FLAVOR[ctx.protein] ? ctx.protein : null;
  const pName = bi.find((i) => ['beef', 'chicken', 'fish'].includes(i.category))?.name;
  if (pk) {
    const hits = vegs.filter((v) => FLAVOR[pk].some((k) => has(v, k)));
    if (hits.length) add(Math.min(2, hits.length), `${j(pName, '과', '와')} ${j(hits.join('·'), '은', '는')} 맛 궁합이 좋아요`);
  }
  const pair = VEG_PAIRS.find(([a, b]) => vegs.some((v) => has(v, a)) && vegs.some((v) => has(v, b)));
  if (pair) add(1, `${pair[0]}+${j(pair[1], '은', '는')} 함께 먹기 좋은 조합`);

  // 9) 소비기한: 임박하면 가산 (단, 영양 규칙보다 앞서지 않도록 가중치 제한)
  for (const v of vegs) {
    const d = ctx.urgency?.get(v);
    if (d === undefined) continue;
    if (d <= 2) add(4);
    else if (d <= 4) add(1);
  }

  // 10) 반복 피하기
  for (const v of vegs) {
    if (ctx.prevVeg?.has(v)) add(-4.5);
    else if (ctx.yesterdayVeg?.has(v)) add(-0.7);
  }

  // DB에 없는 채소는 영양 계산을 못 하므로 약간 감점
  add(-0.3 * vi.filter((i) => !i.known).length);

  reasons.sort((a, b) => b.w - a.w);
  return { score, reasons: reasons.filter((r) => r.w > 0), warnings: reasons.filter((r) => r.w < 0) };
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
