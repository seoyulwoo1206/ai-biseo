// 원격 MCP 서버 (Streamable HTTP, 상태 없음) — ChatGPT·Claude 웹/폰 앱의 커스텀 커넥터가 부르는 곳
// 할 일·일정은 체크메이트에 바로(PC 꺼져 있어도 됨), 집중·알림·말풍선은 켜져 있는 PC 비서에게 실시간 채널로 부탁한다.
'use strict';
const L = require('./_lib');

const VERSION = '1.1.0';
const PC_OFF = 'PC의 AI 비서가 꺼져 있거나 원격 연결이 꺼져 있어요. PC에서 비서를 켜고 (설정 → 다른 AI 앱과 연결 → 원격 연결) 다시 시도해 주세요.';

const TOOLS = [
  {
    name: 'get_today',
    title: '오늘 일정·할 일 보기',
    description:
      "Read the user's day from their AI 비서 linked to the 체크메이트 planner: today's schedule, to-dos with ids and done state, goals and D-days. If the user's PC assistant is on, also the running focus timer, reminders, school meals/timetable and this week's study time. Call this first when planning the user's day or before changing a to-do.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_todo',
    title: '할 일 추가',
    description: "Add a to-do to the user's 체크메이트 planner (works even when the PC is off). Use a goal name exactly as listed by get_today if the user names one; otherwise the first goal is used.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'To-do text, up to 100 characters, in the language the user uses.' },
        date: { type: 'string', description: "'today' (default), 'tomorrow', or YYYY-MM-DD (Korea time)." },
        goal: { type: 'string', description: 'Goal name from get_today (optional).' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_todo',
    title: '할 일 고치기',
    description: 'Change one to-do by id (from get_today): mark done or not done, rename, move to tomorrow, or delete. Works even when the PC is off.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        action: { type: 'string', enum: ['done', 'undone', 'rename', 'tomorrow', 'delete'] },
        title: { type: 'string', description: 'New text, only for rename.' },
      },
      required: ['id', 'action'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'start_focus',
    title: '집중 타이머 시작 (PC)',
    description: "Start a focus session on the user's PC desktop character (the PC assistant must be on). Leave minutes out for the user's default length. Optionally pass todo_id to log study time under that to-do's goal.",
    inputSchema: {
      type: 'object',
      properties: { minutes: { type: 'integer', minimum: 1, maximum: 180 }, todo_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'start_timer',
    title: '타이머 시작 (PC)',
    description: 'Start a plain countdown timer on the PC desktop character.',
    inputSchema: { type: 'object', properties: { minutes: { type: 'integer', minimum: 1, maximum: 600 } }, required: ['minutes'], additionalProperties: false },
  },
  {
    name: 'stop_timer',
    title: '타이머 멈추기 (PC)',
    description: 'Stop the running focus, break or plain timer on the PC.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'add_reminder',
    title: '알림·알람 맞추기 (PC)',
    description: 'Make the PC desktop character remind the user. Give in_minutes, or at as "HH:MM" (next such time) or "YYYY-MM-DD HH:MM" (Korea time). alarm=true for a loud alarm.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string' },
        in_minutes: { type: 'integer', minimum: 1, maximum: 10080 },
        at: { type: 'string' },
        alarm: { type: 'boolean' },
      },
      required: ['what'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_reminder',
    title: '알림 지우기 (PC)',
    description: 'Cancel a PC reminder or alarm by id (from get_today).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { destructiveHint: true },
  },
  {
    name: 'show_message',
    title: '캐릭터가 말하기 (PC)',
    description: "Show a short speech bubble from the user's PC desktop character, e.g. a plan summary or encouragement. Title under ~40 characters, detail under ~200.",
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title'], additionalProperties: false },
  },
];
const PC_TOOLS = new Set(['start_focus', 'start_timer', 'stop_timer', 'add_reminder', 'cancel_reminder', 'show_message']);

// ---------- 체크메이트 직접 ----------
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function dateFrom(v) {
  const s = clip(v, 20).toLowerCase();
  if (!s || s === 'today' || s === '오늘') return L.kstDate(0);
  if (s === 'tomorrow' || s === '내일') return L.kstDate(1);
  if (s === 'day_after' || s === '모레') return L.kstDate(2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'))) return s;
  throw new Error(`date must be 'today', 'tomorrow' or YYYY-MM-DD (got "${v}")`);
}

async function today(sa, uid) {
  const d = L.kstDate(0);
  const enc = encodeURIComponent;
  const [ev, td, gl, dd] = await Promise.all([
    L.sbRest(sa, 'GET', `day_events?select=id,title,start_time,end_time&user_id=eq.${enc(uid)}&date=eq.${d}`).catch(() => []),
    L.sbRest(sa, 'GET', `todos?select=id,title,done,remind_at,goal_id&user_id=eq.${enc(uid)}&date=eq.${d}&order=position`),
    L.sbRest(sa, 'GET', `goals?select=id,name,archived_at&user_id=eq.${enc(uid)}&order=sort_order,created_at`),
    L.sbRest(sa, 'GET', `d_days?select=title,date,emoji,pinned&date=gte.${d}&order=date&limit=6`).catch(() => []),
  ]);
  const goals = new Map((gl || []).map((g) => [g.id, g]));
  const hm = (t) => (t ? String(t).slice(0, 5) : null);
  return {
    now: L.kstNowText(),
    events: (ev || []).map((e) => ({ title: e.title, start: hm(e.start_time), end: hm(e.end_time) })).sort((a, b) => String(a.start || '').localeCompare(String(b.start || ''))),
    todos: (td || []).map((t) => ({ id: t.id, title: t.title, done: t.done, goal: (goals.get(t.goal_id) || {}).name || null })),
    goals: (gl || []).filter((g) => !g.archived_at).map((g) => g.name),
    d_days: (dd || []).map((x) => ({ title: x.title, date: x.date, days_left: Math.round((new Date(x.date + 'T00:00:00Z') - new Date(d + 'T00:00:00Z')) / 86400000) })),
  };
}

async function mine(sa, uid, id) {
  const rows = await L.sbRest(sa, 'GET', `todos?select=id,user_id,date,remind_at,title&id=eq.${encodeURIComponent(id)}`);
  const t = rows && rows[0];
  if (!t || t.user_id !== uid) throw new Error('no to-do with that id');
  return t;
}

async function addTodo(sa, uid, args) {
  const title = clip(args.title, 100);
  if (!title) throw new Error('title is empty');
  const date = dateFrom(args.date);
  const goals = (await L.sbRest(sa, 'GET', `goals?select=id,name,archived_at&user_id=eq.${encodeURIComponent(uid)}&order=sort_order,created_at`)).filter((g) => !g.archived_at);
  if (!goals.length) throw new Error('체크메이트에 목표가 하나도 없어요. 체크메이트에서 목표를 먼저 만들어 주세요.');
  const key = clip(args.goal, 40).replace(/\s+/g, '');
  let goal = goals[0];
  if (key) {
    goal = goals.find((g) => g.name.replace(/\s+/g, '') === key);
    if (!goal) throw new Error(`goal "${args.goal}" not found. goals: ${goals.map((g) => g.name).join(', ')}`);
  }
  const rows = await L.sbRest(sa, 'POST', 'todos?select=id,title,date', { user_id: uid, goal_id: goal.id, date, title }, 'return=representation');
  const row = rows[0];
  return { added: { id: row.id, title: row.title, date: row.date, goal: goal.name } };
}

async function updateTodo(sa, uid, args) {
  const id = clip(args.id, 64);
  const op = clip(args.action, 10);
  const t = await mine(sa, uid, id);
  const q = `todos?id=eq.${encodeURIComponent(id)}`;
  if (op === 'done' || op === 'undone') await L.sbRest(sa, 'PATCH', q, { done: op === 'done' });
  else if (op === 'rename') {
    const title = clip(args.title, 100);
    if (!title) throw new Error('title is required for rename');
    await L.sbRest(sa, 'PATCH', q, { title });
  } else if (op === 'tomorrow') {
    const to = L.kstDate(1);
    let remind = null;
    if (t.remind_at) {
      // 알림 시각도 같은 시각(한국 시간) 그대로 다음 날로
      const old = new Date(new Date(t.remind_at).getTime() + 9 * 3600000);
      remind = new Date(`${to}T${old.toISOString().slice(11, 16)}:00+09:00`).toISOString();
    }
    await L.sbRest(sa, 'PATCH', q, { date: to, remind_at: remind });
  } else if (op === 'delete') await L.sbRest(sa, 'DELETE', q);
  else throw new Error('unknown action');
  return { ok: true, id, action: op, title: t.title };
}

// ---------- MCP ----------
function unauthorized(res, base, desc) {
  L.json(
    res,
    401,
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
    { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${desc}"` },
  );
}

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.end();
  const base = L.baseUrl(req);
  if (req.method !== 'POST') return L.json(res, 405, { error: 'POST JSON-RPC only' }, { Allow: 'POST' });

  const auth = String(req.headers.authorization || '');
  const tok = auth.startsWith('Bearer ') ? L.open(auth.slice(7), 'at') : null;
  if (!tok) return unauthorized(res, base, auth ? 'token expired or invalid' : 'login required');

  const body = await L.readBody(req);
  const batch = Array.isArray(body) ? body : [body];
  let userCache = null;
  const channel = async () => {
    if (!userCache) userCache = (await L.sbUser(tok.sa)) || {};
    return userCache.user_metadata && userCache.user_metadata.aibiseo_channel;
  };
  let clientName = tok.n || '원격 AI';

  const handle = async (msg) => {
    const { id, method, params } = msg || {};
    const isReq = id !== undefined && id !== null;
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'initialize':
        if (params && params.clientInfo && params.clientInfo.name) clientName = String(params.clientInfo.name).slice(0, 40);
        return ok({
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ai-biseo-remote', title: 'AI 비서', version: VERSION },
          instructions:
            "Tools for the user's own AI 비서 (a desktop character assistant linked to the 체크메이트 planner). To-dos work any time; focus timers, reminders and speech bubbles run on the user's PC and need it to be on. Call get_today before planning.",
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'tools/call': {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
        const text = (v) => ok({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
        const err = (m) => ok({ content: [{ type: 'text', text: m }], isError: true });
        try {
          if (name === 'get_today') {
            const pc = await L.askPc(await channel(), 'get_today', {}, clientName, 4000);
            if (pc && pc.ok) return text({ pc_assistant: 'online', ...pc.result });
            const t = await today(tok.sa, tok.uid);
            return text({ pc_assistant: 'offline — focus timers, reminders and messages need the PC assistant on', ...t });
          }
          if (name === 'add_todo') {
            const r = await addTodo(tok.sa, tok.uid, args);
            L.askPc(await channel(), 'refresh', {}, clientName, 2500); // PC 가 켜져 있으면 바로 다시 읽게 (기다리지 않음)
            return text(r);
          }
          if (name === 'update_todo') {
            const r = await updateTodo(tok.sa, tok.uid, args);
            L.askPc(await channel(), 'refresh', {}, clientName, 2500);
            return text(r);
          }
          if (PC_TOOLS.has(name)) {
            const ch = await channel();
            if (!ch) return err(PC_OFF);
            const r = await L.askPc(ch, name, args, clientName);
            if (r.offline) return err(PC_OFF);
            return r.ok ? text(r.result) : err(r.error || 'PC 비서가 거절했어요');
          }
          return fail(-32602, 'unsupported');
        } catch (e) {
          return err(e.message);
        }
      }
      case 'resources/list':
        return ok({ resources: [] });
      case 'prompts/list':
        return ok({ prompts: [] });
      default:
        return isReq ? fail(-32601, `Method not found: ${method}`) : null;
    }
  };

  const out = (await Promise.all(batch.map(handle))).filter(Boolean);
  if (!out.length) {
    res.statusCode = 202;
    return res.end();
  }
  return L.json(res, 200, Array.isArray(body) ? out : out[0]);
};
