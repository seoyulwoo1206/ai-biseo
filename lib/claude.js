// Claude(Anthropic) 로 대답 받기 — 공식 SDK(@anthropic-ai/sdk) 사용.
// - 키는 윈도우 계정으로 암호화해서 저장 (keys.js)
// - 거절 시 다른 모델로 자동 재시도(server-side fallback)를 기본으로 켠다
// - 최신 정보가 필요하면 웹 검색 도구를 쓴다
const SDK = require('@anthropic-ai/sdk');
const keys = require('./keys');

const Anthropic = SDK.Anthropic || SDK.default;

// 고를 수 있는 모델 (기본: Opus 5.5)
const MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus', note: '가장 똑똑함' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet', note: '빠르고 똑똑함' },
  { id: 'claude-haiku-5-5', name: 'Haiku', note: '가장 저렴' },
];
const DEFAULT_MODEL = 'claude-opus-5-5';

const loadKey = () => keys.load('claude');

function hasKey() {
  return !!loadKey();
}

function clearKey() {
  keys.clear('claude');
}

function client(key) {
  return new Anthropic({ apiKey: key, timeout: 60 * 1000, maxRetries: 1 });
}

function friendlyError(e) {
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
}

// 키 확인 (모델 목록 조회는 요금이 들지 않는다)
async function verifyAndSave(key) {
  key = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new Error('키 모양이 이상해. "sk-ant-"로 시작하는 키를 그대로 붙여 넣어 줘.');
  try {
    await client(key).models.list({ limit: 1 });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  keys.save('claude', key);
  return { model: DEFAULT_MODEL };
}

function tidy(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/`([^`\n]+)`/g, '$1') // 한 줄 안의 `코드`만 (```json 블록은 그대로 둔다)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 화면 질문 때 Claude 가 쓰는 확대 도구: 보낸 사진의 일부를 원본 해상도로 다시 본다
const ZOOM_TOOL = {
  name: 'zoom_screen',
  description:
    '보내 준 화면 사진의 일부분을 원래 해상도로 크게 다시 본다. 작은 글자·수식·코드·표의 숫자를 정확히 읽어야 하는데 흐리거나 작을 때 쓴다. 좌표는 처음 받은 화면 사진의 픽셀 기준(왼쪽 위가 0,0).',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'integer', description: '왼쪽 위 x (px)' },
      y: { type: 'integer', description: '왼쪽 위 y (px)' },
      width: { type: 'integer', description: '너비 (px)' },
      height: { type: 'integer', description: '높이 (px)' },
    },
    required: ['x', 'y', 'width', 'height'],
    additionalProperties: false,
  },
};
const MAX_ZOOMS = 4;

/**
 * 질문하기
 * @param {string} question
 * @param {{ history?: {role:'user'|'model', text:string}[], system?: string, model?: string,
 *           image?: {mime:string, data:string}|null, zoom?: (r:{x:number,y:number,width:number,height:number}) => {mime:string,data:string,note:string},
 *           effort?: 'low'|'medium'|'high' }} opts
 */
async function ask(question, { history = [], system = '', model = DEFAULT_MODEL, image = null, zoom = null, effort = 'low' } = {}) {
  const key = loadKey();
  if (!key) throw new Error('NO_KEY');
  if (!MODELS.some((m) => m.id === model)) model = DEFAULT_MODEL;
  // 그림을 보고 확대까지 하면 오래 걸릴 수 있어서 넉넉히 기다린다
  const api = image ? new Anthropic({ apiKey: key, timeout: 150 * 1000, maxRetries: 1 }) : client(key);

  // image: { mime, data(base64) } — 화면 사진을 질문 앞에 붙인다
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } }, { type: 'text', text: question }]
    : question;
  const messages = [
    ...history.slice(-8).map((h) => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text })),
    { role: 'user', content },
  ];
  // Haiku 는 서버 쪽 대체 모델이 없고, 웹 검색은 기본형을 쓴다
  const isHaiku = model.startsWith('claude-haiku');
  const tools = [{ type: isHaiku ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  if (image && zoom) tools.push(ZOOM_TOOL);
  const params = {
    model,
    max_tokens: 16000,
    system,
    output_config: { effort }, // 보통 대화는 가볍게(low), 문제 풀이·오류는 깊게(high)
    tools,
    ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
  };

  let res;
  let zooms = 0;
  try {
    res = await api.beta.messages.create({ ...params, messages });
    // 검색이 길어지면 잠깐 멈췄다가(pause_turn) 이어서 하고, 확대 도구를 부르면 잘라서 보여 준다
    for (let i = 0; i < 8 && (res.stop_reason === 'pause_turn' || res.stop_reason === 'tool_use'); i++) {
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'tool_use') {
        const results = [];
        for (const block of res.content) {
          if (block.type !== 'tool_use') continue;
          if (block.name !== 'zoom_screen' || !zoom) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: '이 도구는 쓸 수 없어.', is_error: true });
          } else if (zooms >= MAX_ZOOMS) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: '더는 확대할 수 없어. 지금까지 본 걸로 대답해.', is_error: true });
          } else {
            zooms++;
            try {
              const z = zoom(block.input || {});
              results.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [
                  { type: 'text', text: z.note },
                  { type: 'image', source: { type: 'base64', media_type: z.mime, data: z.data } },
                ],
              });
            } catch (err) {
              results.push({ type: 'tool_result', tool_use_id: block.id, content: `확대 실패: ${err.message}`, is_error: true });
            }
          }
        }
        messages.push({ role: 'user', content: results });
      }
      res = await api.beta.messages.create({ ...params, messages });
    }
  } catch (e) {
    // 검색 도구를 못 쓰는 경우엔 검색 없이 한 번 더
    if (e instanceof Anthropic.BadRequestError && /tool|web_search/i.test(e.message)) {
      const { tools: _t, ...noTools } = params;
      try {
        res = await api.beta.messages.create({ ...noTools, messages: messages.slice(0, history.slice(-8).length + 1) });
      } catch (e2) {
        throw new Error(friendlyError(e2));
      }
    } else throw new Error(friendlyError(e));
  }

  if (res.stop_reason === 'refusal') {
    return { text: '그건 내가 대답하기 어려운 질문이야. 다른 걸 물어봐 줄래?', sources: [], model: res.model };
  }

  const texts = [];
  const sources = [];
  for (const block of res.content) {
    if (block.type !== 'text') continue;
    texts.push(block.text);
    for (const c of block.citations || []) {
      if (c.url && /^https?:\/\//.test(c.url) && !sources.some((s) => s.url === c.url)) {
        sources.push({ title: (c.title || '출처').slice(0, 30), url: c.url });
      }
    }
  }
  const text = tidy(texts.join(''));
  return { text: text || '음… 대답을 못 만들었어. 다시 물어봐 줄래?', sources: sources.slice(0, 3), model: res.model, zooms };
}

module.exports = { ask, verifyAndSave, hasKey, clearKey, MODELS, DEFAULT_MODEL, friendlyError };
