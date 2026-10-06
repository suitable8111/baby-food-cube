import { DEFAULT_SETTINGS } from './logic.js';

const KEY = 'cubeapp.v1';
const KEY_AI = 'cubeapp.ai';

export function defaultState() {
  return {
    baby: { name: '우리 아기', birth: '2026-02-25' },
    settings: { ...DEFAULT_SETTINGS },
    cubes: [],
    plans: {},
    log: [],
  };
}

/** 예전 버전·다른 기기에서 온 데이터에 빠진 필드를 기본값으로 채운다 */
export function normalizeState(s) {
  const d = defaultState();
  return { ...d, ...s, baby: { ...d.baby, ...s.baby }, settings: { ...d.settings, ...s.settings } };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다', e);
  }
  return defaultState();
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('저장 실패', e);
  }
}

// API 키는 백업 파일에 섞이지 않도록 별도 키에 저장
const AI_DEFAULTS = { provider: 'claude', apiKey: '', model: 'claude-opus-5-5', geminiKey: '', geminiModel: 'gemini-2.5-flash' };
export function loadAi() {
  try {
    return { ...AI_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY_AI) || '{}') };
  } catch {
    return { ...AI_DEFAULTS };
  }
}
export function saveAi(ai) {
  try {
    localStorage.setItem(KEY_AI, JSON.stringify(ai));
  } catch (e) {
    console.warn('저장 실패', e);
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
