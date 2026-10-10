// 기기 ↔ 클라우드 데이터 병합.
// 통째로 덮어쓰면 한쪽 기록이 사라지므로, 큐브·식단은 항목별로 "나중에 바뀐 쪽"을 남기고
// 삭제는 삭제 표시(tombstone)로 전달한다. 기록(log)은 합집합.

const TOMBSTONE_DAYS = 60;

/** 지난번 저장본과 비교해 바뀐 항목에 updatedAt을, 지운 항목에 삭제 표시를 남긴다 */
export function stampChanges(prev, next, now = Date.now()) {
  next.deleted = { cubes: { ...(next.deleted?.cubes || {}) }, plans: { ...(next.deleted?.plans || {}) } };
  const strip = (o) => JSON.stringify({ ...o, updatedAt: undefined });
  const prevCubes = new Map((prev?.cubes || []).map((c) => [c.id, strip(c)]));
  for (const c of next.cubes) {
    if (prevCubes.get(c.id) !== strip(c)) c.updatedAt = now;
  }
  const ids = new Set(next.cubes.map((c) => c.id));
  for (const id of prevCubes.keys()) if (!ids.has(id)) next.deleted.cubes[id] = now;

  for (const [d, p] of Object.entries(next.plans)) {
    if (!prev?.plans?.[d] || strip(prev.plans[d]) !== strip(p)) p.updatedAt = now;
  }
  for (const d of Object.keys(prev?.plans || {})) if (!next.plans[d]) next.deleted.plans[d] = now;

  const meta = (s) => JSON.stringify({ baby: s?.baby, settings: s?.settings });
  if (!prev || meta(prev) !== meta(next)) next.metaUpdatedAt = now;
  return next;
}

function maxMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v);
  return out;
}

/** 두 상태를 합친다. 같은 항목이면 updatedAt이 큰 쪽, 삭제 표시가 더 최근이면 삭제. */
export function mergeStates(a, b, now = Date.now()) {
  if (!a) return b;
  if (!b) return a;
  const cutoff = now - TOMBSTONE_DAYS * 86400000;
  const prune = (m) => Object.fromEntries(Object.entries(m).filter(([, t]) => t >= cutoff));
  const deleted = {
    cubes: prune(maxMap(a.deleted?.cubes, b.deleted?.cubes)),
    plans: prune(maxMap(a.deleted?.plans, b.deleted?.plans)),
  };

  const cubes = new Map();
  for (const c of [...(a.cubes || []), ...(b.cubes || [])]) {
    const cur = cubes.get(c.id);
    if (!cur || (c.updatedAt || 0) > (cur.updatedAt || 0)) cubes.set(c.id, c);
  }
  const cubeList = [...cubes.values()]
    .filter((c) => !(deleted.cubes[c.id] >= (c.updatedAt || 0)))
    .sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || '') || x.id.localeCompare(y.id));

  const plans = {};
  for (const d of [...new Set([...Object.keys(a.plans || {}), ...Object.keys(b.plans || {})])].sort()) {
    const pa = a.plans?.[d];
    const pb = b.plans?.[d];
    const p = !pa ? pb : !pb ? pa : (pb.updatedAt || 0) > (pa.updatedAt || 0) ? pb : pa;
    if (!(deleted.plans[d] >= (p.updatedAt || 0))) plans[d] = p;
  }

  const logs = new Map();
  for (const l of [...(a.log || []), ...(b.log || [])]) logs.set(l.id, l);
  const log = [...logs.values()].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 200);

  const metaSrc = (b.metaUpdatedAt || 0) > (a.metaUpdatedAt || 0) ? b : a;
  return {
    ...a,
    baby: metaSrc.baby,
    settings: metaSrc.settings,
    metaUpdatedAt: Math.max(a.metaUpdatedAt || 0, b.metaUpdatedAt || 0),
    cubes: cubeList,
    plans,
    log,
    deleted,
  };
}

/** 내용이 같은지 (순서·표기 차이 무시하지 않음 — mergeStates 결과끼리 비교용) */
export function sameState(a, b) {
  const pick = (s) => JSON.stringify([s?.cubes, s?.plans, s?.log, s?.baby, s?.settings, s?.deleted]);
  return pick(a) === pick(b);
}
