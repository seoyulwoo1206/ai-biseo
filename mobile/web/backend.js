// 폰(안드로이드 앱 · 아이폰 웹앱)용 비서 두뇌.
// PC 버전 main.js 가 하던 일을 브라우저 안에서 한다.
// 화면(index · settings · ask · login)은 PC 버전 renderer 파일을 그대로 쓰고,
// 각 화면의 window.assistant 는 bridge.js 가 이 두뇌에 연결해 준다.
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import intent from '../../lib/intent.js';
import weather from '../../lib/weather.js';
import growth from '../../lib/growth.js';
import wiki from '../../lib/wiki.js';
import school from '../../lib/school.js';

/* global CHECKMATE_URL, CHECKMATE_KEY */

const PREFIX = 'aibiseo.';
const BASE_STAGE = 210;
const SIZE_MIN = 0.6;
const SIZE_MAX = 1.8;
const DEFAULT_REMIND_MIN = 10;
const REFRESH_MS = 3 * 60 * 1000;
const CHECK_MS = 20 * 1000;

const CHARACTERS_3D = [
  { id: 'cat', name: '하늘냥' },
  { id: 'bunny', name: '분홍토끼' },
  { id: 'bear', name: '곰돌이' },
  { id: 'chick', name: '삐약이' },
  { id: 'mochi', name: '찹쌀떡' },
  { id: 'penguin', name: '펭귄' },
  { id: 'frog', name: '개굴이' },
  { id: 'puppy', name: '멍멍이' },
  { id: 'panda', name: '판다' },
  { id: 'hamster', name: '햄찌' },
];

// ---------- 저장소 (폰 안에만 저장) ----------
function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 저장 공간이 꽉 찼으면 그만 */
  }
}
const loadConfig = () => readJSON('config', {});
const saveConfig = (patch) => writeJSON('config', { ...loadConfig(), ...patch });

