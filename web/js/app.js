import {
  CATEGORIES, MEALS, addDays, ageInfo, nineMonthDate, diffDays, todayStr, shortDate, expiryDate, daysLeft, isUsable,
  guessCategory, reservedFromPlans, buildPlan, eatenInfo, lastDinnerProtein, forecast, matchRecipes,
  applyConsumption, restoreConsumption,
} from './logic.js';
import { loadState, saveState, loadAi, saveAi, defaultState, normalizeState, uid } from './store.js';
import { aiPlan, aiRecipes } from './ai.js';
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

// ---------- 대시보드 ----------
function viewHome() {
  const f = forecast({ cubes: state.cubes, settings: S(), birth: state.baby.birth, today, plans: state.plans });
  const todayPlan = state.plans[today];

  const todayHtml = todayPlan
    ? `<div class="meals">${mealKeys(todayPlan.meals).map((k) => renderMeal(today, k, todayPlan.meals[k])).join('')}</div>`
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
          <h3>${shortDate(d)} <small>${relDay(d)}</small> ${p.source === 'ai' ? '<span class="badge ai">AI</span>' : ''}</h3>
          <button class="ghost sm" data-action="del-plan" data-date="${d}">삭제</button>
        </div>
        <div class="meals">${mealKeys(p.meals).map((k) => renderMeal(d, k, p.meals[k])).join('')}</div>
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
      <p class="muted small">이미 먹은 끼니는 유지되고, 아직 안 먹은 끼니만 새로 짜요.</p>
    </section>
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
      <h2>AI 추천 (Claude)</h2>
      <p class="muted small">AI 추천을 쓰려면 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a>에서 발급한 API 키가 필요해요. 키는 이 기기 브라우저에만 저장되고 백업 파일에는 포함되지 않아요. 키 없이도 ⚡ 자동 추천은 그대로 쓸 수 있어요.</p>
      <div class="form-grid">
        <label class="wide">API 키<input type="password" value="${esc(ai.apiKey)}" placeholder="sk-ant-..." data-change="ai" data-key="apiKey" autocomplete="off"></label>
        <label>모델
          <select data-change="ai" data-key="model">
            ${[['claude-opus-5-5', 'Claude Opus 5.5 (기본)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (저렴)']].map(([v, l]) => `<option value="${v}" ${ai.model === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
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
  const { skipMeals, eatenVeg } = eatenInfo(state.plans, range);
  const out = buildPlan({
    cubes: state.cubes, settings: S(), birth: state.baby.birth, startDate: start, days, reserved, skipMeals, eatenVeg,
    lastDinner: lastDinnerProtein(state.plans, start),
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
    if (!ai.apiKey) {
      toast('설정에서 API 키를 입력해주세요.', 'bad');
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
      toast(res.warnings.length ? `AI 식단 완료 (자동 보정 ${res.warnings.length}건)` : 'AI 식단을 짰어요.');
      if (res.warnings.length) console.info(res.warnings.join('\n'));
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
    if (!ai.apiKey) {
      toast('설정에서 API 키를 입력해주세요.', 'bad');
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
