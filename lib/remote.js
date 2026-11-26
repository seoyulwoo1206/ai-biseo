// 원격 연결 (PC 쪽): ChatGPT·Claude 웹/폰에서 온 부탁을 받는다.
// - 체크메이트 계정 정보(user_metadata.aibiseo_channel)에 무작위 채널 이름을 적어 두고, 그 채널을 실시간으로 듣는다.
//   원격 서버(Vercel)는 그 사람 로그인 토큰으로만 채널 이름을 알 수 있다.
// - 받은 부탁은 정해 둔 도구만 실행하고, 결과를 같은 채널로 돌려준다(ack).
const crypto = require('crypto');
const checkmate = require('./checkmate');

const ALLOWED = new Set(['get_today', 'start_focus', 'start_timer', 'stop_timer', 'add_reminder', 'cancel_reminder', 'show_message', 'refresh']);
const PER_MINUTE = 30;

let ch = null;
let channelName = null;
let state = 'off'; // off | login | connecting | on | error
let lastError = null;
let handler = null;
let onChange = () => {};
let recent = [];
let generation = 0;
let lastOpts = null; // 끊겼을 때 다시 붙으려고 기억해 둔다
let retryTimer = null;
let retries = 0;
const RETRY_MS = [5, 15, 30, 60, 120, 300].map((s) => s * 1000); // 끊기면 5초 → 15초 → … → 5분마다

// 끊겼을 때: 잠깐 기다렸다가(그 사이 저절로 다시 붙으면 그만) 처음부터 다시 연결한다
function scheduleRetry() {
  if (retryTimer || !lastOpts) return;
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (state === 'on' || state === 'off' || state === 'login' || !lastOpts) return;
    start(lastOpts).catch(() => scheduleRetry());
  }, wait);
}

function clearRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
}

function setState(s, err = null) {
  state = s;
  lastError = err;
  onChange(status());
}

function status() {
  return { state, error: lastError };
}

async function ensureChannel(sb, user) {
  const meta = (user && user.user_metadata) || {};
  if (typeof meta.aibiseo_channel === 'string' && /^[0-9a-f]{32}$/.test(meta.aibiseo_channel)) return meta.aibiseo_channel;
  const name = crypto.randomBytes(16).toString('hex');
  const { error } = await sb.auth.updateUser({ data: { aibiseo_channel: name } });
  if (error) throw new Error(error.message);
  return name;
}

async function onCmd(msg) {
  const p = (msg && msg.payload) || {};
  const reply = (body) => ch && ch.send({ type: 'broadcast', event: 'ack', payload: { id: p.id, ...body } });
  if (typeof p.id !== 'string' || !ALLOWED.has(p.name)) return reply({ ok: false, error: 'not allowed' });
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60000);
  if (recent.length >= PER_MINUTE) return reply({ ok: false, error: 'too many requests, try again in a minute' });
  recent.push(now);
  try {
    const args = p.args && typeof p.args === 'object' && !Array.isArray(p.args) ? p.args : {};
    const result = await handler(p.name, args, String(p.client || '원격 AI').slice(0, 40));
    reply({ ok: true, result });
  } catch (e) {
    reply({ ok: false, error: e.message });
  }
}

/**
 * @param {{ handle: (name, args, client) => Promise<any>, onChange?: (st) => void, channel?: string }} opts
 *   channel: 자동 테스트용 (로그인 없이 이 채널을 듣는다)
 */
async function start(opts) {
  handler = opts.handle;
  if (opts.onChange) onChange = opts.onChange;
  await stop(true);
  lastOpts = opts;
  const gen = ++generation;
  const sb = checkmate.client();
  let name = opts.channel || null;
  if (!name) {
    const user = await checkmate.currentUser().catch(() => null);
    if (!user) return setState('login');
    setState('connecting');
    try {
      const { data, error } = await sb.auth.getUser();
      if (error) throw error;
      name = await ensureChannel(sb, data && data.user);
    } catch (e) {
      setState('error', e.message);
      return scheduleRetry(); // 인터넷이 아직 안 붙었거나 로그인 토큰을 새로 받는 중일 수 있다
    }
  } else setState('connecting');
  if (gen !== generation) return; // 그 사이 다시 시작됐으면
  channelName = name;
  ch = sb.channel(`aibiseo-${name}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'cmd' }, onCmd);
  ch.subscribe((s, err) => {
    if (gen !== generation) return;
    if (s === 'SUBSCRIBED') {
      retries = 0;
      clearRetry();
      setState('on');
    } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || (s === 'CLOSED' && state !== 'off')) {
      setState('error', (err && err.message) || (s === 'CLOSED' ? 'closed' : s));
      scheduleRetry();
    }
  });
}

async function stop(quiet = false) {
  generation++;
  clearRetry();
  if (!quiet) {
    lastOpts = null; // 일부러 끈 거면 다시 붙지 않는다
    retries = 0;
  }
  if (ch) {
    try {
      await checkmate.client().removeChannel(ch);
    } catch {}
  }
  ch = null;
  channelName = null;
  if (!quiet) setState('off');
}

// 채널 이름을 새로 바꾼다 → 예전 연결은 PC 에 더는 부탁할 수 없다
async function resetChannel() {
  const sb = checkmate.client();
  const name = crypto.randomBytes(16).toString('hex');
  const { error } = await sb.auth.updateUser({ data: { aibiseo_channel: name } });
  if (error) throw new Error(error.message);
}

// 절전에서 깼을 때 등: 붙어 있지 않으면 바로 다시 연결
function nudge() {
  if (!lastOpts || state === 'on' || state === 'login') return;
  clearRetry();
  retries = 0;
  start(lastOpts).catch(() => scheduleRetry());
}

module.exports = { start, stop, status, resetChannel, nudge, _channel: () => channelName };
