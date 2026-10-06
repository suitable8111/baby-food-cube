import {
  CATEGORIES, MEALS, addDays, ageInfo, nineMonthDate, diffDays, todayStr, shortDate, expiryDate, daysLeft, isUsable,
  guessCategory, reservedFromPlans, buildPlan, eatenInfo, recentDinnerProteins, forecast, matchRecipes,
  applyConsumption, restoreConsumption,
} from './logic.js';
import { loadState, saveState, loadAi, saveAi, defaultState, normalizeState, uid } from './store.js';
import { aiPlan, aiRecipes, aiKey, PROVIDERS } from './ai.js';
import { info as nInfo, nutritionCheck, NUTRIENTS, KEY_NUTRIENTS } from './nutrition.js';
import {
  sync, initSync, pushState, signIn, signOutSync, createHousehold, joinHousehold, leaveHousehold, inviteLink,
} from './sync.js';

let state = loadState();
let ai = loadAi();
const today = todayStr();
const ui = {
  tab: (() => { try { return localStorage.getItem('cubeapp.tab') || 'home'; } catch { return 'home'; } })(),
  planStart: today,
  planDays: 3,
  showEmpty: false,
  recipePreview: false,
  aiRecipes: null,
  busy: false,
  catTouched: false,
  joinCode: new URLSearchParams(location.search).get('join') || '',
  pendingRender: false,
};
if (ui.joinCode) {
  ui.tab = 'settings';
  history.replaceState(null, '', location.pathname);
}

// ---------- 유틸 ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const S = () => state.settings;
const cubeById = (id) => state.cubes.find((c) => c.id === id);
const mealKeys = (meals) => Object.keys(meals).sort((a, b) => MEALS[a].order - MEALS[b].order);

function commit() {
  // 클라우드 문서 크기(1MB)를 넘지 않도록 120일 지난 식단은 정리
  const cutoff = addDays(today, -120);
  for (const d of Object.keys(state.plans)) if (d < cutoff) delete state.plans[d];
  saveState(state);
  pushState(state);
  render();
}
/** 입력 중인 칸이 있으면 다 입력할 때까지 다시 그리기를 미룬다 (다른 기기 변경이 들어올 때) */
function safeRender() {
  const a = document.activeElement;
  if (a && a.closest('#main') && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) ui.pendingRender = true;
  else render();
}
document.addEventListener('focusout', () => {
  if (ui.pendingRender) {
    ui.pendingRender = false;
    setTimeout(render, 0);
  }
});
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.className = 'toast'), 3200);
}
function dBadge(n) {
  const cls = n < 0 ? 'bad' : n <= 2 ? 'warn' : n <= 5 ? 'mid' : 'ok';
  const text = n < 0 ? '기한 지남' : n === 0 ? 'D-day' : `D-${n}`;
  return `<span class="badge ${cls}">${text}</span>`;
}
function relDay(date) {
  const n = diffDays(today, date);
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === -1) return '어제';
  return n > 0 ? `${n}일 후` : `${-n}일 전`;
}
function addLog(type, label, items) {
  const entry = { id: uid(), at: new Date().toISOString(), date: today, type, label, items: items.filter((i) => i.cubeId).map((i) => ({ name: i.name, qty: i.qty })) };
  state.log.unshift(entry);
  state.log = state.log.slice(0, 200);
  return entry.id;
}

// ---------- 동기화 표시 ----------
const SYNC_LABEL = {
  loading: ['', '연결 중'],
  'signed-out': ['', '로그인 필요'],
  'no-household': ['', '공유 안 함'],
  syncing: ['mid', '저장 중'],
  synced: ['ok', '동기화됨'],
  offline: ['warn', '오프라인'],
  error: ['bad', '동기화 오류'],
};
function syncBadge() {
  if (sync.status === 'off') return '';
  const [cls, text] = SYNC_LABEL[sync.status] || ['', ''];
  return `<button class="sync-chip ${cls}" data-action="goto-sync" aria-label="동기화 상태: ${text}">☁️ ${text}</button>`;
}

// ---------- 헤더 ----------
function renderHeader() {
  const a = ageInfo(state.baby.birth, today);
  const nine = nineMonthDate(state.baby.birth);
  const toNine = diffDays(today, nine);
  const stage = a.months >= 9
    ? '<span class="pill">아침·점심·저녁 3끼</span>'
    : `<span class="pill">점심·저녁 2끼</span><span class="pill soft">3끼 시작 ${shortDate(nine)} · D-${toNine}</span>`;
  $('#header').innerHTML = `
    <div class="brand">🧊 이유식 큐브 ${syncBadge()}</div>
    <div class="baby">
      <strong>${esc(state.baby.name)}</strong>
      <span>생후 ${a.months}개월 ${a.days}일 · D+${a.totalDays}</span>
    </div>
    <div class="stage">${stage}</div>`;
}

// ---------- 공통: 끼니 카드 ----------
function swapOptions(date, item) {
  const lots = state.cubes.filter((c) => c.category === item.category && (c.count > 0 || c.id === item.cubeId) && isUsable(c, date, S().shelfDays));
  return lots
    .map((c) => `<option value="${c.id}" ${c.id === item.cubeId ? 'selected' : ''}>${esc(c.name)} (${shortDate(c.madeDate)} · ${c.count}개)</option>`)
    .join('');
}
function renderMeal(date, key, meal, { editable = true } = {}) {
  const items = meal.items
    .map((it, idx) => {
      const cat = CATEGORIES[it.category];
      if (it.missing) return `<li class="missing">${cat.emoji} ${esc(it.name)} ×${it.qty} <span class="badge bad">재고 부족</span></li>`;
      const c = cubeById(it.cubeId);
      const grams = c ? ` · ${c.sizeG * it.qty}g` : '';
      const swap = editable && !meal.done
        ? `<select class="swap" aria-label="큐브 변경" data-change="swap" data-date="${date}" data-meal="${key}" data-idx="${idx}">${swapOptions(date, it)}</select>`
        : '';
      return `<li><span>${cat.emoji} <b>${esc(it.name)}</b> ×${it.qty}<small>${grams}</small></span>${swap}</li>`;
    })
    .join('');
  const btn = meal.done
    ? `<button class="ghost sm" data-action="undo" data-date="${date}" data-meal="${key}">되돌리기</button>`
    : `<button class="primary sm" data-action="complete" data-date="${date}" data-meal="${key}">✓ 먹었어요</button>`;
  return `
    <div class="meal ${meal.done ? 'done' : ''}">
      <div class="meal-head">
        <span class="meal-name">${MEALS[key].label}${meal.done ? ' <span class="badge ok">완료</span>' : ''}</span>
        ${btn}
      </div>
      <ul class="items">${items}</ul>
      ${meal.comment ? `<p class="comment">💡 ${esc(meal.comment)}</p>` : ''}
    </div>`;
}

