// 집중 기록: 집중이 끝나거나 멈출 때 한 줄씩 남기고, 주간 리포트를 계산한다.
// 기록 한 줄: { at: 시작 ms, min: 집중한 분, todo: 할 일 이름|null, goal: 목표(과목) 이름|null, dz: 딴짓 횟수, full: 끝까지 했는지 }
const KEEP = 600; // 최근 600번까지만 (대략 몇 달)
const MIN_MINUTES = 3; // 3분도 안 한 건 안 남긴다

function add(log, entry) {
  const list = Array.isArray(log) ? log.slice() : [];
  if (!entry || !(entry.min >= MIN_MINUTES)) return list;
  list.push({
    at: Math.round(entry.at),
    min: Math.round(entry.min),
    todo: entry.todo ? String(entry.todo).slice(0, 60) : null,
    goal: entry.goal ? String(entry.goal).slice(0, 30) : null,
    dz: entry.dz || 0,
    full: !!entry.full,
  });
  return list.slice(-KEEP);
}

// 그 주 월요일 0시
function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const DAY_MS = 86400000;

function sum(list) {
  return list.reduce((a, e) => a + e.min, 0);
}

/** 이번 주(월~일) 리포트 */
function weekReport(log, now = new Date()) {
  const list = Array.isArray(log) ? log : [];
  const ws = weekStart(now).getTime();
  const lastWs = ws - 7 * DAY_MS;
  const thisWeek = list.filter((e) => e.at >= ws && e.at < ws + 7 * DAY_MS);
  const lastWeek = list.filter((e) => e.at >= lastWs && e.at < ws);
  const byDay = Array.from({ length: 7 }, (_, i) => sum(thisWeek.filter((e) => e.at >= ws + i * DAY_MS && e.at < ws + (i + 1) * DAY_MS)));
  const goals = new Map();
  for (const e of thisWeek) {
    const k = e.goal || e.todo || '기타';
    goals.set(k, (goals.get(k) || 0) + e.min);
  }
  const byGoal = [...goals.entries()].map(([name, min]) => ({ name, min })).sort((a, b) => b.min - a.min);
  // 연속으로 집중한 날 (오늘 또는 어제부터 거슬러 올라가며)
  const days = new Set(list.map((e) => new Date(e.at).toDateString()));
  let streak = 0;
  const d = new Date(now);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return {
    from: new Date(ws),
    total: sum(thisWeek),
    lastTotal: sum(lastWeek),
    sessions: thisWeek.length,
    full: thisWeek.filter((e) => e.full).length,
    distractions: thisWeek.reduce((a, e) => a + (e.dz || 0), 0),
    lastDistractions: lastWeek.reduce((a, e) => a + (e.dz || 0), 0),
    byDay,
    byGoal,
    streak,
    today: byDay[(now.getDay() + 6) % 7],
  };
}

// 95 → "1시간 35분"
function hm(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

module.exports = { add, weekReport, weekStart, hm, MIN_MINUTES };