// ---------- 체크메이트 ----------
let sb = null;
function client() {
  if (!sb) {
    sb = createClient(CHECKMATE_URL, CHECKMATE_KEY, {
      auth: { storage: localStorage, storageKey: PREFIX + 'checkmate', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return sb;
}
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const checkmate = {
  async currentUser() {
    const { data } = await client().auth.getSession();
    return data.session ? data.session.user : null;
  },
  async signIn(email, password) {
    const { error } = await client().auth.signInWithPassword({ email: String(email || '').trim(), password });
    if (!error) return;
    if (/Invalid login credentials/i.test(error.message)) throw new Error('이메일이나 비밀번호가 맞지 않아요.');
    throw new Error(error.message);
  },
  async signOut() {
    await client().auth.signOut();
  },
  async fetchToday() {
    const user = await this.currentUser();
    if (!user) return null;
    const today = dateKey();
    const [ev, td, gl, dd] = await Promise.all([
      client().from('day_events').select('id,title,start_time,end_time').eq('user_id', user.id).eq('date', today),
      client().from('todos').select('id,title,done,remind_at,goal_id').eq('user_id', user.id).eq('date', today).order('position'),
      client().from('goals').select('id,name,color,sort_order,archived_at').eq('user_id', user.id).order('sort_order').order('created_at'),
      client().from('d_days').select('id,title,date,emoji,pinned').gte('date', today).order('date').limit(6),
    ]);
    if (ev.error && !/day_events/.test(ev.error.message)) throw new Error(ev.error.message);
    if (td.error) throw new Error(td.error.message);
    const events = (ev.data || [])
      .map((e) => ({ id: e.id, title: e.title, start: e.start_time ? e.start_time.slice(0, 5) : null, end: e.end_time ? e.end_time.slice(0, 5) : null }))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const goals = new Map((gl.data || []).map((g) => [g.id, g]));
    const todos = (td.data || [])
      .map((t) => {
        const g = goals.get(t.goal_id);
        return {
          id: t.id,
          title: t.title,
          done: t.done,
          remindAt: t.remind_at ? new Date(t.remind_at) : null,
          goal: g ? g.name : '',
          color: g ? g.color : null,
          order: g ? g.sort_order : 999,
        };
      })
      .sort((a, b) => a.order - b.order);
    const dDays = (dd && !dd.error ? dd.data || [] : [])
      .map((d) => {
        const days = Math.round((new Date(d.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
        return { title: d.title, emoji: d.emoji || '🎯', date: d.date, days, pinned: !!d.pinned };
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.days - b.days)
      .slice(0, 3);
    const activeGoals = (gl.data || []).filter((g) => !g.archived_at).map((g) => ({ id: g.id, name: g.name, color: g.color }));
    return { date: today, events, todos, dDays, goals: activeGoals };
  },
  async mine(id) {
    const user = await this.currentUser();
    if (!user) throw new Error('체크메이트에 로그인해 줘.');
    const { data, error } = await client().from('todos').select('id,user_id,date,remind_at,title').eq('id', id).single();
    if (error || !data || data.user_id !== user.id) throw new Error('그 할 일을 찾을 수 없어.');
    return data;
  },
  async setTodoDone(id, done) {
    await this.mine(id);
    check(await client().from('todos').update({ done: !!done }).eq('id', id));
  },
  async renameTodo(id, title) {
    title = String(title || '').trim().slice(0, 100);
    if (!title) throw new Error('할 일 이름이 비어 있어.');
    await this.mine(id);
    check(await client().from('todos').update({ title }).eq('id', id));
  },
  async moveTodo(id, toDate) {
    const t = await this.mine(id);
    let remind = null;
    if (t.remind_at) {
      const old = new Date(t.remind_at);
      const d = new Date(`${toDate}T${pad(old.getHours())}:${pad(old.getMinutes())}:00`);
      remind = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    check(await client().from('todos').update({ date: toDate, remind_at: remind }).eq('id', id));
  },
  async deleteTodo(id) {
    await this.mine(id);
    check(await client().from('todos').delete().eq('id', id));
  },
  async addTodo(title, { goalId, date } = {}) {
    const user = await this.currentUser();
    if (!user) throw new Error('체크메이트에 로그인해 줘.');
    title = String(title || '').trim().slice(0, 100);
    if (!title) throw new Error('할 일 이름이 비어 있어.');
    const goals = check(
      await client().from('goals').select('id,name,archived_at').eq('user_id', user.id).order('sort_order').order('created_at'),
    ).filter((g) => !g.archived_at);
    if (!goals.length) throw new Error('체크메이트에 목표가 하나도 없어. 체크메이트에서 목표를 먼저 만들어 줘.');
    const goal = goals.find((g) => g.id === goalId) || goals[0];
    const row = check(
      await client().from('todos').insert({ user_id: user.id, goal_id: goal.id, date: date || dateKey(), title }).select('id,title,date').single(),
    );
    return { ...row, goal: goal.name };
  },
};
function check(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------- AI (제미나이 / Claude) — 키는 이 폰 안에만 저장 ----------
function tidy(text) {
  return text
    .replace(/^#{1,6}\s*(.+)$/gm, '## $1') // 소제목은 "## " 로 통일 (물어보기 창이 꾸며 보여 준다)
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const gemini = {
  API: 'https://generativelanguage.googleapis.com/v1beta',
  FALLBACK: 'gemini-2.5-flash',
  key: () => readJSON('key.gemini', ''),
  hasKey() {
    return !!this.key();
  },
  clearKey() {
    writeJSON('key.gemini', undefined);
    writeJSON('gemini.model', undefined);
  },
  currentModel() {
    return readJSON('gemini.model', '') || this.FALLBACK;
  },
  friendlyError(status, body) {
    const msg = (body && body.error && body.error.message) || '';
    const reason = JSON.stringify((body && body.error && body.error.details) || '');
    if (/API_KEY_INVALID|API key not valid/i.test(msg + reason)) return '키가 맞지 않아. 설정에서 키를 다시 넣어 줘.';
    if (status === 429) return '무료 사용량을 잠깐 다 썼어. 조금 있다가 다시 물어봐 줘!';
    if (status === 403) return '이 키로는 제미나이를 쓸 수 없대. (계정 나이 제한이나 지역 제한일 수 있어)';
    if (status >= 500) return '제미나이 서버가 잠깐 아픈가 봐. 조금 있다가 다시 해 줘.';
    return msg ? `제미나이 오류: ${msg.slice(0, 120)}` : `제미나이 오류 (${status})`;
  },
  async call(url, key, init = {}) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? '대답이 너무 늦어서 멈췄어. 다시 물어봐 줘.' : '인터넷 연결을 확인해 줘.');
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* 본문 없음 */
    }
    if (!res.ok) {
      const err = new Error(this.friendlyError(res.status, body));
      err.status = res.status;
      throw err;
    }
    return body;
  },
  pickModel(models) {
    const ok = models.filter(
      (m) =>
        (m.supportedGenerationMethods || []).includes('generateContent') &&
        /gemini-[\d.]+-flash/.test(m.name) &&
        !/(lite|image|tts|audio|live|embedding|exp|preview|thinking|8b)/i.test(m.name),
    );
    const ver = (m) => Number((m.name.match(/gemini-([\d.]+)/) || [])[1] || 0);
    ok.sort((a, b) => ver(b) - ver(a) || a.name.length - b.name.length);
    return ok.length ? ok[0].name.replace(/^models\//, '') : null;
  },
  async verifyAndSave(key) {
    key = String(key || '').trim();
    if (!/^[\w-]{20,}$/.test(key)) throw new Error('키 모양이 이상해. AI Studio 에서 복사한 키를 그대로 붙여 넣어 줘.');
    const list = await this.call(`${this.API}/models?pageSize=1000`, key);
    const model = this.pickModel((list && list.models) || []) || this.FALLBACK;
    writeJSON('key.gemini', key);
    writeJSON('gemini.model', model);
    return { model };
  },
  async ask(question, { history = [], system = '' } = {}) {
    const key = this.key();
    if (!key) throw new Error('NO_KEY');
    const model = this.currentModel();
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [...history.slice(-8).map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts: [{ text: question }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
    };
    const url = `${this.API}/models/${model}:generateContent`;
    let res;
    try {
      res = await this.call(url, key, { method: 'POST', body: JSON.stringify({ ...body, tools: [{ google_search: {} }] }) });
    } catch (e) {
      if (e.status !== 400 && e.status !== 403) throw e;
      res = await this.call(url, key, { method: 'POST', body: JSON.stringify(body) });
    }
    const cand = (res && res.candidates && res.candidates[0]) || {};
    const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
    if (!text) {
      if (cand.finishReason === 'SAFETY') return { text: '그건 내가 대답하기 어려운 질문이야. 다른 걸 물어봐 줄래?', sources: [] };
      return { text: '음… 대답을 못 만들었어. 다시 물어봐 줄래?', sources: [] };
    }
    const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const sources = chunks
      .map((c) => c.web)
      .filter((w) => w && /^https?:\/\//.test(w.uri))
      .slice(0, 3)
      .map((w) => ({ title: (w.title || '출처').slice(0, 30), url: w.uri }));
    return { text: tidy(text), sources };
  },
};

// Claude: 공식 SDK 를 폰 안에서 바로 쓴다 (내 키를 내 폰에서만 쓰는 개인용이라 브라우저 직접 호출을 허용)
const claude = {
  MODELS: [
    { id: 'claude-opus-5-5', name: 'Opus', note: '가장 똑똑함' },
    { id: 'claude-sonnet-5-5', name: 'Sonnet', note: '빠르고 똑똑함' },
    { id: 'claude-haiku-5-5', name: 'Haiku', note: '가장 저렴' },
  ],
  DEFAULT_MODEL: 'claude-opus-5-5',
  key: () => readJSON('key.claude', ''),
  hasKey() {
    return !!this.key();
  },
  clearKey() {
    writeJSON('key.claude', undefined);
  },
  client(key) {
    return new Anthropic({ apiKey: key, timeout: 60 * 1000, maxRetries: 1, dangerouslyAllowBrowser: true });
  },
  friendlyError(e) {
    if (e instanceof Anthropic.AuthenticationError) return '키가 맞지 않아. 설정에서 키를 다시 넣어 줘.';
    if (e instanceof Anthropic.PermissionDeniedError) return '이 키로는 이 모델을 쓸 수 없대. 설정에서 다른 모델을 골라 봐.';
    if (e instanceof Anthropic.RateLimitError) return '잠깐 너무 많이 물어봤나 봐. 조금 있다가 다시 해 줘.';
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit|balance|billing/i.test(e.message)) return 'Claude 크레딧이 부족해. Anthropic 콘솔에서 충전해야 해.';
      return `요청이 거절됐어: ${String(e.message).slice(0, 100)}`;
    }
    if (e instanceof Anthropic.InternalServerError) return 'Claude 서버가 잠깐 아픈가 봐. 조금 있다가 다시 해 줘.';
    if (e instanceof Anthropic.APIConnectionError) return '인터넷 연결을 확인해 줘.';
    if (e instanceof Anthropic.APIError) return `Claude 오류 (${e.status}): ${String(e.message).slice(0, 100)}`;
    return String((e && e.message) || e);
  },
  async verifyAndSave(key) {
    key = String(key || '').trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new Error('키 모양이 이상해. "sk-ant-"로 시작하는 키를 그대로 붙여 넣어 줘.');
    try {
      await this.client(key).models.list({ limit: 1 });
    } catch (e) {
      throw new Error(this.friendlyError(e));
    }
    writeJSON('key.claude', key);
    return { model: this.DEFAULT_MODEL };
  },
  async ask(question, { history = [], system = '', model = this.DEFAULT_MODEL } = {}) {
    const key = this.key();
    if (!key) throw new Error('NO_KEY');
    if (!this.MODELS.some((m) => m.id === model)) model = this.DEFAULT_MODEL;
    const api = this.client(key);
    const messages = [
      ...history.slice(-8).map((h) => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text })),
      { role: 'user', content: question },
    ];
    const isHaiku = model.startsWith('claude-haiku');
    const params = {
      model,
      max_tokens: 16000,
      system,
      output_config: { effort: 'low' },
      tools: [{ type: isHaiku ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    };
    let res;
    try {
      res = await api.beta.messages.create({ ...params, messages });
      for (let i = 0; i < 3 && res.stop_reason === 'pause_turn'; i++) {
        messages.push({ role: 'assistant', content: res.content });
        res = await api.beta.messages.create({ ...params, messages });
      }
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /tool|web_search/i.test(e.message)) {
        const { tools, ...noTools } = params; // eslint-disable-line no-unused-vars
        try {
          res = await api.beta.messages.create({ ...noTools, messages });
        } catch (e2) {
          throw new Error(this.friendlyError(e2));
        }
      } else throw new Error(this.friendlyError(e));
    }
    if (res.stop_reason === 'refusal') return { text: '그건 내가 대답하기 어려운 질문이야. 다른 걸 물어봐 줄래?', sources: [] };
    const texts = [];
    const sources = [];
    for (const block of res.content) {
      if (block.type !== 'text') continue;
      texts.push(block.text);
      for (const c of block.citations || []) {
        if (c.url && /^https?:\/\//.test(c.url) && !sources.some((s) => s.url === c.url)) sources.push({ title: (c.title || '출처').slice(0, 30), url: c.url });
      }
    }
    return { text: tidy(texts.join('')) || '음… 대답을 못 만들었어. 다시 물어봐 줄래?', sources: sources.slice(0, 3) };
  },
};

const PROVIDERS = {
  gemini: { name: '제미나이', keyUrl: 'https://aistudio.google.com/apikey', mod: gemini },
  claude: { name: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys', mod: claude },
};

function systemPrompt(charName) {
  const d = new Date();
  return [
    `너는 사용자 휴대폰 화면에 사는 귀여운 3D 캐릭터 비서 "${charName}"야.`,
    '친한 친구처럼 다정한 반말로, 한국어로 대답해.',
    '대답 모양 (작은 말풍선에서 읽으니까 꼭 지켜):',
    '- 첫 줄은 질문에 대한 답을 한 문장으로 먼저. 그 안의 가장 중요한 말은 **굵게**.',
    '- 간단한 질문이면 거기에 한두 문장만 덧붙이고 끝내.',
    '- 설명이 더 필요하면 빈 줄로 나눈 짧은 문단으로. 한 문단엔 1~2문장만.',
    '- 나열은 "• 이름: 설명"을 한 줄씩, 순서나 풀이 단계는 "1. " "2. "로 한 줄에 한 단계씩.',
    '- 내용이 두 덩어리 이상이면 덩어리마다 "📌 소제목"처럼 이모지 + 10자 안쪽 소제목 줄을 먼저 써.',
    '- **굵게**는 한 대답에 1~3번만. 마크다운 표·# 제목·코드 블록은 쓰지 마.',
    '- 길이는 보통 3~8줄. 설명·풀이가 꼭 필요할 때만 15줄까지.',
    '모르는 건 지어내지 말고 모른다고 말해. 최신 정보가 필요하면 검색해서 대답해.',
    `지금은 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일 ${d.getHours()}시 ${d.getMinutes()}분이야.`,
  ].join('\n');
}

// 사이트로 여는 것 (폰에서도 똑같이)
const SITES = {
  유튜브: 'https://m.youtube.com',
  네이버: 'https://m.naver.com',
  구글: 'https://www.google.com',
  지메일: 'https://mail.google.com',
  메일: 'https://mail.google.com',
  인스타: 'https://www.instagram.com',
  인스타그램: 'https://www.instagram.com',
  넷플릭스: 'https://www.netflix.com',
  웹툰: 'https://m.comic.naver.com',
  네이버웹툰: 'https://m.comic.naver.com',
  나무위키: 'https://namu.wiki',
  파파고: 'https://papago.naver.com',
  번역기: 'https://papago.naver.com',
  지도: 'https://m.map.naver.com',
  네이버지도: 'https://m.map.naver.com',
  날씨: 'https://m.weather.naver.com',
  깃허브: 'https://github.com',
  노션: 'https://www.notion.so',
  클로드: 'https://claude.ai',
  제미나이: 'https://gemini.google.com',
  챗gpt: 'https://chatgpt.com',
  챗지피티: 'https://chatgpt.com',
};
const normName = (s) => String(s || '').toLowerCase().replace(/[\s._\-()]/g, '');

/**
 * 두뇌 만들기.
 * @param {object} host 화면을 가진 쪽(앱 틀 또는 안드로이드 떠 있는 창)이 해 주는 일
 *   - kind: 'pwa' | 'android-app' | 'android-overlay'
 *   - native: 안드로이드 연결 (window.AndroidBridge) 또는 null
 *   - openSheet(name) / closeSheet(name): 설정·물어보기·로그인 화면 열고 닫기
 */
export function createAIBackend(host) {
  const native = host.native || null;
  const listeners = {}; // 이벤트 이름 → Set(fn)
  let today = null;
  let lastError = null;
  const notified = new Set();
  const askHistory = [];
  const healthLast = {};
  let guardPaused = 0; // eslint-disable-line no-unused-vars

  const emit = (name, data) => (listeners[name] || new Set()).forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  });
  const on = (name, fn) => {
    (listeners[name] = listeners[name] || new Set()).add(fn);
    return () => listeners[name].delete(fn);
  };

  // ---------- 여러 화면이 같이 켜져 있을 때 알림이 두 번 울리지 않게: 대표 하나만 시계를 돌린다 ----------
  const myId = Math.random().toString(36).slice(2);
  const LEADER_KEY = PREFIX + 'leader';
  function isLeader() {
    let cur = null;
    try {
      cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null');
    } catch {
      cur = null;
    }
    const now = Date.now();
    // 떠 있는 캐릭터(안드로이드)가 있으면 그쪽이 대표
    const preferMe = host.kind === 'android-overlay';
    if (!cur || cur.id === myId || now - cur.at > 8000 || (preferMe && !cur.overlay)) {
      try {
        localStorage.setItem(LEADER_KEY, JSON.stringify({ id: myId, at: now, overlay: preferMe }));
      } catch {
        /* 무시 */
      }
      return true;
    }
    return false;
  }

  // ---------- 말풍선 ----------
  function say(msg, seconds = 8) {
    const card = typeof msg === 'string' ? { title: msg } : msg;
    emit('say', { card, seconds });
    // 알림 카드는 화면을 안 보고 있을 때 폰 알림으로도
    if (card.tone === 'alert' && (document.hidden || host.kind === 'android-overlay')) {
      notify(card.title || '', card.sub || '');
    }
  }
  function react(name) {
    emit('react', name);
  }
  function notify(title, body) {
    try {
      if (native && native.notify) return native.notify(String(title), String(body || ''));
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        navigator.serviceWorker && navigator.serviceWorker.ready
          ? navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, icon: 'icon-192.png', tag: 'aibiseo' }))
          : new Notification(title, { body });
      }
    } catch {
      /* 알림을 못 띄우면 말풍선만 */
    }
  }

  // ---------- 캐릭터 ----------
  const images = () => readJSON('images', {});
  function currentCharacter() {
    const saved = loadConfig().character;
    if (saved && saved.startsWith('3d:') && CHARACTERS_3D.some((c) => '3d:' + c.id === saved)) return saved;
    if (saved && images()[saved]) return saved;
    return '3d:cat';
  }
  function characterMsg() {
    const name = currentCharacter();
    if (name.startsWith('3d:')) return { kind: '3d', type: name.slice(3), accessory: growth.view(loadConfig().growth).accessory };
    return { kind: 'image', url: images()[name] };
  }
  function sendCharacter() {
    emit('character', characterMsg());
  }
  function chooseCharacter(name) {
    saveConfig(name.startsWith('3d:') ? { character: name, last3d: name } : { character: name });
    sendCharacter();
    pushSettings();
  }
  function charName() {
    const c = CHARACTERS_3D.find((x) => '3d:' + x.id === currentCharacter());
    return c ? c.name : '비서';
  }
  function importImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      // 폰 저장 공간을 아끼려고 작게 줄여서 저장
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 512 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/png');
        const name = (f.name || '내 캐릭터').replace(/\.[^.]+$/, '').slice(0, 30) + '.png';
        writeJSON('images', { ...images(), [name]: url });
        URL.revokeObjectURL(img.src);
        chooseCharacter(name);
        say({ title: '새 모습 어때?', tone: 'happy', icon: '✨' }, 4);
      };
      img.src = URL.createObjectURL(f);
    };
    input.click();
  }

  // ---------- 크기 ----------
  function sizeScale() {
    const v = Number(loadConfig().size);
    // 폰 화면은 손가락으로 누르니 기본을 조금 크게
    return v >= SIZE_MIN && v <= SIZE_MAX ? v : 1.25;
  }
  // 다른 앱 위에 떠 있는 캐릭터는 앱 화면의 절반 남짓 크기로 (다른 앱을 덜 가리게)
  const stagePx = () => Math.round(BASE_STAGE * sizeScale() * (host.kind === 'android-overlay' ? 0.55 : 1));
  function setSize(scale) {
    scale = Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, scale)) * 100) / 100;
    if (scale === sizeScale()) return;
    saveConfig({ size: scale });
    emit('size', { stage: stagePx() });
    if (native && native.setStage) native.setStage(stagePx());
    pushSettings();
  }

  // ---------- 체크메이트 일정 ----------
  const minutesOf = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const nowMinutes = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const remindBefore = () => {
    const v = loadConfig().remindBefore;
    return Number.isInteger(v) ? v : DEFAULT_REMIND_MIN;
  };
  const loginHint = () => ({ title: '체크메이트에 로그인해 줘!', sub: '나를 눌러서 설정 → 로그인', tone: 'info', icon: '🔑' });

  // ---------- 캐릭터 키우기 (PC 버전과 같은 규칙: lib/growth.js) ----------
  function grow(list) {
    let state = loadConfig().growth;
    let gained = 0;
    let before = null;
    let after = null;
    const newItems = [];
    for (const [kind, key] of list) {
      const r = growth.award(state, kind, key);
      state = r.state;
      if (!r.gained) continue;
      gained += r.gained;
      before = before || r.before;
      after = r.after;
      newItems.push(...r.newItems);
    }
    if (!gained) return 0;
    saveConfig({ growth: state });
    emit('xp', { gained, level: after.level });
    if (after.level > before.level) {
      const item = newItems[newItems.length - 1];
      say(
        {
          title: `레벨 업! Lv.${after.level} 🎉`,
          sub: item ? `${item.emoji} ${item.name}을(를) 얻어서 달아 봤어! 설정 → 꾸미기에서 바꿀 수 있어` : '계속 이렇게만 하자!',
          tone: 'happy',
          icon: item ? item.emoji : '⭐',
          react: 'dance',
        },
        10,
      );
      if (item) sendCharacter();
    }
    pushSettings();
    return gained;
  }
  function rewardDoneTodos() {
    if (today) grow(today.todos.filter((t) => t.done).map((t) => ['todo', t.id]));
  }

  async function refresh({ announce = false } = {}) {
    try {
      today = await checkmate.fetchToday();
      lastError = null;
      rewardDoneTodos();
      if (!today && announce) say(loginHint(), 10);
    } catch (e) {
      lastError = e.message;
      if (announce) say({ title: '일정을 못 불러왔어', sub: e.message, tone: 'sad', icon: '😢' }, 8);
    }
  }

  function notifyOnce(key, card) {
    if (notified.has(key)) return;
    notified.add(key);
    say({ tone: 'alert', ...card }, 20);
  }

  function checkReminders() {
    grow([['daily', dateKey()]]); // 하루 첫 출석
    if (!today || today.date !== dateKey()) {
      if (today) refresh();
      return;
    }
    const now = nowMinutes();
    for (const e of today.events) {
      if (!e.start) continue;
      const left = minutesOf(e.start) - now;
      const key = `${today.date}|ev|${e.id}|${e.start}`;
      const when = e.end ? `${e.start} ~ ${e.end}` : `${e.start} 시작`;
      if (left === 0) notifyOnce(key + '|now', { title: `지금 ${e.title} 시간이야!`, sub: when, icon: '⏰' });
      else if (left > 0 && left <= remindBefore()) notifyOnce(key + '|soon', { title: `${left}분 뒤에 ${e.title}!`, sub: when, icon: '📅', countdown: left });
    }
    const nowMs = Date.now();
    for (const t of today.todos) {
      if (t.done || !t.remindAt) continue;
      const diff = nowMs - t.remindAt.getTime();
      if (diff >= 0 && diff < 5 * 60 * 1000) {
        notifyOnce(`${today.date}|todo|${t.id}|${t.remindAt.getTime()}`, {
          title: `${t.title} 할 시간이야!`,
          sub: `${t.goal ? t.goal + ' · ' : ''}${hhmm(t.remindAt)}`,
          icon: '✅',
          color: t.color,
        });
      }
    }
  }

  function summary(extra = {}) {
    if (!today) {
      if (lastError) return { title: '일정을 못 불러왔어', sub: lastError, tone: 'sad', icon: '😢' };
      return loginHint();
    }
    const now = nowMinutes();
    let nextFound = false;
    const events = today.events.map((e) => {
      let state = 'later';
      let inMin = null;
      if (!e.start) state = 'allday';
      else {
        const s0 = minutesOf(e.start);
        const s1 = e.end ? minutesOf(e.end) : s0 + 1;
        if (now >= s1) state = 'past';
        else if (now >= s0) state = 'now';
        else if (!nextFound) {
          state = 'next';
          nextFound = true;
          inMin = s0 - now;
        }
      }
      return { time: e.start || '종일', end: e.end, title: e.title, state, inMin };
    });
    const todos = today.todos.map((t) => ({ id: t.id, title: t.title, time: t.remindAt ? hhmm(t.remindAt) : '', done: t.done, color: t.color, goal: t.goal }));
    const done = todos.filter((t) => t.done).length;
    const total = todos.length;
    const ratio = total ? done / total : 1;
    const left = total - done;
    let cheer;
    if (!total && !events.some((e) => e.state !== 'past')) cheer = '오늘은 여유로운 날~ 푹 쉬어 ☁️';
    else if (ratio === 1) cheer = '오늘 할 일 다 끝냈어! 최고야 🎉';
    else if (ratio >= 0.7) cheer = `${left}개만 더 하면 끝! 거의 다 왔어 💪`;
    else if (ratio >= 0.4) cheer = '벌써 절반 가까이 했네! 이 기세로 ✨';
    else if (done > 0) cheer = '좋아, 시작이 반이야! 🌱';
    else cheer = '오늘도 하나씩 해 보자! 🔥';
    const d = new Date();
    return {
      kind: 'today',
      title: '오늘의 할 일',
      sub: `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`,
      tone: ratio === 1 && total ? 'happy' : 'info',
      progress: { done, total },
      events,
      todos,
      goals: today.goals || [],
      cheer,
      ...extra,
    };
  }

  function splitGoal(title) {
    const goals = (today && today.goals) || [];
    const m = String(title).match(/^(.+?)\s*(?:목표)?\s*(?:에|으로|로)\s+(.+)$/);
    if (m) {
      const key = m[1].replace(/\s+/g, '');
      const g = goals.find((x) => x.name.replace(/\s+/g, '') === key);
      if (g) return { goalId: g.id, title: m[2] };
    }
    return { goalId: null, title };
  }
  async function addTodoAndRefresh(title, goalId, dayOffset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    const row = await checkmate.addTodo(title, { goalId, date: dateKey(d) });
    await refresh();
    return row;
  }

  async function todoAction({ id, op, title }) {
    try {
      if (typeof id !== 'string') throw new Error('잘못된 요청이야.');
      let msg = '';
      if (op === 'done') {
        await checkmate.setTodoDone(id, true);
        msg = '완료! 잘했어 👏';
      } else if (op === 'undone') {
        await checkmate.setTodoDone(id, false);
        msg = '완료를 취소했어';
      } else if (op === 'rename') {
        await checkmate.renameTodo(id, title);
        msg = '이름 바꿨어 ✏️';
      } else if (op === 'tomorrow') {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        await checkmate.moveTodo(id, dateKey(d));
        msg = '내일로 미뤘어 ➡️';
      } else if (op === 'delete') {
        await checkmate.deleteTodo(id);
        msg = '지웠어 🗑️';
      } else throw new Error('모르는 동작이야.');
      await refresh();
      const card = summary();
      const allDone = card.kind === 'today' && card.todos.length > 0 && card.todos.every((t) => t.done);
      if (op === 'done') react(allDone ? 'dance' : 'happy');
      return { ok: true, message: allDone ? '오늘 할 일 전부 끝! 최고야 🎉' : msg, card };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async function todoAdd({ title, goalId }) {
    try {
      const row = await addTodoAndRefresh(title, goalId, 0);
      react('happy');
      return { ok: true, message: '추가했어! ✍️', card: summary(), added: row.title };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  // ---------- 타이머 · 알람 ----------
  // 타이머도 저장해 둬서, 앱 화면과 떠 있는 캐릭터가 같은 타이머를 본다
  const getTimer = () => readJSON('timer', null);
  const setTimer = (t) => writeJSON('timer', t || undefined);
  function timerState() {
    const timer = getTimer();
    if (!timer) return null;
    return { mode: timer.mode, total: timer.total, left: Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000)) };
  }
  const sendTimer = () => emit('timer', timerState());

  // 집중 시간: 설정에서 고르는 칸 (말로는 5~180분 아무거나)
  const FOCUS_OPTIONS = [15, 25, 30, 45, 60, 90];
  function focusMinutes() {
    const m = Math.round(Number(loadConfig().focusMinutes));
    return m >= 5 && m <= 180 ? m : 25;
  }
  function setFocusMinutes(m) {
    m = Math.round(Number(m));
    if (!(m >= 5 && m <= 180)) return false;
    saveConfig({ focusMinutes: m });
    return true;
  }
  const breakMinutesFor = (sec) => (sec >= 80 * 60 ? 15 : sec >= 45 * 60 ? 10 : 5);

  function startTimer(mode, seconds) {
    setTimer({ mode, total: seconds, endsAt: Date.now() + seconds * 1000 });
    sendTimer();
    pushSettings();
    const dur = intent.formatDuration(seconds);
    if (mode === 'focus') say({ title: `${dur} 집중 시작!`, sub: '옆에서 조용히 응원할게', tone: 'happy', icon: '🔥', react: 'cheer' }, 5);
    else if (mode === 'timer') say({ title: `${dur} 타이머 시작!`, sub: '끝나면 알려줄게', tone: 'info', icon: '⏱️' }, 4);
    if (native && native.scheduleAlarm) native.scheduleAlarm('timer', Date.now() + seconds * 1000, mode === 'focus' ? '집중 끝! 🍅' : `${dur} 지났어! ⏰`);
  }
  function stopTimer(announce) {
    const had = !!getTimer();
    setTimer(null);
    if (native && native.cancelAlarm) native.cancelAlarm('timer');
    sendTimer();
    pushSettings();
    if (announce && had) say({ title: '타이머를 멈췄어', tone: 'info', icon: '⏹️' }, 4);
    return had;
  }

  const loadAlarms = () => {
    const list = loadConfig().alarms;
    return Array.isArray(list) ? list : [];
  };
  const saveAlarms = (list) => saveConfig({ alarms: list.sort((a, b) => a.at - b.at) });
  function addAlarm(at, what, kind) {
    const list = loadAlarms();
    const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, what: what || '', kind };
    list.push(item);
    saveAlarms(list);
    // 안드로이드: 앱이 꺼져 있어도 울리도록 폰 알람에도 맡겨 둔다
    if (native && native.scheduleAlarm) native.scheduleAlarm(item.id, at, kind === 'alarm' ? (what ? `${what}!` : '알람 시간이야! ⏰') : what && what !== '말한 시간' ? `${what}!` : '말한 시간 됐어! 🔔');
    return item;
  }
  function clearAlarms() {
    const list = loadAlarms();
    if (native && native.cancelAlarm) list.forEach((a) => native.cancelAlarm(a.id));
    saveAlarms([]);
    return list.length;
  }
  function whenText(ms) {
    const d = new Date(ms);
    const now = new Date();
    const dayDiff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
    const day = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : dayDiff === 2 ? '모레' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
    const h = d.getHours();
    return `${day} ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ''}`;
  }
  function ringAlarm(a) {
    const title = a.kind === 'alarm' ? (a.what ? `${a.what}!` : '알람 시간이야!') : a.what && a.what !== '말한 시간' ? `${a.what}!` : '말한 시간 됐어!';
    say(
      {
        title,
        sub: a.kind === 'alarm' ? whenText(a.at).replace(/^오늘 /, '') + ' 알람' : '아까 알려 달라고 했던 거야',
        tone: 'alert',
        icon: a.kind === 'alarm' ? '⏰' : '🔔',
        ring: a.kind === 'alarm' ? 'loud' : 'soft',
        actions: [
          { id: `snooze:${a.what || ''}`, label: '😴 5분 뒤' },
          { id: 'dismiss', label: '끄기' },
        ],
      },
      60,
    );
  }
  function checkMissedAlarms() {
    const now = Date.now();
    const list = loadAlarms();
    const keep = [];
    for (const a of list) {
      if (a.at > now) keep.push(a);
      else if (now - a.at < 10 * 60 * 1000) setTimeout(() => ringAlarm(a), 4000);
    }
    if (keep.length !== list.length) saveAlarms(keep);
  }

  function tickTimer() {
    const now = Date.now();
    const timer = getTimer();
    if (timer && now >= timer.endsAt) {
      setTimer(null);
      if (timer.mode === 'focus') {
        setTimeout(() => grow([['focus', String(timer.endsAt)]]), 1500);
        const breakMin = breakMinutesFor(timer.total);
        say({ title: '집중 끝! 수고했어 🎉', sub: `${breakMin}분 쉬자. 물도 한 잔 마시고!`, tone: 'happy', icon: '🍅', react: 'dance' }, 15);
        setTimer({ mode: 'break', total: breakMin * 60, endsAt: now + breakMin * 60 * 1000 });
      } else if (timer.mode === 'break') {
        say({ title: '쉬는 시간 끝!', sub: `다시 집중해 볼까? "집중 시작"이라고 하면 ${focusMinutes()}분`, tone: 'alert', icon: '🔥' }, 15);
      } else {
        say({ title: `${intent.formatDuration(timer.total)} 지났어!`, sub: '타이머 끝 ⏰', tone: 'alert', icon: '⏰' }, 20);
      }
      pushSettings();
    }
    sendTimer();
    const list = loadAlarms();
    const due = list.filter((a) => now >= a.at);
    if (due.length) {
      saveAlarms(list.filter((a) => now < a.at));
      due.forEach((a, i) => setTimeout(() => ringAlarm(a), i * 1500));
    }
  }

  // ---------- 건강 알림 (폰에서는 기본으로 꺼 둠) ----------
  const HEALTH = {
    water: { every: 60, card: { title: '물 한 잔 마실 시간!', sub: '한 시간 동안 수고했어', icon: '💧', react: 'hop' } },
    stretch: { every: 50, card: { title: '기지개 쭉~ 펴자!', sub: '목이랑 어깨도 살살 돌려 줘', icon: '🙆', react: 'stretch' } },
    eyes: { every: 20, card: { title: '눈 쉬는 시간', sub: '20초 동안 멀리 있는 걸 바라봐', icon: '👀', react: 'lookAround' } },
  };
  function healthConfig() {
    const h = loadConfig().health || {};
    return { water: h.water ?? false, stretch: h.stretch ?? false, eyes: h.eyes ?? false };
  }
  function tickHealth() {
    const now = Date.now();
    const cfg = healthConfig();
    const timer = getTimer();
    for (const [key, h] of Object.entries(HEALTH)) {
      if (!healthLast[key] || document.hidden) healthLast[key] = now;
      if (!cfg[key] || (timer && timer.mode === 'focus')) continue;
      if (now - healthLast[key] >= h.every * 60 * 1000) {
        healthLast[key] = now;
        say({ tone: 'info', ...h.card }, 15);
      }
    }
  }

  // ---------- 날씨 · 브리핑 ----------
  function placeConfig() {
    const p = loadConfig().place;
    return p && typeof p.lat === 'number' ? p : weather.DEFAULT_PLACE;
  }
  const ENGINE_NAME = { naver: '네이버', google: '구글', youtube: '유튜브' };
  const SEARCH_BUTTONS = (q) => [
    { label: '네이버', action: 'search', engine: 'naver', query: q },
    { label: '구글', action: 'search', engine: 'google', query: q },
    { label: '유튜브', action: 'search', engine: 'youtube', query: q },
  ];
  async function weatherAnswer(when) {
    try {
      const w = await weather.get(placeConfig());
      if (when === 'tomorrow') {
        const d = w.tomorrow;
        return { text: `내일 ${w.place}은 ${d.emoji} ${d.desc}, ${d.min}° ~ ${d.max}°야.`, sub: d.rain >= 50 ? `비 올 확률 ${d.rain}%, 우산 챙겨 ☂️` : `비 올 확률 ${d.rain}%` };
      }
      return {
        text: `지금 ${w.place}은 ${w.now.emoji} ${w.now.desc}, ${w.now.temp}°야. (체감 ${w.now.feels}°)`,
        sub: [`오늘 ${w.today.min}° ~ ${w.today.max}° · 비 ${w.today.rain}%`, w.dust ? `미세먼지 ${w.dust.label} ${w.dust.emoji}` : '', weather.advice(w)].filter(Boolean).join('\n'),
      };
    } catch (e) {
      return { text: '날씨를 못 불러왔어 😢', sub: e.message, buttons: SEARCH_BUTTONS(`${placeConfig().name} 날씨`) };
    }
  }
  function greeting(h = new Date().getHours()) {
    if (h < 5) return '아직 새벽이야… 🌙';
    if (h < 11) return '좋은 아침! ☀️';
    if (h < 14) return '점심은 먹었어? 🍚';
    if (h < 18) return '오후도 힘내자! 🌤️';
    if (h < 22) return '오늘 하루 어땠어? 🌆';
    return '늦었어, 슬슬 쉬자 🌙';
  }
  async function briefCard() {
    const d = new Date();
    const card = { kind: 'brief', tap: true, title: greeting(d.getHours()), sub: `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`, tone: 'happy', icon: '☀️' };
    try {
      const w = await weather.get(placeConfig());
      card.weather = { ...w, advice: weather.advice(w) };
    } catch {
      card.weather = null;
    }
    if (!today) await refresh().catch(() => {});
    if (today) {
      const s0 = summary();
      card.events = s0.events.filter((e) => e.state !== 'past');
      card.todosLeft = s0.todos.filter((t) => !t.done).length;
      card.todosTotal = s0.todos.length;
      card.dDays = today.dDays || [];
    } else card.login = true;
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    if (schoolCfg().mealBrief !== false) card.school = await schoolBrief().catch(() => null);
    card.alarms = loadAlarms()
      .filter((a) => a.at <= end.getTime())
      .map((a) => ({ when: whenText(a.at).replace(/^오늘 /, ''), what: a.what && a.what !== '말한 시간' ? a.what : '' }));
    return card;
  }
  async function showBrief() {
    say(await briefCard(), 30);
  }

  // ---------- 학교: 급식·시간표 (PC 버전 main.js 와 같은 규칙, 나이스는 우리 서버 /api/neis 를 거친다) ----------
  const DAY_LABEL = { '-1': '어제', 0: '오늘', 1: '내일', 2: '모레' };
  const MEAL_KO = { breakfast: '아침', lunch: '점심', dinner: '저녁' };
  function schoolCfg() {
    const c = loadConfig().school;
    return c && typeof c === 'object' ? c : {};
  }
  function schoolState() {
    const c = schoolCfg();
    return {
      school: c.school || null,
      grade: c.grade || null,
      cls: c.cls || null,
      start: c.start || '08:40',
      classMin: c.classMin || 50,
      mealBrief: c.mealBrief !== false,
      classAlert: !!c.classAlert,
      hasKey: false,
      serverKey: school.fullTimetable(),
      mine: Array.isArray(c.mine) ? c.mine : [],
    };
  }
  function dayAfter(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  }
  async function dayTimetable(offset = 0) {
    const c = schoolCfg();
    if (!c.school || !c.grade || !c.cls) return null;
    return school.timetable(c.school, c.grade, c.cls, dayAfter(offset), null, Array.isArray(c.mine) ? c.mine : null);
  }
  function bellOf() {
    const c = schoolCfg();
    return school.bellTimes({ start: c.start || '08:40', classMin: c.classMin || 50 }, 9);
  }
  async function mealAnswer({ meal = 'all', dayOffset = 0 }) {
    const c = schoolCfg();
    if (!c.school) return { text: '학교를 먼저 알려 줘! 🏫', sub: '설정 → 학교에서 학교 이름으로 찾아서 골라 줘' };
    const day = DAY_LABEL[dayOffset] || '';
    let m;
    try {
      m = await school.meals(c.school, dayAfter(dayOffset), null);
    } catch (e) {
      return { text: '급식을 못 불러왔어 😢', sub: e.message };
    }
    const has = Object.keys(m);
    if (!has.length) return { text: `${day}은 급식 정보가 없어`, sub: '주말·방학·재량휴업일일 수도 있어' };
    const line = (k) => `${m[k].dishes.join(', ')}${m[k].kcal ? ` (${Math.round(m[k].kcal)}kcal)` : ''}`;
    if (meal !== 'all') {
      if (!m[meal]) return { text: `${day} ${MEAL_KO[meal]}은 급식이 없어`, sub: `있는 급식: ${has.map((k) => MEAL_KO[k]).join(', ')}` };
      return { text: `${day} ${MEAL_KO[meal]} 🍚 ${line(meal)}`, sub: c.school.name };
    }
    const order = ['breakfast', 'lunch', 'dinner'].filter((k) => m[k]);
    return { text: `${day} 급식 🍚\n` + order.map((k) => `${MEAL_KO[k]}: ${line(k)}`).join('\n'), sub: c.school.name };
  }
  async function timetableAnswer({ dayOffset = 0, period = null, next = false }) {
    const c = schoolCfg();
    if (!c.school) return { text: '학교를 먼저 알려 줘! 🏫', sub: '설정 → 학교에서 찾고 학년·반도 골라 줘' };
    if (!c.grade || !c.cls) return { text: '몇 학년 몇 반인지 알려 줘!', sub: '설정 → 학교에서 학년·반을 골라 줘' };
    const day = DAY_LABEL[dayOffset] || '';
    let rows;
    try {
      rows = await dayTimetable(dayOffset);
    } catch (e) {
      return { text: '시간표를 못 불러왔어 😢', sub: e.message };
    }
    if (!rows.length) return { text: `${day}은 시간표가 없어`, sub: '주말·방학·시험 기간이거나 학교가 나이스에 안 올렸을 수 있어' };
    const bell = bellOf();
    const at = (p) => {
      const b = bell.find((x) => x.period === p);
      return b ? school.hm(b.start) : '';
    };
    const last = Math.max(...rows.map((r) => r.period));
    const mixNote = rows.elective ? '\n(선택 과목은 그 시간에 열리는 수업을 모아서 보여 줘)' : '';
    const cut = !school.fullTimetable() && !rows.rooms && rows.length >= 5 ? '\n(6·7교시는 지금 못 받아 와서 5교시까지만 보여)' : '';
    if (period) {
      const r = rows.find((x) => x.period === period);
      if (r && r.free) return { text: `${day} ${period}교시는 공강이야 ☕`, sub: at(period) ? `${at(period)}부터 쉬는 시간` : '' };
      if (r) return { text: `${day} ${period}교시는 ${r.subject}야 📚`, sub: at(period) ? `${at(period)} 시작` : '' };
      return { text: `${day} ${period}교시는 없어`, sub: cut.trim() };
    }
    if (next && dayOffset === 0) {
      const now = nowMinutes();
      const has = (p) => rows.some((r) => r.period === p && !r.free);
      const subj = (p) => rows.find((r) => r.period === p).subject;
      const cur = bell.find((b) => b.start <= now && now < b.end && has(b.period));
      const nxt = bell.find((b) => b.start > now && has(b.period));
      if (cur && nxt) return { text: `지금은 ${cur.period}교시 ${subj(cur.period)}, 다음은 ${nxt.period}교시 ${subj(nxt.period)}야 📚`, sub: `${school.hm(nxt.start)} 시작` };
      if (nxt) return { text: `다음 수업은 ${nxt.period}교시 ${subj(nxt.period)}야 📚`, sub: `${school.hm(nxt.start)} 시작 · ${nxt.start - now}분 남았어` };
      if (cur) return { text: `지금 ${cur.period}교시 ${subj(cur.period)}가 마지막이야!`, sub: `${school.hm(cur.end)}에 끝나` };
      return { text: '오늘 수업은 다 끝났어! 🎉', sub: `오늘 ${last}교시까지 있었어` };
    }
    return {
      text: `${day} 시간표 📚 (${last}교시까지)\n` + rows.map((r) => `${r.period}교시 ${r.subject}`).join('\n') + cut + mixNote,
      sub: `${c.school.name} ${c.grade}학년 ${c.cls}반${rows.rooms ? ' (분반 기준)' : ''}`,
    };
  }
  async function schoolBrief() {
    const c = schoolCfg();
    if (!c.school) return null;
    const [m, rows] = await Promise.all([school.meals(c.school, new Date(), null).catch(() => ({})), dayTimetable(0).catch(() => null)]);
    const meal = m.lunch || m.dinner || m.breakfast;
    const which = m.lunch ? '점심' : m.dinner ? '저녁' : '아침';
    if (!meal && !(rows && rows.length)) return null;
    return {
      meal: meal ? { which, dishes: meal.dishes.slice(0, 5) } : null,
      classes: rows && rows.length ? rows.map((r) => r.subject) : null,
      last: rows && rows.length ? Math.max(...rows.map((r) => r.period)) : 0,
      free: rows ? rows.filter((r) => r.free).length : 0,
      classesShort: rows && rows.length ? rows.map((r) => r.subject).filter((x, i, arr) => x !== arr[i - 1]) : null,
    };
  }
  // 수업 5분 전 알림 + 점심시간 메뉴 (평일, 켜 둔 경우만)
  async function tickSchool() {
    const c = schoolCfg();
    if (!c.classAlert || !c.school || !c.grade || !c.cls) return;
    const d = new Date();
    if (d.getDay() === 0 || d.getDay() === 6) return;
    const t = getTimer();
    if (t && t.mode === 'focus') return;
    let rows;
    try {
      rows = await dayTimetable(0);
    } catch {
      return;
    }
    if (!rows || !rows.length) return;
    const now = nowMinutes();
    const date = dateKey(d);
    const bell = bellOf();
    for (const b of bell) {
      const r = rows.find((x) => x.period === b.period);
      if (!r || r.free) continue;
      if (b.start - now === 5) notifyOnce(`${date}|class|${b.period}`, { title: `5분 뒤 ${b.period}교시 ${r.subject}!`, sub: `${school.hm(b.start)} 시작 · 준비물 챙겨`, icon: '📚', countdown: 5 });
    }
    const fourth = bell.find((b) => b.period === 4);
    if (fourth && now === fourth.end && rows.some((x) => x.period > 4)) {
      const m = await school.meals(c.school, d, null).catch(() => ({}));
      if (m.lunch) notifyOnce(`${date}|lunch`, { title: '점심시간! 🍚', sub: m.lunch.dishes.slice(0, 5).join(', '), icon: '🍚', tone: 'happy' });
    }
  }
  function schoolSet(patch) {
    if (!patch || typeof patch !== 'object') return;
    const c = { ...schoolCfg() };
    if (patch.school !== undefined) {
      const s = patch.school;
      c.school =
        s && s.code && s.office
          ? { name: String(s.name).slice(0, 40), office: String(s.office).slice(0, 5), code: String(s.code).slice(0, 10), kind: String(s.kind || '').slice(0, 10) }
          : null;
    }
    if (patch.grade !== undefined) c.grade = Math.min(6, Math.max(1, parseInt(patch.grade, 10) || 1));
    if (patch.cls !== undefined) c.cls = Math.min(30, Math.max(1, parseInt(patch.cls, 10) || 1));
    if (patch.start !== undefined && /^\d{1,2}:\d{2}$/.test(patch.start)) c.start = patch.start;
    if (patch.classMin !== undefined && [40, 45, 50].includes(Number(patch.classMin))) c.classMin = Number(patch.classMin);
    if (patch.mealBrief !== undefined) c.mealBrief = !!patch.mealBrief;
    if (patch.classAlert !== undefined) c.classAlert = !!patch.classAlert;
    if (patch.mine !== undefined) {
      c.mine = Array.isArray(patch.mine) ? [...new Set(patch.mine.map(String).filter((x) => /^[^|]{1,40}\|\d{1,2}$/.test(x)))].slice(0, 40) : [];
      school._cache.clear();
    }
    if (c.grade !== schoolCfg().grade) c.mine = [];
    saveConfig({ school: c });
    pushSettings();
  }

  // ---------- 브리핑에서 줄을 누르면 자세히 (PC 버전과 같은 카드) ----------
  const BACK = { id: 'brief:back', label: '← 브리핑' };
  async function weatherDetail() {
    const w = await weather.get(placeConfig());
    const hm = (h) => (h === 0 ? '밤 12시' : h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`);
    const rows = (w.hours || []).map((h, i) => ({ left: i === 0 ? '지금' : hm(h.hour), text: `${h.emoji} ${h.temp}°`, right: h.rain ? `☂️ ${h.rain}%` : '', warn: h.rain >= 50, now: i === 0 }));
    const more = [];
    if (w.dust) more.push({ left: '미세먼지', text: `${w.dust.emoji} ${w.dust.label}`, right: `PM10 ${w.dust.pm10} · PM2.5 ${w.dust.pm25}`, warn: /나쁨/.test(w.dust.label) });
    more.push({ left: '내일', text: `${w.tomorrow.emoji} ${w.tomorrow.min}° ~ ${w.tomorrow.max}°`, right: `☂️ ${w.tomorrow.rain}%`, warn: w.tomorrow.rain >= 50 });
    return {
      kind: 'detail',
      icon: w.now.emoji,
      title: `${w.place} 날씨`,
      sub: `지금 ${w.now.temp}° ${w.now.desc} · 체감 ${w.now.feels}° · 최고 ${w.today.max}° 최저 ${w.today.min}°`,
      sections: [{ title: '앞으로 12시간', rows }, { title: '더 보기', rows: more }],
      foot: weather.advice(w),
      tone: 'info',
      actions: [BACK],
    };
  }
  async function timetableDetail() {
    const c = schoolCfg();
    if (!c.school) return { title: '학교를 먼저 골라 줘 🏫', sub: '설정 → 학교', icon: '📚', tone: 'info', actions: [BACK] };
    const rows = await dayTimetable(0).catch(() => null);
    if (!rows || !rows.length) return { title: '오늘은 시간표가 없어', sub: '주말·방학이거나 학교가 아직 안 올렸어', icon: '📚', tone: 'info', actions: [BACK] };
    const bell = bellOf();
    const now = nowMinutes();
    const list = rows.map((r) => {
      const b = bell.find((x) => x.period === r.period);
      return {
        left: `${r.period}교시`,
        text: r.free ? '☕ 공강' : r.subject,
        right: b ? `${school.hm(b.start)}~${school.hm(b.end)}` : '',
        free: !!r.free,
        now: !!(b && b.start <= now && now < b.end),
        done: !!(b && b.end <= now),
      };
    });
    const notes = [];
    if (rows.some((r) => r.free)) notes.push(`공강 ${rows.filter((r) => r.free).length}번`);
    if (rows.elective && !rows.picked) notes.push('선택 과목은 그 시간 수업을 모아 보여 줘 (설정 → 학교 → 내 수업 고르기)');
    return {
      kind: 'detail',
      icon: '📚',
      title: '오늘 시간표',
      sub: `${c.school.name} ${c.grade}학년 ${c.cls}반${rows.picked ? ' · 내 수업' : rows.rooms ? ' · 분반 기준' : ''}`,
      sections: [{ rows: list }],
      foot: notes.join(' · '),
      tone: 'info',
      actions: [BACK],
    };
  }
  async function mealDetail() {
    const c = schoolCfg();
    if (!c.school) return { title: '학교를 먼저 골라 줘 🏫', sub: '설정 → 학교', icon: '🍚', tone: 'info', actions: [BACK] };
    const [m, t] = await Promise.all([school.meals(c.school, new Date(), null).catch(() => ({})), school.meals(c.school, dayAfter(1), null).catch(() => ({}))]);
    const sections = [];
    for (const k of ['breakfast', 'lunch', 'dinner']) {
      if (!m[k]) continue;
      sections.push({ title: `${MEAL_KO[k]}${m[k].kcal ? ` · ${Math.round(m[k].kcal)}kcal` : ''}`, rows: m[k].dishes.map((d) => ({ text: d })) });
    }
    if (!sections.length) sections.push({ rows: [{ text: '오늘은 급식 정보가 없어' }] });
    const tl = t.lunch || t.dinner;
    return {
      kind: 'detail',
      icon: '🍚',
      title: '오늘 급식',
      sub: c.school.name,
      sections,
      foot: tl ? `내일 ${t.lunch ? '점심' : '저녁'}: ${tl.dishes.slice(0, 4).join(', ')}` : '',
      tone: 'happy',
      actions: [BACK],
    };
  }
  function alarmsDetail() {
    const list = loadAlarms().sort((a, b) => a.at - b.at);
    return {
      kind: 'detail',
      icon: '⏰',
      title: `알람 ${list.length}개`,
      sub: '"알람 다 꺼"라고 하면 한 번에 꺼져',
      sections: [{ rows: list.length ? list.map((a) => ({ left: whenText(a.at), text: a.what && a.what !== '말한 시간' ? a.what : '알람' })) : [{ text: '맞춰 둔 알람이 없어' }] }],
      tone: 'info',
      actions: [BACK],
    };
  }
  async function briefDetail(what) {
    try {
      if (what === 'back') return showBrief();
      if (what === 'today') {
        if (!today) await refresh().catch(() => {});
        return say({ ...summary(), actions: [BACK] }, 25);
      }
      const card = what === 'weather' ? await weatherDetail() : what === 'class' ? await timetableDetail() : what === 'meal' ? await mealDetail() : what === 'alarms' ? alarmsDetail() : null;
      if (card) say(card, 25);
    } catch (e) {
      say({ title: '자세히 못 불러왔어 😢', sub: e.message, icon: '😢', tone: 'sad', actions: [BACK] }, 6);
    }
  }
  async function tickBrief() {
    const cfg = loadConfig();
    if (cfg.briefing === false || document.hidden) return;
    const d = new Date();
    const key = dateKey(d);
    if (cfg.lastBrief === key || d.getHours() < 5 || d.getHours() >= 12) return;
    saveConfig({ lastBrief: key });
    await showBrief();
  }
  async function tickRain() {
    const cfg = loadConfig();
    if (cfg.rainAlert === false) return;
    const key = dateKey();
    if (cfg.lastRainAlert === key) return;
    const h = new Date().getHours();
    if (h < 6 || h >= 22) return;
    try {
      const w = await weather.get(placeConfig());
      if (w.rainSoon && w.rainSoon.inHours <= 2) {
        saveConfig({ lastRainAlert: key });
        say(
          { title: w.rainSoon.inHours <= 0 ? '지금 비 올 것 같아!' : `${w.rainSoon.hour}시쯤 비 올 것 같아!`, sub: `비 올 확률 ${w.rainSoon.prob}% · 나갈 때 우산 챙겨`, tone: 'alert', icon: '☔', react: 'hop' },
          20,
        );
      }
    } catch {
      /* 조용히 넘어간다 */
    }
  }

  // ---------- 바깥 열기 ----------
  function openUrl(url) {
    if (native && native.openUrl) native.openUrl(url);
    else window.open(url, '_blank', 'noopener');
  }
  const openSearch = (engine, query) => openUrl(intent.searchUrl(engine, query));

  // ---------- AI ----------
  function aiConfig() {
    const c = loadConfig().ai || {};
    return { provider: c.provider === 'claude' ? 'claude' : 'gemini', claudeModel: c.claudeModel };
  }
  function aiStatus() {
    const cfg = aiConfig();
    return {
      provider: cfg.provider,
      providers: Object.entries(PROVIDERS).map(([id, v]) => ({ id, name: v.name, hasKey: v.mod.hasKey() })),
      ready: PROVIDERS[cfg.provider].mod.hasKey(),
      claudeModels: claude.MODELS,
      claudeModel: cfg.claudeModel || claude.DEFAULT_MODEL,
      geminiModel: gemini.currentModel(),
    };
  }
  async function askAI(question) {
    const st = aiStatus();
    if (!st.ready) return null;
    try {
      react('nod');
      const cfg = aiConfig();
      const opts = { history: askHistory, system: systemPrompt(charName()) };
      if (cfg.provider === 'claude') opts.model = cfg.claudeModel || claude.DEFAULT_MODEL;
      const r = await PROVIDERS[cfg.provider].mod.ask(question, opts);
      askHistory.push({ role: 'user', text: question }, { role: 'model', text: r.text });
      if (askHistory.length > 16) askHistory.splice(0, askHistory.length - 16);
      react('happy');
      return {
        text: r.text,
        sub: `${st.provider === 'claude' ? 'Claude' : '제미나이'}가 도와줬어`,
        buttons: (r.sources || []).map((src) => ({ label: src.title, action: 'link', url: src.url })),
        ai: true,
      };
    } catch (e) {
      return { text: e.message === 'NO_KEY' ? 'AI 키가 없어. 설정 → AI 연결에서 넣어 줘.' : e.message, buttons: SEARCH_BUTTONS(question) };
    }
  }

  const timeText = (d = new Date()) => `${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}시 ${d.getMinutes()}분`;

  async function answer(input) {
    const r = intent.parse(input);
    switch (r.type) {
      case 'empty':
        return { text: '궁금한 걸 말하거나 적어 줘!' };
      case 'time':
        react('nod');
        return { text: `지금은 ${timeText()}이야!` };
      case 'date': {
        const d = new Date();
        return { text: `오늘은 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일이야.` };
      }
      case 'today': {
        if (!today) await refresh();
        const card = summary();
        say(card, 20);
        if (card.kind !== 'today') return { text: card.title, sub: card.sub };
        const left = card.todos.filter((t) => !t.done).length;
        const next = card.events.find((e) => e.state === 'next' || e.state === 'now');
        let text = left ? `남은 할 일이 ${left}개 있어.` : '할 일은 다 끝냈어! 🎉';
        if (next) text += ` ${next.state === 'now' ? '지금' : next.time + '에'} "${next.title}" 일정이 있어.`;
        return { text, sub: '자세한 건 캐릭터 말풍선에 띄웠어' };
      }
      case 'focus': {
        const sec = r.seconds || focusMinutes() * 60;
        startTimer('focus', sec);
        return { text: `${intent.formatDuration(sec)} 집중 시작! 🔥`, sub: `끝나면 ${breakMinutesFor(sec)}분 쉬는 시간도 알려줄게` };
      }
      case 'focus-set': {
        const m = Math.round(r.seconds / 60);
        if (!setFocusMinutes(m)) return { text: '집중 시간은 5분에서 3시간 사이로 정할 수 있어 🙂' };
        pushSettings();
        return { text: `앞으로 집중은 ${intent.formatDuration(m * 60)}으로 할게! 🍅`, sub: '"집중 시작"이라고 하면 바로 시작해' };
      }
      case 'timer':
        startTimer('timer', r.seconds);
        return { text: `${intent.formatDuration(r.seconds)} 타이머 시작! ⏱️` };
      case 'timer-stop':
        return { text: stopTimer(false) ? '타이머 멈췄어.' : '지금 켜진 타이머는 없어.' };
      case 'remind':
        addAlarm(Date.now() + r.seconds * 1000, r.what, 'remind');
        react('nod');
        return { text: `${intent.formatDuration(r.seconds)} 뒤에 알려줄게! 🔔`, sub: r.what !== '말한 시간' ? `"${r.what}"` : '' };
      case 'alarm': {
        const at = intent.alarmDate(r.clock).getTime();
        addAlarm(at, r.what, 'alarm');
        react('nod');
        const left = Math.round((at - Date.now()) / 60000);
        const keep = native ? '' : ' · 이 화면을 켜 둬야 울려';
        return { text: `${whenText(at)}에 알람 맞췄어! ⏰`, sub: `${r.what ? `"${r.what}" · ` : ''}${intent.formatDuration(left * 60)} 뒤${keep}` };
      }
      case 'alarm-list': {
        const list = loadAlarms();
        if (!list.length) return { text: '맞춰 둔 알람이 없어.' };
        return { text: `알람 ${list.length}개 있어.`, sub: list.map((a) => `• ${whenText(a.at)}${a.what && a.what !== '말한 시간' ? ` — ${a.what}` : ''}`).join('\n') };
      }
      case 'alarm-clear': {
        const n = clearAlarms();
        return { text: n ? `알람 ${n}개 다 껐어.` : '꺼 둘 알람이 없어.' };
      }
      case 'weather':
        react('lookAround');
        return weatherAnswer(r.when);
      case 'meal':
        react('nod');
        return mealAnswer(r);
      case 'timetable':
        react('nod');
        return timetableAnswer(r);
      case 'brief':
        await showBrief();
        return { text: '브리핑을 캐릭터 말풍선에 띄웠어! ☀️' };
      case 'todo-add': {
        if (!(await checkmate.currentUser().catch(() => null))) return { text: '체크메이트에 로그인해야 할 일을 넣을 수 있어.', sub: '나를 눌러서 설정 → 체크메이트 로그인' };
        if (!r.title) return { text: '뭘 추가할까? ✍️', sub: '예: "수학 숙제 추가해줘", "내일 영어 단어 할 일 추가"' };
        if (!today) await refresh();
        const g = splitGoal(r.title);
        try {
          const row = await addTodoAndRefresh(g.title, g.goalId, r.dayOffset);
          react('happy');
          const when = ['오늘', '내일', '모레'][r.dayOffset] || '';
          if (r.dayOffset === 0) say(summary(), 12);
          return { text: `"${row.title}" 추가했어! ✅`, sub: `${when} · ${row.goal} 목표에 넣었어` };
        } catch (e) {
          return { text: '할 일을 못 넣었어 😢', sub: e.message };
        }
      }
      case 'screen':
        return {
          text: '폰에서는 화면을 못 봐 😅',
          sub: '폰은 다른 앱 화면을 찍는 걸 막아 둬서, 화면 봐 주기는 컴퓨터 비서에서만 돼. 궁금한 걸 글로 적어 주면 대답해 줄게!',
        };
      case 'me': {
        const g = growth.view(loadConfig().growth);
        react('wave');
        return { text: `나는 ${charName()}! 네 옆에서 일정이랑 할 일 챙겨 주는 비서야 🐾`, sub: `지금 Lv.${g.level} · 다음 레벨까지 ${g.need - g.cur} XP` };
      }
      case 'wiki': {
        const viaAI = await askAI(r.query);
        if (viaAI) return viaAI;
        try {
          react('nod');
          let hit = null;
          for (const t of r.topics || [r.topic]) {
            hit = await wiki.lookup(t);
            if (hit) break;
          }
          if (hit) {
            react('happy');
            return {
              text: hit.text,
              sub: `위키백과 「${hit.title}」에서 찾았어`,
              buttons: [{ label: '위키백과에서 더 보기', action: 'link', url: hit.url }, ...SEARCH_BUTTONS(r.topic).slice(0, 1)],
            };
          }
          return { text: `"${r.topic}"은(는) 위키백과에 없네 😅`, sub: '검색해 볼까?', buttons: SEARCH_BUTTONS(r.topic) };
        } catch (e) {
          return { text: '찾아보다가 막혔어 😢', sub: e.message, buttons: SEARCH_BUTTONS(r.topic) };
        }
      }
      case 'need-time':
        return { text: `몇 분짜리 ${r.what === '알람' ? '알람' : '타이머'}? ⏱️`, sub: '예: "10분 타이머", "25분 집중", "7시에 알람"' };
      case 'open': {
        const url = SITES[normName(r.name)];
        if (url) {
          openUrl(url);
          react('nod');
          return { text: `${r.name} 열었어! 🌐` };
        }
        // 안드로이드: 폰에 깔린 앱을 이름으로 찾아서 연다
        if (native && native.openApp) {
          const opened = native.openApp(String(r.name));
          if (opened) {
            react('hop');
            return { text: `${opened} 열었어! 🚀` };
          }
          return { text: `"${r.name}"(이)라는 앱을 못 찾았어 😅`, sub: '폰에 보이는 앱 이름으로 말해 줘. 아니면 검색해 볼까?', buttons: SEARCH_BUTTONS(r.name) };
        }
        return { text: '아이폰에서는 내가 앱을 대신 열 수 없어 😢', sub: '대신 검색은 해 줄 수 있어', buttons: SEARCH_BUTTONS(r.name) };
      }
      case 'search':
        openSearch(r.engine, r.query);
        return { text: `${ENGINE_NAME[r.engine]}에서 "${r.query}" 찾아봤어! 🔍`, buttons: SEARCH_BUTTONS(r.query).filter((b) => b.engine !== r.engine) };
      case 'calc':
        return { text: `${r.expr} = ${r.value.toLocaleString('ko-KR')}` };
      case 'hello':
        react('wave');
        return { text: '안녕! 오늘도 반가워 👋' };
      case 'love':
        react('love');
        return { text: '나도 좋아해! 💕' };
      case 'dance':
        react('dance');
        return { text: '그럼 같이 춤추자~ ♪' };
      case 'thanks':
        react('happy');
        return { text: '천만에! 언제든 불러 줘 😊' };
      case 'tired':
        react('love');
        return { text: '오늘 많이 힘들었구나… 잠깐 쉬어도 괜찮아. 물 한 잔 어때? 💧' };
      case 'help':
        return {
          text: '이런 걸 할 수 있어!',
          sub: [
            '• 지금 몇 시야 / 오늘 며칠이야',
            '• 오늘 할 일 알려줘',
            '• 집중 시작 / 50분 집중 / 집중 시간 45분으로 바꿔줘',
            '• 10분 타이머 / 타이머 그만',
            '• 30분 뒤에 빨래 알려줘 / 내일 아침 7시에 깨워줘',
            '• 알람 뭐 있어 / 알람 다 꺼',
            native ? '• 카톡 열어줘 / 유튜브 틀어줘' : '• 유튜브 열어줘 / 네이버 열어줘',
            '• 날씨 어때 / 내일 날씨 / 우산 필요해? / 브리핑 해줘',
            '• 수학 숙제 추가해줘 / 내일 영어 단어 할 일 추가',
            '• 블랙홀이 뭐야 / 세종대왕 누구야 (위키백과)',
            '• ○○ 검색해줘 / 유튜브에서 ○○',
            '• 12*34 계산',
          ].join('\n'),
        };
      default: {
        const viaAI = await askAI(r.query);
        if (viaAI) return viaAI;
        return { text: '그건 아직 내가 직접 대답하기 어려워 😅', sub: `"${r.query}" 검색해 볼까? (설정 → AI 연결에서 제미나이를 켜면 내가 직접 대답할 수 있어)`, buttons: SEARCH_BUTTONS(r.query) };
      }
    }
  }

  // ---------- 설정 ----------
  function isAutoStart() {
    return !!(native && native.isAutoStart && native.isAutoStart());
  }
  async function settingsState() {
    const user = await checkmate.currentUser().catch(() => null);
    return {
      characters3d: CHARACTERS_3D,
      images: Object.keys(images()),
      current: currentCharacter(),
      remindBefore: remindBefore(),
      size: sizeScale(),
      autoStart: isAutoStart(),
      health: healthConfig(),
      timer: timerState(),
      place: placeConfig(),
      briefing: loadConfig().briefing !== false,
      rainAlert: loadConfig().rainAlert !== false,
      focusGuard: false,
      focusMinutes: focusMinutes(),
      focusOptions: FOCUS_OPTIONS,
      ai: aiStatus(),
      email: user ? user.email : null,
      platform: host.kind,
      overlay: !!(native && native.isOverlayOn && native.isOverlayOn()),
      growth: growth.view(loadConfig().growth),
      school: schoolState(),
    };
  }
  async function pushSettings() {
    if (!(listeners['settings:update'] || new Set()).size) return;
    emit('settings:update', await settingsState());
  }

  const closeSheet = (name) => host.closeSheet && host.closeSheet(name);
  const openSheet = (name) => host.openSheet && host.openSheet(name);

  function toggleFocus() {
    closeSheet('settings');
    if (getTimer()) stopTimer(true);
    else startTimer('focus', focusMinutes() * 60);
  }

  function cardAction(id) {
    if (typeof id !== 'string') return;
    if (id.startsWith('brief:')) return briefDetail(id.slice(6));
    if (id === 'guard:back') react('happy');
    if (id === 'guard:pause') guardPaused = Date.now() + 5 * 60 * 1000;
    if (id.startsWith('snooze:')) {
      addAlarm(Date.now() + 5 * 60 * 1000, id.slice(7), 'alarm');
      say({ title: '5분 뒤에 다시 깨울게', tone: 'info', icon: '😴' }, 4);
    }
  }

  async function login({ email, password }) {
    try {
      await checkmate.signIn(email, password);
    } catch (err) {
      return { ok: false, message: err.message };
    }
    closeSheet('login');
    await refresh();
    pushSettings();
    say(summary({ title: '로그인 완료! 🎉', tone: 'happy' }), 14);
    return { ok: true };
  }
  async function logout() {
    await checkmate.signOut();
    today = null;
    pushSettings();
    say({ title: '로그아웃했어', sub: '다시 로그인하면 또 알려줄게', tone: 'info', icon: '👋' }, 5);
  }

  // ---------- 화면별 window.assistant ----------
  function assistantFor(page) {
    const voiceApi = native && native.listen ? nativeVoice() : webVoice();
    return {
      platform: host.kind,
      setShape: (rects) => host.setShape && host.setShape(rects),
      dragStart: (type) => host.dragStart && host.dragStart(type),
      dragBy: (dx, dy) => Promise.resolve(host.dragBy ? host.dragBy(dx, dy) : false),
      dragMove: (dx, dy) => host.dragMove && host.dragMove(dx, dy),
      dragEnd: () => host.dragEnd && host.dragEnd(),
      showMenu: () => openSheet('settings'),
      clicked: () => (host.toggleSheet ? host.toggleSheet('settings') : openSheet('settings')),
      onCharacter: (fn) => on('character', fn),
      onCursor: (fn) => on('cursor', fn),
      onSize: (fn) => on('size', fn),
      resizeBy: (step) => setSize(sizeScale() + (step > 0 ? 0.1 : -0.1)),
      onSay: (fn) => on('say', fn),
      onReact: (fn) => on('react', fn),
      onTimer: (fn) => on('timer', fn),
      onXp: (fn) => on('xp', fn),
      stopTimer: toggleFocus,
      cardAction,
      todoAction: (id, op, title) => todoAction({ id, op, title }),
      todoAdd: (title, goalId) => todoAdd({ title, goalId }),
      login: (email, password) => login({ email, password }),
      ask: {
        submit: (text) => answer(String(text || '').slice(0, 300)),
        search: (engine, query) => {
          if (ENGINE_NAME[engine] && query) openSearch(engine, String(query).slice(0, 300));
        },
        voice: () => {},
        link: (url) => {
          if (typeof url === 'string' && /^https?:\/\//.test(url)) openUrl(url);
        },
        close: () => closeSheet('ask'),
        onFocus: (fn) => on('ask:focus', fn),
        ...voiceApi,
      },
      settings: {
        get: () => settingsState(),
        onUpdate: (fn) => on('settings:update', fn),
        setCharacter: chooseCharacter,
        setAccessory: (id) => {
          const state = growth.normalize(loadConfig().growth);
          if (!growth.canWear(state, id)) return;
          saveConfig({ growth: { ...state, accessory: id || null } });
          sendCharacter();
          pushSettings();
        },
        setRemind: (min) => {
          if (![0, 5, 10, 30].includes(min)) return;
          saveConfig({ remindBefore: min });
          pushSettings();
        },
        setAutoStart: (v) => {
          if (native && native.setAutoStart) native.setAutoStart(!!v);
          pushSettings();
        },
        setSize: (v) => setSize(Number(v)),
        setHealth: (key, v) => {
          if (!HEALTH[key]) return;
          saveConfig({ health: { ...healthConfig(), [key]: !!v } });
          healthLast[key] = Date.now();
          pushSettings();
        },
        focus: toggleFocus,
        setFocusMinutes: (m) => {
          if (setFocusMinutes(m)) pushSettings();
        },
        ask: () => {
          closeSheet('settings');
          openSheet('ask');
        },
        aiSaveKey: async (provider, key) => {
          const P = PROVIDERS[provider];
          if (!P) return { ok: false, message: '알 수 없는 AI야.' };
          try {
            const r = await P.mod.verifyAndSave(key);
            saveConfig({ ai: { ...aiConfig(), provider } });
            pushSettings();
            say({ title: `${P.name} 연결 완료!`, sub: '이제 물어보기에서 뭐든 대답해 줄게', tone: 'happy', icon: '🧠', react: 'cheer' }, 6);
            return { ok: true, model: r.model };
          } catch (e) {
            return { ok: false, message: e.message };
          }
        },
        aiClearKey: (provider) => {
          const P = PROVIDERS[provider];
          if (P) P.mod.clearKey();
          pushSettings();
        },
        aiSet: (patch) => {
          const next = { ...aiConfig() };
          if (patch.provider && PROVIDERS[patch.provider]) next.provider = patch.provider;
          if (patch.claudeModel) next.claudeModel = String(patch.claudeModel);
          saveConfig({ ai: next });
          pushSettings();
        },
        aiKeyPage: (provider) => {
          const P = PROVIDERS[provider];
          if (P) openUrl(P.keyUrl);
        },
        placeSearch: async (name) => {
          try {
            return { ok: true, list: await weather.searchPlace(String(name || '').slice(0, 30)) };
          } catch (e) {
            return { ok: false, message: e.message };
          }
        },
        setPlace: (p) => {
          if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
          saveConfig({ place: { name: String(p.name).slice(0, 30), admin: String(p.admin || '').slice(0, 30), lat: p.lat, lon: p.lon } });
          pushSettings();
        },
        toggle: (key, v) => {
          if (key === 'overlay') {
            if (native && native.setOverlay) native.setOverlay(!!v);
            setTimeout(pushSettings, 600);
            return;
          }
          if (!['briefing', 'rainAlert'].includes(key)) return;
          saveConfig({ [key]: !!v });
          pushSettings();
        },
        brief: () => {
          closeSheet('settings');
          showBrief();
        },
        schoolSearch: async (name) => {
          try {
            return { ok: true, list: await school.search(String(name || '').slice(0, 30), null) };
          } catch (e) {
            return { ok: false, message: e.message };
          }
        },
        schoolSet,
        schoolCourses: async () => {
          const c = schoolCfg();
          if (!c.school || !c.grade) return { ok: false, message: '학교와 학년을 먼저 골라 줘' };
          try {
            return { ok: true, list: await school.courses(c.school, c.grade, new Date(), null), mine: Array.isArray(c.mine) ? c.mine : [] };
          } catch (e) {
            return { ok: false, message: e.message };
          }
        },
        importImage,
        removeImage: (name) => {
          const all = images();
          if (!all[name]) return;
          delete all[name];
          writeJSON('images', all);
          if (loadConfig().character === name) {
            const back = loadConfig().last3d;
            chooseCharacter(back && CHARACTERS_3D.some((c) => '3d:' + c.id === back) ? back : '3d:cat');
          } else pushSettings();
        },
        openFolder: () => {},
        today: () => {
          closeSheet('settings');
          say(summary(), 20);
        },
        refresh: async () => {
          closeSheet('settings');
          await refresh({ announce: true });
          say(summary(), 20);
        },
        login: () => {
          closeSheet('settings');
          openSheet('login');
        },
        logout,
        close: () => closeSheet('settings'),
        quit: () => {
          if (native && native.quit) native.quit();
          else closeSheet('settings');
        },
      },
    };
  }

  // ---------- 음성 ----------
  // 안드로이드: 폰의 음성 인식·읽어 주기 (AndroidBridge) / 아이폰 웹앱: 사파리 음성 인식·읽어 주기
  function nativeVoice() {
    let pending = null;
    window.__aibiseoVoice = (text) => {
      if (pending) pending(String(text || ''));
      pending = null;
    };
    return {
      listen: () =>
        new Promise((resolve) => {
          pending = resolve;
          native.listen();
          setTimeout(() => {
            if (pending === resolve) {
              pending = null;
              resolve('');
            }
          }, 20000);
        }),
      speak: (text) => native.speak && native.speak(String(text)),
      stopSpeak: () => native.stopSpeak && native.stopSpeak(),
    };
  }
  function webVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return {};
    return {
      listen: () =>
        new Promise((resolve) => {
          const rec = new SR();
          rec.lang = 'ko-KR';
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          let said = '';
          rec.onresult = (e) => {
            said = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || '';
          };
          rec.onend = () => resolve(said);
          rec.onerror = () => resolve('');
          rec.start();
        }),
    };
  }

  // ---------- 시작 ----------
  let started = false;
  function start() {
    if (started) return;
    started = true;
    sendCharacter();
    emit('size', { stage: stagePx() });
    if (native && native.setStage) native.setStage(stagePx());
    const hello = host.kind === 'android-overlay' ? '여기 있을게! 나를 누르면 설정이야' : '나를 누르면 설정, 꾹 누르면 애교!';
    say({ title: '안녕!', sub: hello, tone: 'happy', icon: '👋' }, 6);
    refresh({ announce: true }).then(checkReminders);
    if (isLeader()) checkMissedAlarms();
    const lead = (fn) => () => {
      if (isLeader()) fn();
    };
    setInterval(lead(checkReminders), CHECK_MS);
    setInterval(() => refresh(), REFRESH_MS);
    setInterval(() => {
      if (isLeader()) tickTimer();
      else sendTimer();
    }, 1000);
    setInterval(lead(tickBrief), 30 * 1000);
    setTimeout(lead(tickBrief), 8000);
    setInterval(lead(tickRain), 20 * 60 * 1000);
    setTimeout(lead(tickRain), 60 * 1000);
    setInterval(lead(tickHealth), 30 * 1000);
    setInterval(lead(tickSchool), 30 * 1000);
    // 다른 화면(앱 ↔ 떠 있는 캐릭터)에서 캐릭터·크기를 바꾸면 따라 바꾼다
    let lastLook = `${currentCharacter()}|${sizeScale()}`;
    setInterval(() => {
      const look = `${currentCharacter()}|${sizeScale()}`;
      if (look === lastLook) return;
      lastLook = look;
      sendCharacter();
      emit('size', { stage: stagePx() });
      if (native && native.setStage) native.setStage(stagePx());
    }, 2000);
    // 다시 화면을 켜면 할 일을 새로 받아 온다
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh().then(checkReminders);
    });
  }

  return {
    assistantFor,
    start,
    emit,
    say,
    summary,
    refresh,
    answer,
    showToday: () => say(summary(), 20),
    focusAsk: () => emit('ask:focus'),
    settingsState,
    // 테스트용
    _debug: { setToday: (t) => (today = t), checkmate, intent },
  };
}

window.createAIBackend = createAIBackend;