/** 하루 식단의 핵심 영양소 충족 표시 */
function nutritionChips(plan) {
  const items = Object.values(plan.meals).flatMap((m) => m.items);
  const n = nutritionCheck(items);
  const chips = KEY_NUTRIENTS.map((t) => `<span class="nchip ${n.tags.has(t) ? 'on' : ''}">${n.tags.has(t) ? '✓' : '·'} ${NUTRIENTS[t]}</span>`).join('');
  return `<div class="nutri"><span class="nutri-label">하루 영양 체크</span>${chips}<span class="nchip soft">채소 색 ${n.colors.size}가지</span></div>`;
}
function tagChips(c) {
  const i = nInfo(c.name, c.category);
  if (!i.known && !i.tags.length) return '<span class="ntag unknown">영양 정보 없음</span>';
  return i.tags.filter((t) => NUTRIENTS[t]).map((t) => `<span class="ntag">${NUTRIENTS[t]}</span>`).join('');
}

// ---------- 대시보드 ----------
function viewHome() {
  const f = forecast({ cubes: state.cubes, settings: S(), birth: state.baby.birth, today, plans: state.plans });
  const todayPlan = state.plans[today];

  const todayHtml = todayPlan
    ? `<div class="meals">${mealKeys(todayPlan.meals).map((k) => renderMeal(today, k, todayPlan.meals[k])).join('')}</div>${nutritionChips(todayPlan)}`
    : `<div class="empty">오늘 식단이 아직 없어요.<br><button class="primary" data-action="quick-plan">오늘부터 3일 식단 자동으로 짜기</button></div>`;

  // 알림
  const alerts = [];
  const expired = state.cubes.filter((c) => c.count > 0 && daysLeft(c, today, S().shelfDays) < 0);
  for (const c of expired) {
    alerts.push(`<li class="bad">⛔ <b>${esc(c.name)}</b> ${c.count}개 소비기한 지남 (${shortDate(expiryDate(c, S().shelfDays))}) <button class="ghost sm" data-action="discard" data-id="${c.id}">폐기 처리</button></li>`);
  }
  const soon = state.cubes.filter((c) => c.count > 0 && daysLeft(c, today, S().shelfDays) >= 0 && daysLeft(c, today, S().shelfDays) <= 2);
  for (const c of soon) alerts.push(`<li class="warn">⏰ <b>${esc(c.name)}</b> ${c.count}개 ${dBadge(daysLeft(c, today, S().shelfDays))} 먼저 사용하세요</li>`);
  for (const w of f.waste) {
    if (daysLeft(w.cube, today, S().shelfDays) < 0) continue;
    alerts.push(`<li class="warn">🗑️ <b>${esc(w.cube.name)}</b> ${w.qty}개는 지금 식단 규칙대로면 소비기한(${shortDate(w.expiry)}) 안에 다 못 써요 — 레시피·간식으로 활용해보세요</li>`);
  }
  if (f.firstShortage) alerts.push(`<li class="info">📉 ${shortDate(f.firstShortage)}(${relDay(f.firstShortage)})부터 식단에 필요한 큐브가 부족해요</li>`);

  // 소진 예측 (밥·소고기·닭고기 + 생선)
  const fc = ['rice', 'beef', 'chicken', 'fish']
    .map((cat) => {
      const r = f.categories[cat];
      const c = CATEGORIES[cat];
      let main;
      let sub;
      if (r.usableNow === 0) {
        main = '<span class="big bad">재고 없음</span>';
        sub = cat === 'fish' || cat === 'chicken' ? '저녁 단백질은 다른 쪽으로 대체' : '지금 바로 만들어야 해요';
      } else if (!r.stockOut) {
        main = `<span class="big">${S().forecastHorizon}일+</span>`;
        sub = '충분해요';
      } else {
        const d = diffDays(today, r.lastUse || today);
        main = `<span class="big ${d <= 1 ? 'bad' : d <= 3 ? 'warn' : ''}">${r.lastUse ? shortDate(r.lastUse) : '-'}</span>`;
        sub = r.lastUse
          ? `마지막 사용 예정 (${relDay(r.lastUse)})<br><b>${shortDate(r.makeBy)}까지 새로 만들기</b>`
          : '';
        if (r.lastUse && r.makeBy < r.lastUse) sub = `마지막 사용 예정 (${relDay(r.lastUse)})`;
      }
      return `
        <div class="fc">
          <div class="fc-title">${c.emoji} ${c.label}</div>
          ${main}
          <div class="fc-meta">사용 가능 ${r.usableNow}개 · 하루 약 ${r.perDay}개</div>
          <div class="fc-sub">${sub}</div>
        </div>`;
    })
    .join('');

  // 재고 한눈에
  const rows = Object.entries(CATEGORIES).map(([cat, c]) => {
    const lots = state.cubes.filter((x) => x.category === cat && x.count > 0 && daysLeft(x, today, S().shelfDays) >= 0);
    const n = lots.reduce((s, x) => s + x.count, 0);
    const g = lots.reduce((s, x) => s + x.count * x.sizeG, 0);
    const kinds = new Set(lots.map((x) => x.name)).size;
    return { cat, c, n, g, kinds };
  });
  const max = Math.max(1, ...rows.map((r) => r.n));
  const inv = rows
    .map((r) => `
      <div class="inv-row">
        <span class="inv-label">${r.c.emoji} ${r.c.label}</span>
        <div class="bar"><span style="width:${(r.n / max) * 100}%" class="cat-${r.cat}"></span></div>
        <span class="inv-num"><b>${r.n}</b>개${r.n ? ` · ${r.g}g${r.kinds > 1 ? ` · ${r.kinds}종` : ''}` : ''}</span>
      </div>`)
    .join('');

  // 소비기한 타임라인
  const lots = state.cubes
    .filter((c) => c.count > 0)
    .sort((a, b) => expiryDate(a, S().shelfDays).localeCompare(expiryDate(b, S().shelfDays)));
  const timeline = lots.length
    ? lots
        .map((c) => `<li>${dBadge(daysLeft(c, today, S().shelfDays))} ${CATEGORIES[c.category].emoji} <b>${esc(c.name)}</b> ${c.count}개 <small>~${shortDate(expiryDate(c, S().shelfDays))}</small></li>`)
        .join('')
    : '<li class="muted">등록된 큐브가 없어요.</li>';

  const log = state.log.slice(0, 6).map((l) => `<li><small>${l.at.slice(5, 10).replace('-', '/')} ${l.at.slice(11, 16)}</small> ${esc(l.label)} <span class="muted">${l.items.map((i) => `${esc(i.name)}×${i.qty}`).join(', ')}</span></li>`).join('');

  return `
    <section class="card">
      <h2>오늘의 식단 <small>${shortDate(today)}</small></h2>
      ${todayHtml}
    </section>
    ${alerts.length ? `<section class="card"><h2>알림</h2><ul class="alerts">${alerts.join('')}</ul></section>` : ''}
    <section class="card">
      <h2>소진 예상일 <small>지금 재고 + 식단 규칙 기준</small></h2>
      <div class="fc-grid">${fc}</div>
    </section>
    <section class="card">
      <h2>재고 한눈에 <small>사용 가능 큐브</small></h2>
      ${inv}
    </section>
    <section class="card">
      <h2>소비기한 순서 <small>만든 날 포함 ${S().shelfDays}일</small></h2>
      <ul class="timeline">${timeline}</ul>
    </section>
    ${log ? `<section class="card"><h2>최근 기록</h2><ul class="log">${log}</ul></section>` : ''}`;
}

