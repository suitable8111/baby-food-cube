// AI(Claude 또는 Gemini)로 식단/레시피를 추천받는다.
// 정적 사이트라 서버가 없으므로, 사용자가 설정에 입력한 본인 API 키로 브라우저에서 직접 호출한다.
// 두 제공자 모두 JSON 스키마로 응답 형식을 강제하고, 결과는 앱이 다시 검증·보정한다.
import {
  Allocator, CATEGORIES, MEALS, addDays, ageInfo, expiryDate, isUsable, mealsForDate,
} from './logic.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const PROVIDERS = { claude: 'Claude', gemini: 'Gemini' };

export function aiKey(ai) {
  return ai.provider === 'gemini' ? ai.geminiKey : ai.apiKey;
}

function callAI(ai, req) {
  return ai.provider === 'gemini' ? callGemini(ai, req) : callClaude(ai, req);
}

/** JSON Schema → Gemini responseSchema(OpenAPI 부분집합) 변환 */
function toGeminiSchema(s) {
  const out = { type: s.type.toUpperCase() };
  if (s.enum) Object.assign(out, { format: 'enum', enum: s.enum });
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.required = s.required;
    out.propertyOrdering = Object.keys(s.properties);
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

async function callGemini(ai, { system, user, schema }) {
  if (!ai.geminiKey) throw new Error('설정에서 Gemini API 키를 먼저 입력해주세요.');
  const model = ai.geminiModel || 'gemini-2.5-flash';
  let res;
  try {
    res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ai.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
          maxOutputTokens: 16384,
        },
      }),
    });
  } catch {
    throw new Error('Gemini API에 연결하지 못했습니다. 네트워크를 확인해주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || res.statusText;
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Gemini API 키가 올바르지 않습니다.');
    if (res.status === 403) throw new Error('Gemini API 키 권한이 없습니다. AI Studio에서 키를 확인해주세요.');
    if (res.status === 404) throw new Error(`Gemini 모델 '${model}'을 찾을 수 없습니다. 설정에서 모델 이름을 확인해주세요.`);
    if (res.status === 429) throw new Error('Gemini 요청 한도를 넘었습니다. 잠시 후 다시 시도해주세요.');
    throw new Error(`Gemini API 오류 (${res.status}): ${msg}`);
  }
  if (data.promptFeedback?.blockReason) throw new Error('AI가 이 요청에 답하지 않았습니다. 자동 추천을 사용해주세요.');
  const cand = data.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('응답이 너무 길어 잘렸습니다. 추천 일수를 줄여주세요.');
  if (cand?.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason)) {
    throw new Error(`AI 응답이 중단되었습니다 (${cand.finishReason}). 자동 추천을 사용해주세요.`);
  }
  const text = cand?.content?.parts?.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text) throw new Error('AI 응답이 비어 있습니다.');
  return JSON.parse(text);
}

async function callClaude(ai, { system, user, schema }) {
  if (!ai.apiKey) throw new Error('설정에서 Claude API 키를 먼저 입력해주세요.');
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey: ai.apiKey, dangerouslyAllowBrowser: true });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: ai.model || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않습니다.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Claude API에 연결하지 못했습니다. 네트워크를 확인해주세요.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API 오류 (${e.status}): ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('AI가 이 요청에 답하지 않았습니다. 규칙 기반 추천을 사용해주세요.');
  if (msg.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸습니다. 추천 일수를 줄여주세요.');
  const text = msg.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('AI 응답이 비어 있습니다.');
  return JSON.parse(text);
}

function inventoryFor(state, startDate, endDate, reserved) {
  const s = state.settings;
  return state.cubes
    .map((c) => ({ c, avail: c.count - (reserved[c.id] || 0) }))
    .filter(({ c, avail }) => avail > 0 && expiryDate(c, s.shelfDays) >= startDate && c.madeDate <= endDate)
    .map(({ c, avail }) => ({
      cubeId: c.id, name: c.name, category: CATEGORIES[c.category].label, sizeG: c.sizeG,
      available: avail, madeDate: c.madeDate, expiry: expiryDate(c, s.shelfDays),
    }));
}

