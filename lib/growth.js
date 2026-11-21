// 캐릭터 키우기: 할 일을 끝내고 집중하면 경험치가 쌓이고, 레벨이 오르면 꾸미기 아이템이 생긴다.
// PC(main.js)와 폰(mobile/web/backend.js)이 같이 쓴다. 상태는 각자 설정 파일에 { xp, rewarded, accessory } 로 저장.

// 얻는 경험치
const REWARD = {
  todo: 10, // 할 일 하나 끝 (체크메이트 앱에서 끝내도 다음 새로고침 때 받음)
  focus: 20, // 집중 타이머 끝까지
  daily: 5, // 하루 첫 출석
};

// 꾸미기 아이템 (레벨 순서)
const ITEMS = [
  { id: 'ribbon', name: '리본', emoji: '🎀', level: 2 },
  { id: 'flower', name: '꽃핀', emoji: '🌸', level: 3 },
  { id: 'glasses', name: '동글 안경', emoji: '👓', level: 4 },
  { id: 'crown', name: '왕관', emoji: '👑', level: 5 },
  { id: 'star', name: '별 머리핀', emoji: '⭐', level: 6 },
  { id: 'scarf', name: '목도리', emoji: '🧣', level: 7 },
  { id: 'halo', name: '천사 링', emoji: '😇', level: 8 },
];

// 레벨 n 이 되려면 모아야 하는 총 경험치: 0, 50, 150, 300, 500, 750, 1050, 1400 …
const totalFor = (n) => 25 * n * (n - 1);

function levelOf(xp) {
  xp = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  while (totalFor(level + 1) <= xp) level++;
  const base = totalFor(level);
  return { level, xp, cur: xp - base, need: totalFor(level + 1) - base };
}

function normalize(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    xp: Math.max(0, Math.floor(Number(s.xp) || 0)),
    rewarded: Array.isArray(s.rewarded) ? s.rewarded.slice(-300) : [],
    accessory: typeof s.accessory === 'string' ? s.accessory : null,
  };
}

const unlockedAt = (level) => ITEMS.filter((i) => i.level <= level);

/**
 * 경험치 주기. 같은 key 로는 한 번만 준다 (할 일을 껐다 켰다 해도 두 번 안 받게).
 * @returns {{ state, gained, before, after, newItems }}
 */
function award(state, kind, key) {
  const s = normalize(state);
  const tag = `${kind}:${key}`;
  const amount = REWARD[kind] || 0;
  const before = levelOf(s.xp);
  if (!amount || s.rewarded.includes(tag)) return { state: s, gained: 0, before, after: before, newItems: [] };
  s.xp += amount;
  s.rewarded = [...s.rewarded, tag].slice(-300);
  const after = levelOf(s.xp);
  const newItems = ITEMS.filter((i) => i.level > before.level && i.level <= after.level);
  // 처음 얻은 아이템은 바로 달아 준다
  if (newItems.length) s.accessory = newItems[newItems.length - 1].id;
  return { state: s, gained: amount, before, after, newItems };
}

// 설정 화면에 보여 줄 정보
function view(state) {
  const s = normalize(state);
  const lv = levelOf(s.xp);
  const items = ITEMS.map((i) => ({ ...i, unlocked: i.level <= lv.level }));
  const accessory = items.some((i) => i.id === s.accessory && i.unlocked) ? s.accessory : null;
  return { ...lv, items, accessory };
}

// 달 수 있는 아이템인지 (null = 빼기)
function canWear(state, id) {
  if (id == null) return true;
  const lv = levelOf(normalize(state).xp).level;
  return ITEMS.some((i) => i.id === id && i.level <= lv);
}

module.exports = { REWARD, ITEMS, levelOf, award, view, canWear, unlockedAt, normalize };
