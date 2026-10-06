// Firebase(구글 로그인 + Firestore) 실시간 동기화.
// 가족이 하나의 "공유 공간(households/{id})" 문서를 함께 쓰고, 문서 ID가 곧 초대 코드다.
// 앱 상태 전체를 JSON 문자열 하나로 저장하고, 마지막에 저장한 쪽이 이긴다(last-write-wins).
import { firebaseConfig } from './firebase-config.js';

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
let firstSnap = true;
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
    auth = fb.getAuth(app);
    db = fb.getFirestore(app);
    fb.getRedirectResult(auth).catch((e) => set({ status: 'error', error: errMsg(e) }));
    fb.onAuthStateChanged(auth, (u) => {
      sync.user = u ? { uid: u.uid, name: u.displayName || u.email, email: u.email } : null;
      if (!u) {
        disconnect();
        set({ status: 'signed-out' });
      } else if (sync.householdId) {
        connect();
      } else {
        set({ status: 'no-household' });
      }
    });
  } catch (e) {
    set({ status: 'error', error: `Firebase를 불러오지 못했어요: ${errMsg(e)}` });
  }
}

function connect() {
  disconnect();
  ref = fb.doc(db, 'households', sync.householdId);
  firstSnap = true;
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
      if (firstSnap && !snap.metadata.fromCache) {
        firstSnap = false;
        // 오프라인에서 바꾼 내용이 아직 안 올라갔으면 내 데이터를 먼저 올린다
        if (ls.get(KEY_DIRTY)) {
          writeNow(handlers.getState());
          return;
        }
      }
      if (!snap.metadata.hasPendingWrites && d.rev && d.rev !== lastRev && !ls.get(KEY_DIRTY)) {
        lastRev = d.rev;
        try {
          handlers.onRemote(JSON.parse(d.data));
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

function writeNow(state) {
  if (!ref || !state) return;
  const rev = `${sync.user.uid}-${Date.now()}`;
  lastRev = rev;
  fb.setDoc(ref, payload(state, rev), { merge: true })
    .then(() => {
      if (lastRev === rev) ls.del(KEY_DIRTY);
    })
    .catch((e) => set({ status: 'error', error: errMsg(e) }));
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
  connect();
  return true;
}

/** 이 기기만 공유 공간에서 빠진다 (데이터는 기기에 그대로 남음) */
export function leaveHousehold() {
  disconnect();
  ls.del(KEY_HOUSEHOLD);
  ls.del(KEY_DIRTY);
  sync.householdId = null;
  set({ status: 'no-household', updatedBy: null });
}

export function inviteLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', sync.householdId);
  return u.toString();
}