// ---------- 큐브 ----------
const NAME_SUGGEST = ['쌀죽', '진밥', '소고기', '닭안심', '대구살', '연어', '애호박', '당근', '브로콜리', '단호박', '고구마', '감자', '양배추', '시금치', '청경채', '무', '양파', '비트', '배추', '오이', '사과', '배', '바나나'];

function viewCubes() {
  const groups = Object.entries(CATEGORIES)
    .map(([cat, c]) => {
      const lots = state.cubes
        .filter((x) => x.category === cat && (ui.showEmpty || x.count > 0))
        .sort((a, b) => a.madeDate.localeCompare(b.madeDate));
      if (!lots.length) return '';
      const rows = lots
        .map((x) => {
          const dl = daysLeft(x, today, S().shelfDays);
          return `
          <li class="lot ${x.count === 0 ? 'empty-lot' : ''}">
            <div class="lot-info">
              <b>${esc(x.name)}</b> ${x.count > 0 ? dBadge(dl) : '<span class="badge">소진</span>'}
              <small>${shortDate(x.madeDate)} 제조 · ~${shortDate(expiryDate(x, S().shelfDays))} · ${x.sizeG}g/개</small>
              <div class="ntags">${tagChips(x)}</div>
            </div>
            <div class="lot-count">
              <button class="icon" data-action="dec" data-id="${x.id}" aria-label="1개 사용">−</button>
              <span><b>${x.count}</b>/${x.initialCount}</span>
              <button class="icon" data-action="inc" data-id="${x.id}" aria-label="1개 추가">+</button>
            </div>
            <div class="lot-actions">
              ${x.count > 0 ? `<button class="ghost sm" data-action="discard" data-id="${x.id}">폐기</button>` : ''}
              <button class="ghost sm danger" data-action="delete" data-id="${x.id}">삭제</button>
            </div>
          </li>`;
        })
        .join('');
      const total = lots.reduce((s, x) => s + x.count, 0);
      return `<div class="group"><h3>${c.emoji} ${c.label} <small>${total}개</small></h3><ul class="lots">${rows}</ul></div>`;
    })
    .join('');

  return `
    <section class="card">
      <h2>큐브 등록</h2>
      <form id="cube-form" class="form-grid" autocomplete="off">
        <label>재료명<input name="name" list="name-list" required placeholder="예: 소고기, 애호박"></label>
        <datalist id="name-list">${NAME_SUGGEST.map((n) => `<option value="${n}">`).join('')}</datalist>
        <label>분류
          <select name="category">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.emoji} ${c.label}</option>`).join('')}</select>
        </label>
        <label>만든 날짜<input type="date" name="madeDate" value="${today}" max="${today}" required></label>
        <label>용량 (g/개)<input type="number" name="sizeG" value="30" min="1" step="1" required inputmode="numeric"></label>
        <label>개수<input type="number" name="count" value="6" min="1" step="1" required inputmode="numeric"></label>
        <div class="expiry-preview" id="expiry-preview">${expiryText(today)}</div>
        <button class="primary full" type="submit">등록하기</button>
      </form>
    </section>
    <section class="card">
      <div class="row-between">
        <h2>보유 큐브</h2>
        <label class="check"><input type="checkbox" data-change="show-empty" ${ui.showEmpty ? 'checked' : ''}> 다 쓴 큐브 보기</label>
      </div>
      ${groups || '<p class="empty">아직 등록된 큐브가 없어요. 위에서 등록하거나 설정에서 예시 데이터를 불러와 보세요.</p>'}
    </section>`;
}
function expiryText(made) {
  if (!made) return '';
  const exp = expiryDate({ madeDate: made }, S().shelfDays);
  return `소비기한: <b>${shortDate(exp)}</b>까지 (${relDay(exp)}) · 만든 날 포함 ${S().shelfDays}일`;
}

// ---------- 식단 ----------
/** 자동 추천 / AI 추천이 각각 왜 이렇게 설계됐는지 */
function viewRationale() {
  const s = S();
  return `
    <details class="why">
      <summary>왜 이렇게 추천하나요?</summary>
      <h3>⚡ 자동 추천 (규칙 기반)</h3>
      <p class="small muted">인터넷·API 키 없이 항상 같은 기준으로 동작해요. 끼니의 뼈대(밥·단백질)는 고정하고, 채소는 <b>영양 궁합 점수</b>가 가장 높은 조합을 골라요. 소비기한은 점수의 한 요소일 뿐이에요.</p>
      <table class="why-table">
        <tr><th>매끼 밥 ${s.riceCubesPerMeal}개</th><td>탄수화물은 이유식의 주 에너지원이라 모든 끼니의 기본으로 고정했어요.</td></tr>
        <tr><th>점심 = 소고기</th><td>생후 6개월 무렵부터 몸에 저장된 철분이 줄어들어, 흡수가 잘 되는 소고기(헴철)를 <b>매일</b> 먹이는 것이 일반적인 권장이에요. 점심에 고정하면 하루도 빠지지 않고, 낮에 먹여서 소화나 피부 반응도 살펴보기 쉬워요.</td></tr>
        <tr><th>저녁 = 닭고기 또는 생선</th><td>단백질 종류를 다양하게 하려고 <b>전날과 번갈아</b> 줘요. 생선(DHA·비타민D)은 <b>주 2회 이상</b>이 되도록, 최근 6일에 2번 미만이면 생선을 먼저 넣어요.</td></tr>
      </table>
      <h3>🥦 채소 조합 규칙 (영양 궁합 점수)</h3>
      <table class="why-table">
        <tr><th>철분 + 비타민C <span class="pts">+3</span></th><td>비타민C는 철분(특히 채소·곡류의 비헴철) 흡수를 높여요. 소고기 점심엔 브로콜리·양배추·감자·무 같은 비타민C 채소를 우선해요.</td></tr>
        <tr><th>베타카로틴 + 지방 <span class="pts">+2</span></th><td>당근·단호박·고구마의 베타카로틴은 지용성이라 소고기·연어·노른자의 지방과 함께 흡수가 잘 돼요. 기름기 적은 닭·흰살생선엔 참기름 한 방울을 권해요.</td></tr>
        <tr><th>비타민D + 칼슘 <span class="pts">+1.5</span></th><td>생선·버섯의 비타민D가 브로콜리·청경채·두부의 칼슘 흡수를 도와요.</td></tr>
        <tr><th>피할 조합 <span class="pts bad">−3</span></th><td>시금치의 옥살산은 두부·치즈·요거트의 칼슘 흡수를 방해해 같은 끼니에 넣지 않아요.</td></tr>
        <tr><th>색 다양성 <span class="pts">+1/색</span></th><td>초록·주황·흰색·빨강 채소는 서로 다른 비타민·항산화 성분을 갖고 있어 색이 다른 채소끼리 묶어요.</td></tr>
        <tr><th>하루 균형 <span class="pts">+0.8/개</span></th><td>앞 끼니에서 못 채운 비타민C·베타카로틴·칼슘·철분·엽산·식이섬유를 다음 끼니에서 보충해요.</td></tr>
        <tr><th>맛 궁합 <span class="pts">+1~2</span></th><td>소고기+무·애호박·버섯, 닭고기+단호박·브로콜리, 생선+시금치·감자처럼 잘 어울리는 조합을 더해요.</td></tr>
        <tr><th>소비기한 <span class="pts">+4/+1</span></th><td>2일 이내 남은 큐브는 +4, 4일 이내는 +1. 만든 날 포함 ${s.shelfDays}일 원칙을 지키되 영양 규칙을 덮어쓰진 않아요.</td></tr>
        <tr><th>반복 피하기 <span class="pts bad">−4.5/−0.7</span></th><td>바로 앞 끼니와 같은 채소 −4.5 (기한 임박 가산 +4보다 크게 해서 같은 날 반복을 막아요), 전날 먹은 채소 −0.7.</td></tr>
      </table>
      <p class="small muted">식단 카드의 <b>영양 체크</b>는 하루 동안 단백질·철분·비타민C·베타카로틴·칼슘·DHA·식이섬유를 채웠는지 보여줘요. 큐브 탭에서 재료별 영양 태그도 확인할 수 있어요. 목록에 없는 재료는 궁합 계산에서 빠져요.</p>
      <h3>기타 규칙</h3>
      <table class="why-table">
        <tr><th>기한 지난 큐브 제외</th><td>안전을 위해 기한이 지난 큐브는 절대 추천하지 않고 폐기 알림을 띄워요.</td></tr>
        <tr><th>9개월부터 아침 추가</th><td>후기 이유식(9개월~)부터는 하루 3끼가 일반적이라, 9개월이 되는 날(${shortDate(nineMonthDate(state.baby.birth))})부터 자동으로 아침이 들어가요.${s.fruitAtBreakfast ? ' 아침에는 가볍게 과일 큐브를 곁들여요.' : ''}</td></tr>
        <tr><th>끼니 양</th><td>정해진 정답이 없어서 설정에서 끼니당 큐브 수를 조절할 수 있게 했어요. 아기가 먹는 양에 맞춰 바꿔주세요.</td></tr>
      </table>
      <h3>✨ AI 추천 (Claude / Gemini)</h3>
      <p class="small muted">위와 <b>같은 규칙</b>을 AI에게 알려주고, 규칙만으로는 하기 어려운 판단을 맡겨요.</p>
      <table class="why-table">
        <tr><th>쓰는 이유</th><td>위 영양 궁합 규칙과 재료별 영양 태그를 그대로 AI에게 주고, 점수표로는 표현하기 어려운 판단(조리 질감, 며칠에 걸친 메뉴 흐름, 재고가 애매할 때의 수량 배분)을 맡겨요. 끼니마다 어떤 영양을 서로 보완하는지 설명해줘요.</td></tr>
        <tr><th>안전장치</th><td>AI는 실제로 있는 큐브 ID 중에서만 고르도록 형식을 강제해요. 결과가 오면 앱이 기한·재고·필수 규칙(밥/소고기/닭·생선)을 <b>다시 검사</b>하고, 틀린 부분은 자동으로 고친 뒤 보정한 내용을 알려줘요.</td></tr>
        <tr><th>Claude / Gemini</th><td>둘 중 가진 키로 선택할 수 있어요. Claude Opus 5.5는 꼼꼼한 판단, Gemini Flash는 빠르고 저렴한 쪽이에요.</td></tr>
        <tr><th>API 키</th><td>서버 없는 앱이라 본인 키로 브라우저에서 바로 호출해요. 키는 이 기기에만 저장되고 클라우드 공유·백업 파일에는 들어가지 않아요.</td></tr>
      </table>
      <p class="small muted">※ 일반적인 이유식 가이드를 바탕으로 한 기본값이에요. 아기 상태에 따른 판단은 소아과 상담을 우선해주세요.</p>
    </details>`;
}

function viewPlan() {
  const dates = Object.keys(state.plans)
    .filter((d) => d >= addDays(today, -2))
    .sort();
  const missingCount = dates.reduce((s, d) => s + Object.values(state.plans[d].meals).filter((m) => !m.done && m.items.some((i) => i.missing)).length, 0);
  const days = dates
    .map((d) => {
      const p = state.plans[d];
      return `
      <div class="day ${d === today ? 'is-today' : ''}">
        <div class="day-head">
          <h3>${shortDate(d)} <small>${relDay(d)}</small> ${p.source === 'ai' ? `<span class="badge ai">AI · ${PROVIDERS[p.provider] || 'Claude'}</span>` : '<span class="badge">자동</span>'}</h3>
          <button class="ghost sm" data-action="del-plan" data-date="${d}">삭제</button>
        </div>
        <div class="meals">${mealKeys(p.meals).map((k) => renderMeal(d, k, p.meals[k])).join('')}</div>
        ${nutritionChips(p)}
      </div>`;
    })
    .join('');
  return `
    <section class="card">
      <h2>식단 추천</h2>
      <p class="muted small">규칙: 매끼 밥 · 점심 소고기 · 저녁 닭고기 또는 생선 · 채소 ${S().vegKindsPerMeal}종. 9개월 미만은 점심·저녁, 9개월(${shortDate(nineMonthDate(state.baby.birth))})부터 아침 추가. 소비기한 임박 큐브부터 사용해요.</p>
      <div class="form-grid">
        <label>시작일<input type="date" data-change="plan-start" value="${ui.planStart}"></label>
        <label>기간
          <select data-change="plan-days">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === ui.planDays ? 'selected' : ''}>${n}일</option>`).join('')}</select>
        </label>
      </div>
      <div class="btn-row">
        <button class="primary" data-action="gen-rule" ${ui.busy ? 'disabled' : ''}>⚡ 자동 추천</button>
        <button class="accent" data-action="gen-ai" ${ui.busy ? 'disabled' : ''}>${ui.busy === 'plan' ? '<span class="spin"></span> AI가 고민 중…' : '✨ AI 추천'}</button>
      </div>
      <p class="muted small">AI: <b>${PROVIDERS[ai.provider]}</b> (설정에서 변경) · 이미 먹은 끼니는 유지되고, 아직 안 먹은 끼니만 새로 짜요. 각 끼니의 💡는 그 조합을 고른 이유예요.</p>
      ${viewRationale()}
    </section>
    ${ui.aiSummary ? `
    <section class="card ai-summary">
      <div class="row-between"><h2>✨ AI 추천 이유</h2><button class="ghost sm" data-action="close-summary">닫기</button></div>
      <p>${esc(ui.aiSummary.summary)}</p>
      ${ui.aiSummary.warnings.length ? `<details><summary class="small muted">앱이 규칙에 맞게 보정한 내용 ${ui.aiSummary.warnings.length}건</summary><ul class="small">${ui.aiSummary.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    </section>` : ''}
    ${missingCount ? `<section class="card warn-card">⚠️ 재고가 부족한 끼니가 ${missingCount}개 있어요. 큐브를 더 만들어 등록한 뒤 다시 추천받으세요.</section>` : ''}
    ${days || '<section class="card empty">아직 식단이 없어요. 위에서 추천을 받아보세요.</section>'}`;
}

// ---------- 레시피 ----------
function recipeCard(r) {
  const items = r.items.map((it) => `<li>${CATEGORIES[it.category].emoji} ${esc(it.name)} ×${it.qty}</li>`).join('');
  return `
    <div class="recipe">
      <h3>${esc(r.title)} ${r.ai ? '<span class="badge ai">AI</span>' : ''}</h3>
      <div class="recipe-cols">
        <div><h4>큐브</h4><ul class="chips">${items}</ul></div>
        ${r.extras?.length ? `<div><h4>추가 재료</h4><ul class="chips soft">${r.extras.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${r.why?.length ? `<p class="comment">🥦 ${r.why.map(esc).join(' · ')}</p>` : ''}
      ${r.tip ? `<p class="comment">💡 ${esc(r.tip)}</p>` : ''}
      <button class="primary sm" data-action="cook" data-id="${r.id}">이 요리 만들기 (재고 차감)</button>
    </div>`;
}
function currentRecipes() {
  const reserved = reservedFromPlans(state.plans);
  return matchRecipes({ cubes: state.cubes, settings: S(), date: today, reserved });
}
function viewRecipes() {
  const a = ageInfo(state.baby.birth, today);
  const nine = nineMonthDate(state.baby.birth);
  const locked = a.months < 9 && !ui.recipePreview;
  if (locked) {
    return `
      <section class="card center">
        <div class="lock">🔒</div>
        <h2>9개월부터 열려요</h2>
        <p>${shortDate(nine)}(D-${diffDays(today, nine)})부터 큐브를 조합한 요리 레시피를 추천해드려요.<br>지금은 큐브 그대로 데워 먹이는 시기예요.</p>
        <button class="ghost" data-action="recipe-preview">미리 보기</button>
      </section>`;
  }
  const rs = currentRecipes();
  return `
    <section class="card">
      <h2>오늘 만들 수 있는 요리</h2>
      <p class="muted small">식단에 이미 잡힌 큐브는 빼고, 소비기한 임박한 큐브를 우선 사용해요. 간은 하지 않아요.</p>
      <div class="btn-row">
        <button class="accent" data-action="ai-recipe" ${ui.busy ? 'disabled' : ''}>${ui.busy === 'recipe' ? '<span class="spin"></span> AI가 레시피 고르는 중…' : '✨ AI 레시피 추천'}</button>
      </div>
    </section>
    ${ui.aiRecipes ? ui.aiRecipes.map(recipeCard).join('') : ''}
    ${rs.length ? rs.map(recipeCard).join('') : '<section class="card empty">지금 재고로 만들 수 있는 기본 레시피가 없어요.</section>'}`;
}

