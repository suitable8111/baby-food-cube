// Firebase(구글 로그인 + Firestore) 실시간 동기화.
// 가족이 하나의 "공유 공간(households/{id})" 문서를 함께 쓰고, 문서 ID가 곧 초대 코드다.
// 앱 상태 전체를 JSON 문자열 하나로 저장하고, 마지막에 저장한 쪽이 이긴다(last-write-wins).
import { firebaseConfig } from './firebase-config.js';
import { mergeStates, sameState } from './merge.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const KEY_HOUSEHOLD = 'cubeapp.household';
const KEY_DIRTY = 'cubeapp.dirty';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

/**
 * status: off(설정 없음) | loading | signed-out | no-household | syncing | synced | offline | error
 */
export const sync = {
  enabled: !!firebaseConfig,
  status: firebaseConfig ? 'loading' : 'off',
  user: null,
  householdId: ls.get(KEY_HOUSEHOLD),
  updatedBy: null,
  error: null,
};

let fb;
let auth;
let db;
let ref = null;
let unsub = null;
let lastRev = null;
let pushTimer = null;
let handlers = { getState: () => null, onRemote: () => {}, onChange: () => {} };

function set(patch) {
  Object.assign(sync, patch);
  handlers.onChange();
}
function errMsg(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) return '권한이 없어요. 초대 코드를 확인하거나 Firestore 규칙을 확인해주세요.';
  if (code.includes('not-found')) return '공유 공간을 찾을 수 없어요. 초대 코드를 확인해주세요.';
  if (code.includes('unauthorized-domain')) return 'Firebase 인증 허용 도메인에 이 사이트 주소를 추가해야 해요.';
  if (code.includes('popup-closed')) return '로그인 창이 닫혔어요.';
  if (code.includes('unavailable') || code.includes('network')) return '네트워크에 연결할 수 없어요.';
  return e?.message || String(e);
}

export async function initSync(h) {
  handlers = { ...handlers, ...h };
  if (!firebaseConfig) return;
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    fb = { ...appM, ...authM, ...fsM };
    const app = fb.initializeApp(firebaseConfig);
    // 로그인 상태를 브라우저를 닫아도 유지 (IndexedDB → localStorage 순으로 시도)
    auth = fb.initializeAuth(app, {
      persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence],
      popupRedirectResolver: fb.browserPopupRedirectResolver,
    });
    db = fb.getFirestore(app);
    fb.getRedirectResult(auth).catch((e) => set({ status: 'error', error: errMsg(e) }));
    fb.onAuthStateChanged(auth, async (u) => {
      sync.user = u ? { uid: u.uid, name: u.displayName || u.email, email: u.email } : null;
      if (!u) {
        disconnect();
        set({ status: 'signed-out' });
        return;
      }
      const prefsOk = await loadUserPrefs();
      if (sync.householdId) {
        connect();
      } else if (prefsOk && handlers.shouldAutoCreate?.() !== false) {
        // 계정 설정을 읽었는데도 공간이 없을 때만 새로 만든다.
        // (읽기 실패 시 만들면 기기마다 서로 다른 공간이 생긴다)
        // 로그인하면 기록이 항상 클라우드에 저장되도록 내 공간을 자동으로 만든다
        try {
          await createHousehold(handlers.getState());
        } catch (e) {
          set({ status: 'error', error: errMsg(e) });
        }
      } else {
        set({ status: 'no-household' });
      }
    });
  } catch (e) {
    set({ status: 'error', error: `Firebase를 불러오지 못했어요: ${errMsg(e)}` });
  }
}

// ---------- 계정별 설정 (users/{uid}) ----------
// AI API 키와 참여 중인 공유 공간을 계정에 저장해서, 어느 기기에서든 로그인만 하면 다시 불러온다.
// 이 문서는 본인만 읽고 쓸 수 있다(firestore.rules). 가족 공유 문서와는 별개라 키가 가족에게 보이지 않는다.
function userRef() {
  return fb.doc(db, 'users', sync.user.uid);
}

async function loadUserPrefs() {
  let prefs = {};
  try {
    const snap = await fb.getDoc(userRef());
    prefs = snap.exists() ? snap.data() : {};
    sync.prefsError = null;
  } catch (e) {
    sync.prefsError = e?.code?.includes('permission-denied')
      ? '계정에 설정을 저장하려면 Firestore 규칙에 users 규칙을 추가해야 해요.'
      : errMsg(e);
    return false;
  }
  // 공유 공간: 이 기기에 없으면 계정에 저장된 것으로 자동 연결, 이 기기에만 있으면 계정에 저장
  if (!sync.householdId && prefs.householdId) {
    sync.householdId = prefs.householdId;
    ls.set(KEY_HOUSEHOLD, prefs.householdId);
    ls.del(KEY_DIRTY);
    lastRev = null;
  } else if (sync.householdId && prefs.householdId !== sync.householdId) {
    saveUserPrefs({ householdId: sync.householdId });
  }
  // AI 설정: 더 최근에 바꾼 쪽을 따른다
  handlers.onUserPrefs?.(prefs);
  return true;
}

