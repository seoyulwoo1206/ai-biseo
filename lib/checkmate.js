// 체크메이트(Supabase) 서버에서 내 일정과 할 일을 읽어 온다. 읽기만 한다.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { createClient } = require('@supabase/supabase-js');

const CONFIG_FILE = path.join(__dirname, '..', 'checkmate.config.json');

// 로그인 정보(토큰)는 윈도우 계정으로 암호화해서 저장한다.
function sessionStorage() {
  const file = path.join(app.getPath('userData'), 'checkmate-session.bin');
  const read = () => {
    try {
      const raw = fs.readFileSync(file);
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  const write = (obj) => {
    const text = JSON.stringify(obj);
    fs.writeFileSync(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text);
  };
  return {
    getItem: (k) => (k in read() ? read()[k] : null),
    setItem: (k, v) => write({ ...read(), [k]: v }),
    removeItem: (k) => {
      const obj = read();
      delete obj[k];
      write(obj);
    },
  };
}

let sb = null;

function client() {
  if (sb) return sb;
  const { url, key } = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  sb = createClient(url, key, {
    auth: { storage: sessionStorage(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return sb;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function currentUser() {
  const { data } = await client().auth.getSession();
  return data.session ? data.session.user : null;
}

async function signIn(email, password) {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return;
  if (/Invalid login credentials/i.test(error.message)) throw new Error('이메일이나 비밀번호가 맞지 않아요.');
  throw new Error(error.message);
}

async function signOut() {
  await client().auth.signOut();
}

// 오늘의 일정(시간 있는 것/없는 것)과 할 일을 가져온다.
async function fetchToday() {
  const user = await currentUser();
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
    .map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start_time ? e.start_time.slice(0, 5) : null,
      end: e.end_time ? e.end_time.slice(0, 5) : null,
    }))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  // 목표 색: '#RRGGBB' 또는 'linear-gradient(...)'
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

  // D-day: 고정한 것 먼저, 그다음 가까운 것
  const dDays = (dd && !dd.error ? dd.data || [] : [])
    .map((d) => {
      const days = Math.round((new Date(d.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
      return { title: d.title, emoji: d.emoji || '🎯', date: d.date, days, pinned: !!d.pinned };
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.days - b.days)
    .slice(0, 3);

  // 할 일을 새로 넣을 수 있는 목표 (보관한 목표는 빼고)
  const activeGoals = (gl.data || []).filter((g) => !g.archived_at).map((g) => ({ id: g.id, name: g.name, color: g.color }));

  return { date: today, events, todos, dDays, goals: activeGoals };
}

// ---------- 할 일 고치기 (말풍선에서) ----------
// 체크메이트 앱과 똑같이: 완료 시각(done_at)은 서버가 알아서 채우고,
// 다른 날로 옮기면 알림 시각도 그날 같은 시간으로 옮긴다.
async function mine(id) {
  const user = await currentUser();
  if (!user) throw new Error('체크메이트에 로그인해 줘.');
  const { data, error } = await client().from('todos').select('id,user_id,date,remind_at,title').eq('id', id).single();
  if (error || !data || data.user_id !== user.id) throw new Error('그 할 일을 찾을 수 없어.');
  return data;
}

function check(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function setTodoDone(id, done) {
  await mine(id);
  check(await client().from('todos').update({ done: !!done }).eq('id', id));
}

async function renameTodo(id, title) {
  title = String(title || '').trim().slice(0, 100);
  if (!title) throw new Error('할 일 이름이 비어 있어.');
  await mine(id);
  check(await client().from('todos').update({ title }).eq('id', id));
}

async function moveTodo(id, toDate) {
  const t = await mine(id);
  let remind = null;
  if (t.remind_at) {
    const old = new Date(t.remind_at);
    const hh = String(old.getHours()).padStart(2, '0');
    const mm = String(old.getMinutes()).padStart(2, '0');
    const d = new Date(`${toDate}T${hh}:${mm}:00`);
    remind = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  check(await client().from('todos').update({ date: toDate, remind_at: remind }).eq('id', id));
}

async function deleteTodo(id) {
  await mine(id);
  check(await client().from('todos').delete().eq('id', id));
}

// 할 일 추가: 목표를 안 고르면 첫 번째 목표에. 순서(position)는 서버가 맨 아래로 정한다.
async function addTodo(title, { goalId, date, remindAt } = {}) {
  const user = await currentUser();
  if (!user) throw new Error('체크메이트에 로그인해 줘.');
  title = String(title || '').trim().slice(0, 100);
  if (!title) throw new Error('할 일 이름이 비어 있어.');
  const goals = check(
    await client().from('goals').select('id,name,archived_at').eq('user_id', user.id).order('sort_order').order('created_at'),
  ).filter((g) => !g.archived_at);
  if (!goals.length) throw new Error('체크메이트에 목표가 하나도 없어. 체크메이트에서 목표를 먼저 만들어 줘.');
  const goal = goals.find((g) => g.id === goalId) || goals[0];
  const row = check(
    await client()
      .from('todos')
      .insert({ user_id: user.id, goal_id: goal.id, date: date || dateKey(), title, ...(remindAt ? { remind_at: new Date(remindAt).toISOString() } : {}) })
      .select('id,title,date')
      .single(),
  );
  return { ...row, goal: goal.name };
}

module.exports = { signIn, signOut, currentUser, fetchToday, dateKey, setTodoDone, renameTodo, moveTodo, deleteTodo, addTodo };