// ---------- 설정 ----------
function viewSync() {
  if (sync.status === 'off') {
    return `
      <section class="card" id="sync">
        <h2>☁️ 가족 공유 (클라우드 동기화)</h2>
        <p class="muted small">아직 Firebase 설정이 연결되지 않았어요. 연결되면 구글 로그인으로 여러 기기에서 같은 기록을 볼 수 있어요.</p>
      </section>`;
  }
  const err = sync.error ? `<p class="sync-err">⚠️ ${esc(sync.error)}</p>` : '';
  let body;
  if (sync.status === 'loading') {
    body = '<p class="muted"><span class="spin"></span> 연결 중…</p>';
  } else if (!sync.user) {
    body = `
      <p class="muted small">구글 계정으로 로그인하면 이 기록을 클라우드에 저장하고, 가족과 실시간으로 함께 쓸 수 있어요.</p>
      ${ui.joinCode ? '<p class="small"><b>초대 링크로 들어왔어요.</b> 로그인하면 바로 참여할 수 있어요.</p>' : ''}
      <button class="primary full" data-action="sync-login">Google로 로그인</button>`;
  } else if (!sync.householdId) {
    body = `
      <p class="small">👤 ${esc(sync.user.name)} <button class="ghost sm" data-action="sync-logout">로그아웃</button></p>
      <div class="sync-choice">
        <div>
          <h3>처음 시작하는 기기라면</h3>
          <p class="muted small">이 기기의 지금 기록으로 공유 공간을 만들어요.</p>
          <button class="primary full" data-action="sync-create">공유 공간 만들기</button>
        </div>
        <div>
          <h3>가족이 이미 만들었다면</h3>
          <p class="muted small">받은 초대 코드를 넣으세요. 이 기기 기록은 공유 공간 기록으로 바뀌어요.</p>
          <input id="join-code" placeholder="초대 코드" value="${esc(ui.joinCode)}" autocomplete="off" autocapitalize="off">
          <button class="accent full" data-action="sync-join">참여하기</button>
        </div>
      </div>`;
  } else {
    const [cls, text] = SYNC_LABEL[sync.status] || ['', ''];
    body = `
      <p class="small">👤 ${esc(sync.user.name)} · <span class="badge ${cls}">${text}</span>${sync.updatedBy ? ` <span class="muted">마지막 저장: ${esc(sync.updatedBy)}</span>` : ''}</p>
      <label class="small muted">초대 코드
        <div class="code-row"><input readonly value="${esc(sync.householdId)}" aria-label="초대 코드"><button class="ghost sm" data-action="copy-invite">링크 복사</button></div>
      </label>
      <p class="muted small">가족에게 링크를 보내면, 구글 로그인 후 같은 기록을 함께 써요. 링크는 가족에게만 공유하세요.</p>
      <div class="btn-row wrap">
        <button class="ghost" data-action="sync-leave">이 기기 공유 끊기</button>
        <button class="ghost" data-action="sync-logout">로그아웃</button>
      </div>`;
  }
  return `<section class="card" id="sync"><h2>☁️ 가족 공유 (클라우드 동기화)</h2>${err}${body}</section>`;
}