/** 계정 설정 일부 저장 (로그인 안 했으면 무시) */
export function saveUserPrefs(patch) {
  if (!fb || !sync.user) return Promise.resolve();
  return fb.setDoc(userRef(), { ...patch, updatedAt: fb.serverTimestamp() }, { merge: true })
    .then(() => { sync.prefsError = null; })
    .catch((e) => {
      sync.prefsError = e?.code?.includes('permission-denied')
        ? '계정에 설정을 저장하려면 Firestore 규칙에 users 규칙을 추가해야 해요.'
        : errMsg(e);
      handlers.onChange();
    });
}

function connect() {
  disconnect();
  ref = fb.doc(db, 'households', sync.householdId);
  set({ status: 'syncing', error: null });
  unsub = fb.onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.exists()) {
        set({ status: 'error', error: '공유 공간을 찾을 수 없어요.' });
        return;
      }
      const d = snap.data();
      // 클라우드 데이터가 바뀌면 기기 데이터와 "병합"한다(덮어쓰지 않음).
      // 병합 결과에 기기에만 있던 내용이 있으면 다시 올린다.
      if (!snap.metadata.hasPendingWrites && d.rev && d.rev !== lastRev) {
        lastRev = d.rev;
        try {
          const needsPush = handlers.onRemote(JSON.parse(d.data));
          if (needsPush) writeNow(handlers.getState());
          else ls.del(KEY_DIRTY);
        } catch (e) {
          console.warn('원격 데이터 해석 실패', e);
        }
      }
      set({
        updatedBy: d.updatedBy || null,
        status: snap.metadata.hasPendingWrites ? 'syncing' : snap.metadata.fromCache ? 'offline' : 'synced',
      });
    },
    (e) => set({ status: 'error', error: errMsg(e) }),
  );
}

function disconnect() {
  if (unsub) unsub();
  unsub = null;
  ref = null;
  clearTimeout(pushTimer);
}

function payload(state, rev) {
  return {
    data: JSON.stringify(state),
    rev,
    updatedAt: fb.serverTimestamp(),
    updatedBy: sync.user?.name || '',
  };
}

/** 클라우드 최신본을 읽어 병합한 뒤 저장(트랜잭션). 오프라인이면 일단 내 데이터를 대기열에 넣는다. */
async function writeNow(state) {
  if (!ref || !state) return;
  const r = ref;
  const rev = `${sync.user.uid}-${Date.now()}`;
  lastRev = rev;
  try {
    const merged = await fb.runTransaction(db, async (tx) => {
      const snap = await tx.get(r);
      const raw = snap.exists() ? snap.data().data : null;
      const m = raw ? mergeStates(state, JSON.parse(raw)) : state;
      tx.set(r, payload(m, rev), { merge: true });
      return m;
    });
    if (lastRev === rev) ls.del(KEY_DIRTY);
    if (!sameState(merged, state)) handlers.onMerged?.(merged);
  } catch (e) {
    if (e?.code?.includes('permission-denied')) {
      set({ status: 'error', error: errMsg(e) });
      return;
    }
    // 오프라인 등: 대기열에 넣어두고, 다시 연결되면 스냅샷 병합으로 맞춘다
    fb.setDoc(r, payload(state, rev), { merge: true }).catch((err) => set({ status: 'error', error: errMsg(err) }));
  }
}

/** 로컬 변경을 클라우드에 올린다 (0.6초 디바운스). 연결 전이면 dirty 표시만 남긴다. */
export function pushState(state) {
  if (!sync.householdId) return;
  ls.set(KEY_DIRTY, '1');
  if (!ref) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => writeNow(state), 600);
}

export async function signIn() {
  const provider = new fb.GoogleAuthProvider();
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      await fb.signInWithRedirect(auth, provider);
    } else {
      set({ error: errMsg(e) });
    }
  }
}

export async function signOutSync() {
  disconnect();
  await fb.signOut(auth);
}

/** 지금 기기의 데이터로 새 공유 공간을 만든다 */
export async function createHousehold(state) {
  const r = fb.doc(fb.collection(db, 'households'));
  const rev = `${sync.user.uid}-${Date.now()}`;
  await fb.setDoc(r, { ...payload(state, rev), members: [sync.user.uid], createdAt: fb.serverTimestamp() });
  lastRev = rev;
  ls.set(KEY_HOUSEHOLD, r.id);
  ls.del(KEY_DIRTY);
  sync.householdId = r.id;
  saveUserPrefs({ householdId: r.id });
  connect();
}

/** 초대 코드로 참여한다. 이 기기 데이터는 공유 공간 데이터로 바뀐다. */
export async function joinHousehold(code) {
  const id = code.trim();
  try {
    await fb.updateDoc(fb.doc(db, 'households', id), { members: fb.arrayUnion(sync.user.uid) });
  } catch (e) {
    set({ error: errMsg(e) });
    return false;
  }
  ls.set(KEY_HOUSEHOLD, id);
  ls.del(KEY_DIRTY);
  lastRev = null;
  sync.householdId = id;
  saveUserPrefs({ householdId: id });
  connect();
  return true;
}

/** 이 기기만 공유 공간에서 빠진다 (데이터는 기기에 그대로 남음) */
export function leaveHousehold() {
  disconnect();
  ls.del(KEY_HOUSEHOLD);
  ls.del(KEY_DIRTY);
  sync.householdId = null;
  saveUserPrefs({ householdId: null });
  set({ status: 'no-household', updatedBy: null });
}

export function inviteLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', sync.householdId);
  return u.toString();
}