const SYSTEM_PLAN = `당신은 영유아 이유식 영양사입니다. 부모가 미리 만들어 냉동해 둔 이유식 큐브 재고만으로 식단을 짭니다.
반드시 지킬 규칙:
- 매 끼니 밥(category '밥') 큐브를 포함합니다.
- 점심에는 반드시 소고기 큐브를 넣습니다.
- 저녁에는 반드시 닭고기 또는 생선 큐브를 넣습니다.
- 각 큐브는 소비기한(expiry) 이후 날짜나 만든 날(madeDate) 이전 날짜에 쓰면 안 됩니다.
- 모든 날짜를 합친 큐브 사용량이 available을 넘으면 안 됩니다.
- 소비기한이 임박한 큐브를 먼저 쓰고, 같은 날 같은 채소가 반복되지 않게 다양하게 구성합니다.
- 끼니별 기본 수량은 사용자가 준 값을 따르되, 재고 상황에 맞게 조정할 수 있습니다.
comment에는 이 끼니 조합을 고른 이유(소비기한·재고·영양 균형·맛 궁합 중 해당하는 것)를 한국어 한 문장으로 적습니다.
summary에는 전체 식단을 이렇게 구성한 이유와, 재고가 부족해 곧 만들어야 할 큐브가 있다면 그 내용을 한국어 2~3문장으로 적습니다.`;