function viewSettings() {
  const num = (key, label, min, max, hint = '') => `
    <label>${label}<input type="number" min="${min}" max="${max}" step="1" value="${S()[key]}" data-change="setting" data-key="${key}" inputmode="numeric">${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `
    ${viewSync()}
    <section class="card">
      <h2>아기 정보</h2>
      <div class="form-grid">
        <label>이름<input value="${esc(state.baby.name)}" data-change="baby" data-key="name"></label>
        <label>생년월일<input type="date" value="${state.baby.birth}" data-change="baby" data-key="birth"></label>
      </div>
    </section>
    <section class="card">
      <h2>식단 기준</h2>
      <div class="form-grid">
        ${num('riceCubesPerMeal', '끼니당 밥 큐브', 1, 6)}
        ${num('proteinCubesPerMeal', '끼니당 고기·생선 큐브', 1, 4)}
        ${num('vegKindsPerMeal', '끼니당 채소 종류', 0, 4)}
        ${num('vegCubesEach', '채소 종류당 큐브', 1, 3)}
        ${num('shelfDays', '소비기한 (일)', 1, 30, '원칙: 14일 내 소진')}
        <label class="check"><input type="checkbox" data-change="fruit" ${S().fruitAtBreakfast ? 'checked' : ''}> 아침에 과일 큐브 곁들이기</label>
      </div>
    </section>
    <section class="card">
      <h2>AI 추천</h2>
      <p class="muted small">사용할 AI를 고르고 해당 API 키를 넣어주세요. 키는 이 기기 브라우저에만 저장되고 클라우드 공유·백업 파일에는 포함되지 않아요. 키 없이도 ⚡ 자동 추천은 그대로 쓸 수 있어요.</p>
      <div class="seg" role="radiogroup" aria-label="AI 선택">
        ${Object.entries(PROVIDERS).map(([k, l]) => `<button role="radio" aria-checked="${ai.provider === k}" class="${ai.provider === k ? 'on' : ''}" data-action="ai-provider" data-p="${k}">${l}${aiKey({ ...ai, provider: k }) ? ' ✓' : ''}</button>`).join('')}
      </div>
      ${ai.provider === 'gemini' ? `
      <p class="muted small">키 발급: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio → API 키</a></p>
      <div class="form-grid">
        <label class="wide">Gemini API 키<input type="password" value="${esc(ai.geminiKey)}" placeholder="AIza..." data-change="ai" data-key="geminiKey" autocomplete="off"></label>
        <label class="wide">모델<input value="${esc(ai.geminiModel)}" list="gemini-models" data-change="ai" data-key="geminiModel" autocomplete="off"><small>목록에 없는 최신 모델 이름도 입력할 수 있어요</small></label>
        <datalist id="gemini-models"><option value="gemini-2.5-flash"><option value="gemini-2.5-pro"><option value="gemini-2.5-flash-lite"></datalist>
      </div>` : `
      <p class="muted small">키 발급: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console → API Keys</a></p>
      <div class="form-grid">
        <label class="wide">Claude API 키<input type="password" value="${esc(ai.apiKey)}" placeholder="sk-ant-..." data-change="ai" data-key="apiKey" autocomplete="off"></label>
        <label class="wide">모델
          <select data-change="ai" data-key="model">
            ${[['claude-opus-5-5', 'Claude Opus 5.5 (기본)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (저렴)']].map(([v, l]) => `<option value="${v}" ${ai.model === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>`}
    </section>
    <section class="card">
      <h2>데이터</h2>
      <p class="muted small">데이터는 이 기기 브라우저에 저장되고, 가족 공유를 켜면 클라우드에도 저장돼요. 내보내기로 백업 파일을 따로 받아둘 수 있어요.</p>
      <div class="btn-row wrap">
        <button class="ghost" data-action="export">📤 내보내기</button>
        <label class="ghost button">📥 가져오기<input type="file" accept="application/json" data-change="import" hidden></label>
        <button class="ghost" data-action="sample">🧪 예시 데이터</button>
        <button class="ghost danger" data-action="reset">초기화</button>
      </div>
    </section>`;
}

// ---------- 렌더 ----------
const VIEWS = { home: viewHome, cubes: viewCubes, plan: viewPlan, recipes: viewRecipes, settings: viewSettings };
function render() {
  renderHeader();
  $('#main').innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
}

// ---------- 동작 ----------
function generateRule(start, days) {
  const range = Array.from({ length: days }, (_, i) => addDays(start, i));
  const reserved = reservedFromPlans(state.plans, range);
  const { skipMeals, eatenItems } = eatenInfo(state.plans, range);
  const out = buildPlan({
    cubes: state.cubes, settings: S(), birth: state.baby.birth, startDate: start, days, reserved, skipMeals, eatenItems,
    recentDinners: recentDinnerProteins(state.plans, start),
  });
  for (const d of out.days) mergeDay(d.date, d.meals, 'auto');
}
function mergeDay(date, meals, source) {
  const kept = Object.fromEntries(Object.entries(state.plans[date]?.meals || {}).filter(([, m]) => m.done));
  state.plans[date] = { meals: { ...meals, ...kept }, source };
}
function ensureCubes() {
  if (state.cubes.some((c) => c.count > 0)) return true;
  toast('먼저 큐브를 등록해주세요.', 'bad');
  return false;
}

const actions = {
  'quick-plan'() {
    if (!ensureCubes()) return;
    generateRule(today, 3);
    commit();
    toast('오늘부터 3일 식단을 짰어요.');
  },
  'gen-rule'() {
    if (!ensureCubes()) return;
    generateRule(ui.planStart, ui.planDays);
    commit();
    toast(`${ui.planDays}일 식단을 짰어요.`);
  },
  async 'gen-ai'() {
    if (!ensureCubes()) return;
    if (!aiKey(ai)) {
      toast(`설정에서 ${PROVIDERS[ai.provider]} API 키를 입력해주세요.`, 'bad');
      ui.tab = 'settings';
      return render();
    }
    ui.busy = 'plan';
    render();
    try {
      const range = Array.from({ length: ui.planDays }, (_, i) => addDays(ui.planStart, i));
      const reserved = reservedFromPlans(state.plans, range);
      const res = await aiPlan(state, ai, { startDate: ui.planStart, days: ui.planDays, reserved });
      for (const [d, p] of Object.entries(res.plans)) mergeDay(d, p.meals, 'ai');
      saveState(state);
      ui.aiSummary = { summary: res.summary, warnings: res.warnings };
      toast(res.warnings.length ? `AI 식단 완료 (자동 보정 ${res.warnings.length}건)` : 'AI 식단을 짰어요.');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      ui.busy = false;
      render();
    }
  },
  complete(el) {
    const meal = state.plans[el.dataset.date].meals[el.dataset.meal];
    if (meal.items.some((i) => i.missing) && !confirm('부족한 항목은 빼고 있는 큐브만 차감할까요?')) return;
    const { cubes, applied } = applyConsumption(state.cubes, meal.items);
    state.cubes = cubes;
    meal.done = true;
    meal.applied = applied;
    meal.logId = addLog('meal', `${shortDate(el.dataset.date)} ${MEALS[el.dataset.meal].label}`, meal.items);
    commit();
    toast('맛있게 먹었어요! 재고에서 차감했어요.');
  },
  undo(el) {
    const meal = state.plans[el.dataset.date].meals[el.dataset.meal];
    state.cubes = restoreConsumption(state.cubes, meal.applied);
    state.log = state.log.filter((l) => l.id !== meal.logId);
    meal.done = false;
    delete meal.applied;
    delete meal.logId;
    commit();
    toast('되돌렸어요.');
  },
  'del-plan'(el) {
    const p = state.plans[el.dataset.date];
    if (Object.values(p.meals).some((m) => m.done) && !confirm('먹은 기록이 있는 날이에요. 식단만 지우고 재고는 그대로 둘까요?')) return;
    delete state.plans[el.dataset.date];
    commit();
  },
  dec(el) {
    const c = cubeById(el.dataset.id);
    if (c.count <= 0) return;
    c.count--;
    addLog('manual', '직접 사용', [{ cubeId: c.id, name: c.name, qty: 1 }]);
    commit();
  },
  inc(el) {
    const c = cubeById(el.dataset.id);
    c.count++;
    c.initialCount = Math.max(c.initialCount, c.count);
    commit();
  },
  discard(el) {
    const c = cubeById(el.dataset.id);
    if (!confirm(`${c.name} ${c.count}개를 폐기 처리할까요?`)) return;
    addLog('discard', '폐기', [{ cubeId: c.id, name: c.name, qty: c.count }]);
    c.count = 0;
    commit();
  },
  delete(el) {
    const c = cubeById(el.dataset.id);
    if (!confirm(`${c.name} (${shortDate(c.madeDate)} 제조) 기록을 완전히 삭제할까요?`)) return;
    state.cubes = state.cubes.filter((x) => x.id !== c.id);
    commit();
  },
  'recipe-preview'() {
    ui.recipePreview = true;
    render();
  },
  async 'ai-recipe'() {
    if (!aiKey(ai)) {
      toast(`설정에서 ${PROVIDERS[ai.provider]} API 키를 입력해주세요.`, 'bad');
      ui.tab = 'settings';
      return render();
    }
    ui.busy = 'recipe';
    render();
    try {
      ui.aiRecipes = await aiRecipes(state, ai, { date: today, reserved: reservedFromPlans(state.plans) });
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      ui.busy = false;
      render();
    }
  },
  cook(el) {
    const r = [...(ui.aiRecipes || []), ...currentRecipes()].find((x) => x.id === el.dataset.id);
    if (!r || !confirm(`${r.title}에 쓸 큐브를 재고에서 차감할까요?\n${r.items.map((i) => `${i.name}×${i.qty}`).join(', ')}`)) return;
    state.cubes = applyConsumption(state.cubes, r.items).cubes;
    addLog('recipe', r.title, r.items);
    if (r.ai) ui.aiRecipes = ui.aiRecipes.filter((x) => x.id !== r.id);
    commit();
    toast('재고에서 차감했어요.');
  },
  export() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `baby-cube-backup-${today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  sample() {
    if (state.cubes.length && !confirm('지금 큐브 목록에 예시 큐브를 추가할까요?')) return;
    const mk = (name, category, ago, count, sizeG = 30) => ({ id: uid(), name, category, madeDate: addDays(today, -ago), sizeG, count, initialCount: count, createdAt: new Date().toISOString() });
    state.cubes.push(
      mk('쌀죽', 'rice', 3, 16, 40), mk('쌀죽', 'rice', 0, 12, 40),
      mk('소고기', 'beef', 2, 7), mk('닭안심', 'chicken', 4, 5), mk('대구살', 'fish', 1, 4),
      mk('애호박', 'veg', 5, 6, 20), mk('당근', 'veg', 3, 6, 20), mk('브로콜리', 'veg', 11, 3, 20),
      mk('단호박', 'veg', 1, 6, 20), mk('사과', 'fruit', 2, 4, 20),
    );
    commit();
    toast('예시 큐브를 추가했어요.');
  },
  'ai-provider'(el) {
    ai.provider = el.dataset.p;
    saveAi(ai);
    render();
  },
  'close-summary'() {
    ui.aiSummary = null;
    render();
  },
  'goto-sync'() {
    ui.tab = 'settings';
    render();
    document.getElementById('sync')?.scrollIntoView({ behavior: 'smooth' });
  },
  'sync-login'() {
    sync.error = null;
    signIn();
  },
  async 'sync-logout'() {
    await signOutSync();
  },
  async 'sync-create'() {
    try {
      await createHousehold(state);
      toast('공유 공간을 만들었어요. 초대 링크를 가족에게 보내세요.');
    } catch (e) {
      toast(`만들지 못했어요: ${e.code || e.message}`, 'bad');
    }
  },
  async 'sync-join'() {
    const code = $('#join-code')?.value.trim();
    if (!code) return toast('초대 코드를 입력해주세요.', 'bad');
    if (state.cubes.length && !confirm('참여하면 이 기기의 기록이 공유 공간 기록으로 바뀌어요. 계속할까요?')) return;
    if (await joinHousehold(code)) {
      ui.joinCode = '';
      toast('공유 공간에 참여했어요!');
    }
  },
  'sync-leave'() {
    if (!confirm('이 기기만 공유를 끊어요. 기록은 이 기기에 그대로 남고, 다른 가족 기기에는 영향이 없어요.')) return;
    leaveHousehold();
  },
  async 'copy-invite'() {
    const link = inviteLink();
    try {
      if (navigator.share) await navigator.share({ title: '이유식 큐브 초대', url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('초대 링크를 복사했어요.');
      }
    } catch {
      prompt('아래 링크를 복사해서 보내세요', link);
    }
  },
  reset() {
    if (!confirm('모든 큐브·식단·기록을 지울까요? (API 키는 유지)')) return;
    state = defaultState();
    ui.aiRecipes = null;
    commit();
  },
};

const changes = {
  swap(el) {
    const meal = state.plans[el.dataset.date].meals[el.dataset.meal];
    const it = meal.items[+el.dataset.idx];
    const c = cubeById(el.value);
    Object.assign(it, { cubeId: c.id, name: c.name });
    commit();
  },
  'show-empty'(el) {
    ui.showEmpty = el.checked;
    render();
  },
  'plan-start'(el) {
    ui.planStart = el.value || today;
  },
  'plan-days'(el) {
    ui.planDays = +el.value;
  },
  setting(el) {
    const v = parseInt(el.value, 10);
    if (Number.isFinite(v)) S()[el.dataset.key] = Math.max(+el.min, Math.min(+el.max, v));
    commit();
  },
  fruit(el) {
    S().fruitAtBreakfast = el.checked;
    commit();
  },
  baby(el) {
    if (el.value) state.baby[el.dataset.key] = el.value;
    commit();
  },
  ai(el) {
    ai[el.dataset.key] = el.value.trim();
    saveAi(ai);
    toast('저장했어요.');
  },
  import(el) {
    const file = el.files[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        if (!Array.isArray(data.cubes)) throw new Error();
        if (!confirm('지금 데이터를 백업 파일 내용으로 바꿀까요?')) return;
        state = normalizeState(data);
        commit();
        toast('가져왔어요.');
      } catch {
        toast('올바른 백업 파일이 아니에요.', 'bad');
      }
    });
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('#nav button');
  if (tab) {
    ui.tab = tab.dataset.tab;
    try { localStorage.setItem('cubeapp.tab', ui.tab); } catch { /* 무시 */ }
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});
document.addEventListener('input', (e) => {
  const form = e.target.closest('#cube-form');
  if (!form) return;
  if (e.target.name === 'category') ui.catTouched = true;
  if (e.target.name === 'name' && !ui.catTouched) form.category.value = guessCategory(e.target.value);
  if (e.target.name === 'madeDate') $('#expiry-preview').innerHTML = expiryText(e.target.value);
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'cube-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const count = parseInt(f.get('count'), 10);
  const cube = {
    id: uid(),
    name: String(f.get('name')).trim(),
    category: f.get('category'),
    madeDate: f.get('madeDate'),
    sizeG: parseInt(f.get('sizeG'), 10),
    count,
    initialCount: count,
    createdAt: new Date().toISOString(),
  };
  if (!cube.name || !(count > 0)) return;
  if (daysLeft(cube, today, S().shelfDays) < 0) return toast('이미 소비기한이 지난 날짜예요.', 'bad');
  state.cubes.push(cube);
  ui.catTouched = false;
  commit();
  toast(`${cube.name} ${count}개 등록! ${shortDate(expiryDate(cube, S().shelfDays))}까지 소진하세요.`);
});

render();
initSync({
  getState: () => state,
  onRemote(remote) {
    state = normalizeState(remote);
    saveState(state);
    safeRender();
  },
  onChange() {
    renderHeader();
    if (ui.tab === 'settings') safeRender();
    if (sync.error && sync.error !== ui.lastSyncError) toast(sync.error, 'bad');
    ui.lastSyncError = sync.error;
  },
});
