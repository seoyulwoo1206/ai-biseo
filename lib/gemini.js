// 구글 제미나이(Gemini API)로 대답 받기.
// - 키는 윈도우 계정으로 암호화해서 저장한다 (gemini-key.bin)
// - 어떤 모델을 쓸지는 키로 쓸 수 있는 모델 목록을 받아서 가장 새 Flash 모델로 고른다
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const API = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODEL = 'gemini-2.5-flash';

const keys = require('./keys');
const metaFile = () => path.join(app.getPath('userData'), 'gemini.json');

const loadKey = () => keys.load('gemini');
const saveKey = (key) => keys.save('gemini', key);

function clearKey() {
  keys.clear('gemini');
  try {
    fs.unlinkSync(metaFile());
  } catch {
    /* 없으면 그만 */
  }
}

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveMeta(meta) {
  fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2));
}

function hasKey() {
  return !!loadKey();
}

// 구글이 돌려준 오류를 알아듣기 쉬운 말로
function friendlyError(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  const reason = JSON.stringify((body && body.error && body.error.details) || '');
  if (/API_KEY_INVALID|API key not valid/i.test(msg + reason)) return '키가 맞지 않아. 설정에서 키를 다시 넣어 줘.';
  if (status === 429) return '무료 사용량을 잠깐 다 썼어. 조금 있다가 다시 물어봐 줘!';
  if (status === 403) return '이 키로는 제미나이를 쓸 수 없대. (계정 나이 제한이나 지역 제한일 수 있어)';
  if (status >= 500) return '제미나이 서버가 잠깐 아픈가 봐. 조금 있다가 다시 해 줘.';
  return msg ? `제미나이 오류: ${msg.slice(0, 120)}` : `제미나이 오류 (${status})`;
}

async function call(url, key, init = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(init.headers || {}) },
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
    const err = new Error(friendlyError(res.status, body));
    err.status = res.status;
    throw err;
  }
  return body;
}

// 쓸 수 있는 모델 중에서 가장 새 "flash" 모델 고르기
function pickModel(models) {
  const ok = models.filter(
    (m) =>
      (m.supportedGenerationMethods || []).includes('generateContent') &&
      /gemini-[\d.]+-flash/.test(m.name) &&
      !/(lite|image|tts|audio|live|embedding|exp|preview|thinking|8b)/i.test(m.name),
  );
  const ver = (m) => Number((m.name.match(/gemini-([\d.]+)/) || [])[1] || 0);
  ok.sort((a, b) => ver(b) - ver(a) || a.name.length - b.name.length);
  return ok.length ? ok[0].name.replace(/^models\//, '') : null;
}

// 키를 확인하고 모델을 정해 둔다. 성공하면 { model }
async function verifyAndSave(key) {
  key = String(key || '').trim();
  if (!/^[\w-]{20,}$/.test(key)) throw new Error('키 모양이 이상해. AI Studio 에서 복사한 키를 그대로 붙여 넣어 줘.');
  const list = await call(`${API}/models?pageSize=1000`, key);
  const model = pickModel((list && list.models) || []) || FALLBACK_MODEL;
  saveKey(key);
  saveMeta({ model, checkedAt: new Date().toISOString() });
  return { model };
}

function currentModel() {
  return loadMeta().model || FALLBACK_MODEL;
}

// 마크다운 기호를 말풍선에 맞게 정리
function tidy(text) {
  return text
    .replace(/^#{1,6}\s*(.+)$/gm, '## $1') // 소제목은 "## " 로 통일 (물어보기 창이 꾸며 보여 준다)
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/`([^`\n]+)`/g, '$1') // 한 줄 안의 `코드`만 (```json 블록은 그대로 둔다)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 질문하기
 * @param {string} question
 * @param {{ history?: {role:'user'|'model', text:string}[], context?: string, name?: string }} opts
 * @returns {Promise<{ text: string, sources: {title:string, url:string}[], model: string }>}
 */
async function ask(question, { history = [], system = '', image = null } = {}) {
  const key = loadKey();
  if (!key) throw new Error('NO_KEY');
  const model = currentModel();
  // image: { mime, data(base64) } — 화면 사진을 질문 앞에 붙인다
  const parts = image ? [{ inline_data: { mime_type: image.mime, data: image.data } }, { text: question }] : [{ text: question }];
  const contents = [...history.slice(-8).map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts }];
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.8, maxOutputTokens: image ? 2048 : 1024 }, // 화면 풀이는 조금 길게
  };

  const url = `${API}/models/${model}:generateContent`;
  let res;
  try {
    // 구글 검색을 같이 써서 최신 정보도 대답하게 한다
    res = await call(url, key, { method: 'POST', body: JSON.stringify({ ...body, tools: [{ google_search: {} }] }) });
  } catch (e) {
    if (e.status !== 400 && e.status !== 403) throw e;
    // 검색 도구를 못 쓰는 모델이면 검색 없이 다시
    res = await call(url, key, { method: 'POST', body: JSON.stringify(body) });
  }

  const cand = (res && res.candidates && res.candidates[0]) || {};
  const text = ((cand.content && cand.content.parts) || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) {
    if (cand.finishReason === 'SAFETY') return { text: '그건 내가 대답하기 어려운 질문이야. 다른 걸 물어봐 줄래?', sources: [], model };
    return { text: '음… 대답을 못 만들었어. 다시 물어봐 줄래?', sources: [], model };
  }
  const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const sources = chunks
    .map((c) => c.web)
    .filter((w) => w && /^https?:\/\//.test(w.uri))
    .slice(0, 3)
    .map((w) => ({ title: (w.title || '출처').slice(0, 30), url: w.uri }));
  return { text: tidy(text), sources, model };
}

module.exports = { ask, verifyAndSave, hasKey, clearKey, currentModel, pickModel, friendlyError };