/** AI 식단을 받아 앱 식단 형식으로 변환. 규칙 위반·재고 초과는 자동 보정하고 경고로 알려준다. */
export async function aiPlan(state, ai, { startDate, days, reserved }) {
  const endDate = addDays(startDate, days - 1);
  const inventory = inventoryFor(state, startDate, endDate, reserved);
  if (!inventory.length) throw new Error('사용 가능한 큐브가 없습니다.');
  const s = state.settings;
  const schedule = Array.from({ length: days }, (_, i) => {
    const date = addDays(startDate, i);
    return { date, meals: mealsForDate(state.baby.birth, date).map((m) => MEALS[m].label) };
  });
  const age = ageInfo(state.baby.birth, startDate);
  const ids = inventory.map((x) => x.cubeId);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['days', 'summary'],
    properties: {
      summary: { type: 'string' },
      days: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'meals'],
          properties: {
            date: { type: 'string' },
            meals: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['meal', 'items', 'comment'],
                properties: {
                  meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
                  comment: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['cubeId', 'qty'],
                      properties: { cubeId: { type: 'string', enum: ids }, qty: { type: 'integer' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const user = JSON.stringify({
    baby: { ageMonths: age.months, ageDays: age.days },
    schedule,
    perMeal: { riceCubes: s.riceCubesPerMeal, proteinCubes: s.proteinCubesPerMeal, vegKinds: s.vegKindsPerMeal, vegCubesEach: s.vegCubesEach },
    inventory,
  });
  const res = await callAI(ai, { system: SYSTEM_PLAN, user, schema });

  // 검증 및 보정
  const alloc = new Allocator(state.cubes, s, reserved);
  const warnings = [];
  const plans = {};
  for (const { date } of schedule) {
    const aiDay = res.days.find((d) => d.date === date);
    const meals = {};
    for (const meal of mealsForDate(state.baby.birth, date)) {
      const aiMeal = aiDay?.meals.find((m) => m.meal === meal);
      const items = [];
      for (const it of aiMeal?.items || []) {
        const got = alloc.takeSpecific(date, it.cubeId, it.qty);
        if (!got) warnings.push(`${date} ${MEALS[meal].label}: 사용할 수 없는 큐브를 제외했습니다.`);
        else {
          if (got.qty < it.qty) warnings.push(`${date} ${MEALS[meal].label}: ${got.name} 수량을 재고에 맞게 줄였습니다.`);
          items.push(got);
        }
      }
      const has = (cats) => items.some((x) => cats.includes(x.category));
      const fix = (cat) => {
        if (cat === 'protein') {
          const pc = alloc.usableQty(date, (c) => c.category === 'chicken') > 0 ? 'chicken' : 'fish';
          items.push(...alloc.take(date, pc, s.proteinCubesPerMeal, { missingLabel: '닭고기/생선' }));
        } else {
          items.push(...alloc.take(date, cat, cat === 'rice' ? s.riceCubesPerMeal : s.proteinCubesPerMeal));
        }
        warnings.push(`${date} ${MEALS[meal].label}: 규칙에 맞게 ${cat === 'protein' ? '닭고기/생선' : CATEGORIES[cat].label}을(를) 보충했습니다.`);
      };
      if (!has(['rice'])) fix('rice');
      if (meal === 'lunch' && !has(['beef'])) fix('beef');
      if (meal === 'dinner' && !has(['chicken', 'fish'])) fix('protein');
      meals[meal] = { items: mergeItems(items), done: false, comment: aiMeal?.comment || '' };
    }
    plans[date] = { meals, source: 'ai', provider: ai.provider || 'claude' };
  }
  return { plans, summary: res.summary, warnings };
}

function mergeItems(items) {
  const out = [];
  for (const it of items) {
    const prev = out.find((x) => x.cubeId && x.cubeId === it.cubeId);
    if (prev) prev.qty += it.qty;
    else out.push({ ...it });
  }
  return out;
}

const SYSTEM_RECIPE = `당신은 9개월 이상 아기를 위한 이유식(후기) 레시피 전문가입니다.
부모가 냉동해 둔 이유식 큐브를 조합해 만들 수 있는 요리를 추천합니다.
- 큐브는 inventory에 있는 것만, available 이하로 사용합니다. 소비기한이 임박한 큐브를 우선 활용합니다.
- 간(소금·간장·설탕)은 넣지 않습니다. 꿀은 사용하지 않습니다.
- 큐브 외에 필요한 재료(두부, 달걀노른자, 쌀가루, 분유 등)는 extras에 적습니다. 알레르기 주의 재료는 표시합니다.
- 핑거푸드·진밥·완자 등 질감이 다양하게 3~5개 추천합니다. 모든 텍스트는 한국어로 씁니다.`;

export async function aiRecipes(state, ai, { date, reserved }) {
  const inventory = inventoryFor(state, date, date, reserved).filter((x) => {
    const c = state.cubes.find((k) => k.id === x.cubeId);
    return isUsable(c, date, state.settings.shelfDays);
  });
  if (!inventory.length) throw new Error('사용 가능한 큐브가 없습니다.');
  const ids = inventory.map((x) => x.cubeId);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['recipes'],
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'cubes', 'extras', 'steps', 'tip'],
          properties: {
            title: { type: 'string' },
            cubes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['cubeId', 'qty'],
                properties: { cubeId: { type: 'string', enum: ids }, qty: { type: 'integer' } },
              },
            },
            extras: { type: 'array', items: { type: 'string' } },
            steps: { type: 'array', items: { type: 'string' } },
            tip: { type: 'string' },
          },
        },
      },
    },
  };
  const age = ageInfo(state.baby.birth, date);
  const res = await callAI(ai, {
    system: SYSTEM_RECIPE,
    user: JSON.stringify({ baby: { ageMonths: age.months }, date, inventory }),
    schema,
  });
  return res.recipes.map((r, i) => {
    const alloc = new Allocator(state.cubes, state.settings, reserved);
    const items = r.cubes.map((x) => alloc.takeSpecific(date, x.cubeId, x.qty)).filter(Boolean);
    return { id: `ai-${i}`, title: r.title, items: mergeItems(items), extras: r.extras, steps: r.steps, tip: r.tip, ai: true };
  });
}
