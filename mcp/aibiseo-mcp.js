#!/usr/bin/env node
// AI 비서 MCP 서버 — Claude 데스크톱 같은 AI 앱이 비서를 도구로 쓰게 해 준다.
// 표준 입출력(stdio)으로 MCP(JSON-RPC 2.0, 한 줄에 메시지 하나)를 주고받고,
// 실제 일은 켜져 있는 비서(lib/bridge.js, 127.0.0.1)에게 맡긴다. 외부 패키지 없이 node 만 있으면 된다.
//
// 바꿀 수 있는 것: AIBISEO_BRIDGE=bridge.json 경로 (기본: 비서 userData 폴더)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');

const VERSION = '1.0.0';

function bridgeFile() {
  if (process.env.AIBISEO_BRIDGE) return process.env.AIBISEO_BRIDGE;
  const home = os.homedir();
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'ai-assistant', 'bridge.json');
}

const OFF = 'AI 비서가 꺼져 있어서 연결할 수 없어요. 바탕화면의 AI 비서를 켜고 다시 시도해 주세요.';

// ---------- 도구 목록 ----------
const TOOLS = [
  {
    name: 'get_today',
    title: '오늘 일정·할 일 보기',
    description:
      "Read the user's day from their AI 비서 (desktop assistant linked to the 체크메이트 planner): today's schedule, to-dos with ids and done state, goals, D-days, the running focus/timer, upcoming alarms and reminders (with ids), the default focus length, and the character level. Call this first when planning the user's day or before changing a to-do.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_todo',
    title: '할 일 추가',
    description:
      "Add a to-do to the user's 체크메이트 planner. Use the goal name exactly as listed by get_today if the user names one; otherwise leave it out and the first goal is used.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'To-do text, up to 100 characters, in the language the user uses.' },
        date: { type: 'string', description: "'today' (default), 'tomorrow', or a date as YYYY-MM-DD." },
        goal: { type: 'string', description: 'Goal name from get_today (optional).' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_todo',
    title: '할 일 고치기',
    description: 'Change one of today\'s to-dos by id (from get_today): mark done or not done, rename, move to tomorrow, or delete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'To-do id from get_today.' },
        action: { type: 'string', enum: ['done', 'undone', 'rename', 'tomorrow', 'delete'] },
        title: { type: 'string', description: 'New text, only for action "rename".' },
      },
      required: ['id', 'action'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'start_focus',
    title: '집중 타이머 시작',
    description:
      "Start a focus (pomodoro) session on the user's desktop character. Leave minutes out to use the user's chosen default length. A short break timer follows automatically. Replaces any running timer.",
    inputSchema: {
      type: 'object',
      properties: { minutes: { type: 'integer', minimum: 1, maximum: 180, description: 'Focus length in minutes (optional).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'start_timer',
    title: '타이머 시작',
    description: 'Start a plain countdown timer on the desktop character. Replaces any running timer.',
    inputSchema: {
      type: 'object',
      properties: { minutes: { type: 'integer', minimum: 1, maximum: 600 } },
      required: ['minutes'],
      additionalProperties: false,
    },
  },
  {
    name: 'stop_timer',
    title: '타이머 멈추기',
    description: 'Stop the running focus, break or plain timer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'add_reminder',
    title: '알림·알람 맞추기',
    description:
      'Make the desktop character remind the user. Give either in_minutes (from now) or at (local time "HH:MM" for the next such time, or "YYYY-MM-DD HH:MM"). Set alarm true for a loud alarm instead of a soft reminder. The assistant must be running at that time.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'What to remind about (short).' },
        in_minutes: { type: 'integer', minimum: 1, maximum: 10080 },
        at: { type: 'string', description: '"HH:MM" or "YYYY-MM-DD HH:MM", local time.' },
        alarm: { type: 'boolean', description: 'Loud alarm (true) or soft reminder (false, default).' },
      },
      required: ['what'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_reminder',
    title: '알림 지우기',
    description: 'Cancel an alarm or reminder by id (from get_today).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'show_message',
    title: '캐릭터가 말하기',
    description:
      "Show a short speech bubble from the user's desktop character, e.g. a finished plan summary or encouragement. Keep title under ~40 characters and detail under ~200.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        detail: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
];

// ---------- 비서에게 부탁하기 ----------
let clientName = '다른 AI';

function callBridge(name, args) {
  return new Promise((resolve) => {
    let info;
    try {
      info = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
    } catch {
      return resolve({ ok: false, error: OFF });
    }
    const body = JSON.stringify({ name, args, client: clientName });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: '/tool',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${info.token}` },
        timeout: 30000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          if (res.statusCode === 401) return resolve({ ok: false, error: 'AI 비서와 연결 정보가 맞지 않아요. 비서를 다시 켜 주세요.' });
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ ok: false, error: '비서의 대답을 읽지 못했어요.' });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok: false, error: OFF }));
    req.end(body);
  });
}

// ---------- MCP (JSON-RPC 2.0 over stdio) ----------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function onMessage(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      if (params && params.clientInfo && params.clientInfo.name) clientName = String(params.clientInfo.name).slice(0, 40);
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-biseo', title: 'AI 비서', version: VERSION },
        instructions:
          "Tools for the user's own desktop AI 비서 (a character assistant linked to the 체크메이트 planner). Use get_today to see their schedule and to-dos before planning; add or update to-dos, start focus timers, set reminders, or show a message bubble when the user asks. Every action also pops up on their character so they can see it.",
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(id, -32602, `Unknown tool: ${name}`);
      const r = await callBridge(name, (params && params.arguments) || {});
      if (!r || !r.ok) return reply(id, { content: [{ type: 'text', text: (r && r.error) || OFF }], isError: true });
      const text = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
      return reply(id, { content: [{ type: 'text', text }] });
    }
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    default:
      if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const list = Array.isArray(msg) ? msg : [msg];
  for (const m of list) onMessage(m).catch((e) => m.id != null && fail(m.id, -32603, e.message));
});
rl.on('close', () => process.exit(0));
