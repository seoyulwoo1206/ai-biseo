import { createCharacter3D } from './char3d.js';
import { renderCard } from './cards.js';

const api = window.assistant;
const stage = document.getElementById('stage');
const canvas = document.getElementById('char3d');
const img = document.getElementById('charImg');
const bubble = document.getElementById('bubble');
const emotes = document.getElementById('emotes');

const char3d = createCharacter3D(canvas);
let mode = '3d';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ======================================================================
// 창 모양: 캐릭터·말풍선·이모티콘 부분만 남기고 잘라 낸다.
// 잘린 투명한 부분은 마우스·터치·펜이 뒤쪽 창으로 통과한다.
// ======================================================================
let emoteCount = 0;

function updateShape() {
  const s = stage.getBoundingClientRect();
  const rects = [];
  const b = mode === '3d' ? char3d.bounds(0) : null;
  if (b) {
    const x = Math.max(0, b.x);
    const y = b.y; // 위로는 무대 밖(말풍선 쪽)까지 허용
    rects.push({
      x: s.left + x,
      y: Math.max(0, s.top + y),
      width: Math.min(s.width, b.x + b.width) - x,
      height: Math.min(s.height, b.y + b.height) - y + Math.min(0, s.top + y),
    });
  } else {
    rects.push({ x: s.left, y: s.top, width: s.width, height: s.height });
  }
  // 이모티콘·한마디(사랑해, 부끄…)가 떠 있는 동안은 캐릭터 둘레를 넉넉히 보이게
  // (안 그러면 캐릭터 영역 밖으로 나간 글자가 잘려 보인다)
  if (emoteCount) {
    const top = Math.max(0, s.top - 100);
    rects.push({ x: Math.max(0, s.left - 40), y: top, width: s.width + 80, height: s.bottom - top });
  }
  if (!bubble.classList.contains('hidden')) {
    // 커지는 애니메이션 중이라도 "다 커졌을 때" 크기로 잡고, 그림자·통통 튀는 여유를 둔다
    const pad = 16;
    const x = Math.max(0, bubble.offsetLeft - pad);
    const y = Math.max(0, bubble.offsetTop - pad);
    rects.push({ x, y, width: bubble.offsetWidth + pad * 2, height: bubble.offsetHeight + pad + 14 });
  }
  const pill = document.getElementById('timerPill');
  if (pill && !pill.classList.contains('off')) {
    const r = pill.getBoundingClientRect();
    rects.push({ x: r.left - 2, y: r.top - 2, width: r.width + 4, height: r.height + 4 });
  }
  api.setShape(rects);
}
window.addEventListener('resize', updateShape);

// ======================================================================
// 머리 위 이모티콘
// ======================================================================
function emote(text, { cls = '', dx = 0, delay = 0, size } = {}) {
  if (mode !== '3d') return;
  setTimeout(() => {
    const h = char3d.headPx();
    const el = document.createElement('span');
    el.className = 'emote ' + cls;
    el.textContent = text;
    el.style.left = `${h.x + dx}px`;
    el.style.top = `${h.y - 10}px`;
    el.style.setProperty('--dx', `${rand(-14, 14)}px`);
    if (size) el.style.fontSize = `${size}px`;
    emotes.append(el);
    if (++emoteCount === 1) updateShape();
    el.addEventListener('animationend', () => {
      el.remove();
      if (--emoteCount === 0) updateShape();
    });
  }, delay);
}

// 머리 옆에 작게 뜨는 한마디
function say(text, delay = 0) {
  emote(text, { cls: 'talk', dx: 34, delay });
}

function burst(list, n = 3, spread = 30) {
  for (let i = 0; i < n; i++) emote(pick(list), { dx: rand(-spread, spread), delay: i * 140 });
}

// ======================================================================
// 리액션 모음
// ======================================================================
const react = {
  tap() {
    char3d.squish();
    char3d.express('happy', 1.2);
    pick([() => emote('✨', { cls: 'pop', dx: 22 }), () => emote('💕', { cls: 'pop', dx: -22 }), () => char3d.hop(0.3), () => {}])();
  },
  love() {
    char3d.express('love', 2.4);
    char3d.blush(3);
    char3d.squish();
    setTimeout(() => char3d.hop(0.3), 250);
    burst(['💕', '💗', '💖'], 4, 34);
  },
  surprise() {
    char3d.express('surprise', 0.9);
    char3d.jolt();
    char3d.hop(0.25);
    emote('❗', { cls: 'pop', dx: 26 });
  },
  dizzy() {
    char3d.express('dizzy', 2.4);
    char3d.wobble(2.4);
    emote('💫', { cls: 'pop', dx: 0, size: 26 });
    emote('💫', { dx: 20, delay: 600 });
  },
  wake() {
    char3d.setSleeping(false);
    char3d.express('surprise', 0.8);
    char3d.jolt();
    setTimeout(() => {
      char3d.hop(0.35);
      char3d.stretch();
    }, 300);
    emote('❗', { cls: 'pop', dx: 24 });
  },
  dropped() {
    char3d.squish();
    char3d.express('squeeze', 0.5);
  },
  say(tone) {
    if (tone === 'alert') {
      char3d.express('surprise', 0.7);
      char3d.hop(0.6);
      setTimeout(() => char3d.hop(0.45), 800);
      setTimeout(() => char3d.wave(), 300);
      emote('⏰', { cls: 'pop', dx: 26, size: 26 });
      emote('❗', { cls: 'pop', dx: -24, delay: 250 });
    } else if (tone === 'happy') {
      char3d.express('happy', 2.2);
      pick([() => char3d.spin(), () => char3d.dance(2)])();
      burst(['✨', '🎉', '⭐'], 3, 34);
    } else if (tone === 'sad') {
      char3d.express('sad', 3);
      char3d.shake();
      emote('💧', { dx: 26 });
    } else {
      char3d.express('happy', 1.4);
      char3d.hop(0.45);
      char3d.wave();
      emote('💬', { cls: 'pop', dx: 26 });
    }
  },
};

// 꾹 누르면 하는 애교 (누르고 있으면 계속 이어서)
const AEGYO = [
  () => {
    char3d.wiggle(1.6);
    char3d.express('love', 1.8);
    char3d.blush(2.5);
    say('뿌잉뿌잉');
    emote('💕', { dx: -26, delay: 300 });
  },
  () => {
    char3d.express('wink', 1.4);
    char3d.tilt();
    char3d.hop(0.25);
    emote('✨', { cls: 'pop', dx: 26, delay: 150 });
    say('찡긋☆', 200);
  },
  () => {
    char3d.shy(2.2);
    char3d.express('shy', 2.2);
    char3d.blush(3);
    say('부끄…');
    emote('💗', { dx: 24, delay: 500 });
  },
  () => {
    char3d.cheer(1.8);
    char3d.express('happy', 1.8);
    say('사랑해!');
    burst(['💖', '💕', '💗'], 4, 36);
  },
  () => {
    char3d.express('kiss', 1.4);
    char3d.tilt();
    say('쪽♡');
    emote('💋', { cls: 'pop', dx: 26, delay: 250 });
    emote('💕', { dx: 30, delay: 650 });
  },
  () => {
    char3d.roll();
    char3d.express('happy', 1.4);
    say('데굴데굴', 100);
  },
  () => {
    char3d.punch(1.4);
    char3d.express('squeeze', 1.4);
    say('콩콩콩!');
    emote('💥', { cls: 'pop', dx: 28, delay: 300 });
  },
  () => {
    char3d.spin();
    char3d.express('happy', 1.4);
    say('짜잔~', 300);
    emote('⭐', { cls: 'pop', dx: -26, delay: 500 });
  },
];
let aegyoOrder = [];
function doAegyo() {
  if (!aegyoOrder.length) aegyoOrder = AEGYO.map((_, i) => i).sort(() => Math.random() - 0.5);
  AEGYO[aegyoOrder.pop()]();
}

// 가만히 있을 때 가끔 하는 행동
const IDLE = [
  [3, () => char3d.tilt()],
  [3, () => char3d.ears()],
  [3, () => char3d.lookAround()],
  [2, () => { char3d.stretch(); }],
  [2, () => { char3d.hop(0.3); char3d.express('happy', 0.8); }],
  [2, () => { char3d.dance(2.6); char3d.express('happy', 2.6); emote('♪', { dx: 26 }); emote('♫', { dx: -24, delay: 700 }); emote('♪', { dx: 20, delay: 1400 }); }],
  [1, () => { char3d.spin(); emote('✨', { cls: 'pop', dx: 24, delay: 500 }); }],
  [2, () => char3d.nod()],
  [1, () => { char3d.express('happy', 1.2); emote(pick(['🌸', '⭐', '🍀', '☁️']), { dx: 24 }); }],
];
const IDLE_TOTAL = IDLE.reduce((s, [w]) => s + w, 0);

function doIdle() {
  let r = Math.random() * IDLE_TOTAL;
  for (const [w, fn] of IDLE) {
    r -= w;
    if (r <= 0) return fn();
  }
}

// ======================================================================
// 상태: 잠들기 / 깨기 / 쓰다듬기 / 깜짝
// ======================================================================
const SLEEP_AFTER_MS = 60 * 1000;
let lastActive = performance.now();
let sleeping = false;
let zTimer = null;
let nextIdle = performance.now() + rand(4000, 8000);
let bubbleOpen = false;

function setSleeping(v) {
  if (sleeping === v) return;
  sleeping = v;
  clearInterval(zTimer);
  if (v) {
    char3d.setSleeping(true);
    const z = () => emote(pick(['z', 'Z']), { cls: 'z', dx: 18 });
    z();
    zTimer = setInterval(z, 1500);
  } else {
    react.wake();
  }
}

window.__perfSleep = () => setSleeping(true); // 속도 재기(AI_PERFTEST)용

function activity() {
  lastActive = performance.now();
  if (sleeping) setSleeping(false);
}

setInterval(() => {
  const t = performance.now();
  if (dragging || mode !== '3d') return;
  if (!sleeping && t - lastActive > SLEEP_AFTER_MS && !bubbleOpen) setSleeping(true);
  if (!sleeping && t > nextIdle) {
    nextIdle = t + rand(5000, 11000);
    if (!bubbleOpen) doIdle();
  }
}, 500);

// 커서 움직임으로 쓰다듬기·깜짝 판단
let prevCursor = null;
let pet = { dir: 0, flips: 0, since: 0 };
let petCooldown = 0;
let startleCooldown = 0;

function onCursor(x, y, touch = false) {
  const r = stage.getBoundingClientRect();
  const px = x - r.left;
  const py = y - r.top;
  char3d.lookAt(px, py, touch);

  const t = performance.now();
  if (prevCursor && (prevCursor.x !== x || prevCursor.y !== y)) {
    activity();
    const dt = Math.max(1, t - prevCursor.t);
    const dx = x - prevCursor.x;
    const speed = Math.hypot(dx, y - prevCursor.y) / (dt / 1000);
    const over = mode === '3d' && char3d.hitTest(px, py);
    stage.classList.toggle('hover', over);

    // 캐릭터 위에서 좌우로 문지르면 쓰다듬기
    if (over && !dragging && Math.abs(dx) > 2) {
      const d = Math.sign(dx);
      if (t - pet.since > 1500) pet = { dir: d, flips: 0, since: t };
      else if (d !== pet.dir) {
        pet.dir = d;
        pet.flips++;
      }
      if (pet.flips >= 4 && t > petCooldown) {
        petCooldown = t + 3000;
        pet = { dir: 0, flips: 0, since: 0 };
        react.love();
      }
    }

    // 커서가 아주 빠르게 휙 지나가면 깜짝
    const near = Math.hypot(px - r.width / 2, py - r.height / 2) < 150;
    if (near && !over && speed > 4000 && t > startleCooldown && !dragging) {
      startleCooldown = t + 9000;
      react.surprise();
    }
  }
  prevCursor = { x, y, t };
}

// 메인 프로세스가 화면 전체의 커서 위치를 보내 준다 (창 밖에 있어도 눈으로 따라감).
// 손가락·펜으로 만지는 동안은 시스템 커서 위치가 늦거나 안 바뀌어서, 화면이 받은 터치 위치를 바로 쓴다.
let touchLookAt = 0;
api.onCursor(({ x, y }) => {
  if (performance.now() - touchLookAt < 1200) return;
  onCursor(x, y);
});
function touchLook(e) {
  if (e.pointerType === 'mouse') return;
  touchLookAt = performance.now();
  onCursor(e.clientX, e.clientY, true);
}
window.addEventListener('pointerdown', touchLook, true);
window.addEventListener('pointermove', touchLook, true);

// ======================================================================
// 누르기 / 끌기 (마우스·터치·펜 모두)
// ======================================================================
let dragging = false;
let moved = false;
let pointerType = 'mouse';
let startX = 0;
let startY = 0;
let grabX = 0;
let grabY = 0;
let shake = { lastX: 0, dir: 0, flips: 0 };
let pressTimer = null;
let aegyoTimer = null;
let longPressed = false;

const LONG_PRESS_MS = 450;

function stopPress() {
  clearTimeout(pressTimer);
  clearInterval(aegyoTimer);
  pressTimer = null;
  aegyoTimer = null;
}

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  activity();
  dragging = true;
  moved = false;
  longPressed = false;
  pointerType = e.pointerType || 'mouse';
  startX = e.screenX;
  startY = e.screenY;
  grabX = e.clientX;
  grabY = e.clientY;
  shake = { lastX: e.screenX, dir: 0, flips: 0 };
  stage.setPointerCapture(e.pointerId);
  api.dragStart(pointerType);

  // 꾹 누르기 → 애교, 계속 누르고 있으면 다음 애교
  stopPress();
  pressTimer = setTimeout(() => {
    if (!dragging || moved) return;
    longPressed = true;
    char3d.squish();
    doAegyo();
    aegyoTimer = setInterval(() => {
      if (dragging && !moved) doAegyo();
    }, 2300);
  }, LONG_PRESS_MS);
});

stage.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startX;
  const dy = e.screenY - startY;
  // 손가락은 살짝 흔들리므로 터치일 때는 조금 더 움직여야 끌기로 본다.
  const slop = pointerType === 'mouse' ? 4 : 9;
  if (!moved && Math.hypot(e.clientX - grabX, e.clientY - grabY) < slop && Math.abs(dx) + Math.abs(dy) < slop) return;
  if (!moved) {
    stopPress();
    char3d.setHeld(true);
    document.body.classList.add('grab');
  }
  moved = true;

  if (pointerType === 'mouse') {
    // 마우스는 메인 프로세스가 실제 커서 위치를 읽어서 옮긴다 (가장 정확)
    api.dragMove(dx, dy);
  } else {
    // 손가락·펜: "지금 손가락이 잡은 자리에서 얼마나 벗어났나"만 보내면
    // 창이 그만큼 따라가서 손가락 밑으로 다시 온다. (창 위치가 늦게 반영돼도 스스로 맞춰짐)
    touchDrag(e);
  }

  // 들고 흔들었는지 (좌우 방향이 여러 번 바뀜)
  const step = e.screenX - shake.lastX;
  if (Math.abs(step) > 6) {
    const d = Math.sign(step);
    if (shake.dir && d !== shake.dir) shake.flips++;
    shake.dir = d;
    shake.lastX = e.screenX;
  }
});

// 손가락 끌기: 창 이동이 끝났다는 답을 받은 뒤에 생긴 터치만 쓴다.
// (그 전 터치는 옮기기 전 창 기준이라 쓰면 창이 튄다)
let touchBusy = false;
let touchReadyAt = 0;
function touchDrag(e) {
  if (touchBusy || e.timeStamp < touchReadyAt) return;
  const dx = e.clientX - grabX;
  const dy = e.clientY - grabY;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  touchBusy = true;
  api.dragBy(dx, dy).finally(() => {
    touchBusy = false;
    touchReadyAt = performance.now();
  });
}

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  stopPress();
  document.body.classList.remove('grab');
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  api.dragEnd();
  if (moved) {
    char3d.setHeld(false);
    if (shake.flips >= 4) react.dizzy();
    else react.dropped();
    requestAnimationFrame(updateShape);
  } else if (longPressed) {
    // 애교를 부렸으면 설정 창은 열지 않는다
  } else if (e.type === 'pointerup') {
    react.tap();
    api.clicked();
  }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // 터치를 길게 누르면 생기는 메뉴는 무시 (설정 창으로 충분)
  if (e.pointerType === 'touch' || dragging) return;
  api.showMenu();
});

// ======================================================================
// 말풍선 카드
// ======================================================================
let hideTimer = null;
let currentCard = null;

let cardExpanded = false;

function drawCard(card, seconds, expanded = false) {
  cardExpanded = expanded;
  renderCard(bubble, card, { seconds, expanded, onMore: expandCard, onAction: cardAction, onTodo: openTodoMenu, onAdd: openAddForm, onClose: closeCard });
}

// ---------- 할 일 추가 (카드 맨 아래 '＋ 할 일 추가') ----------
let addGoalId = null; // 마지막으로 고른 목표를 기억

function openAddForm(sec, addBtn, goals) {
  closeTodoMenu();
  holdBubble();
  activity();
  if (!goals.some((g) => g.id === addGoalId)) addGoalId = goals[0].id;
  const form = document.createElement('div');
  form.className = 't-addform';
  form.addEventListener('click', (e) => e.stopPropagation());

  const input = document.createElement('input');
  input.className = 't-medit';
  input.placeholder = '할 일 적고 Enter';
  input.maxLength = 100;

  const chips = document.createElement('div');
  chips.className = 't-goals';
  const paint = () => {
    chips.replaceChildren(
      ...goals.map((g) => {
        const c = document.createElement('button');
        c.className = 't-goal' + (g.id === addGoalId ? ' on' : '');
        const m = (g.color || '').match(/#[0-9a-fA-F]{6}/);
        c.style.setProperty('--goal', m ? m[0] : '#a3a9bd');
        c.textContent = g.name;
        c.addEventListener('click', () => {
          addGoalId = g.id;
          paint();
          input.focus();
        });
        return c;
      }),
    );
  };
  paint();

  const msg = document.createElement('div');
  msg.className = 't-menu-msg';

  let busy = false;
  const save = async () => {
    const title = input.value.trim();
    if (!title || busy) return;
    busy = true;
    form.classList.add('busy');
    const r = await api.todoAdd(title, addGoalId);
    busy = false;
    form.classList.remove('busy');
    if (!r.ok) {
      msg.textContent = r.message;
      return;
    }
    currentCard = r.card;
    drawCard(r.card, 25, cardExpanded);
    releaseBubble();
    holdBubble();
    char3d.squish();
    emote('✍️', { cls: 'pop', dx: 26 });
    emote(r.message, { cls: 'talk', dx: 34 });
    // 이어서 또 적을 수 있게 다시 연다
    const newSec = [...bubble.querySelectorAll('.t-sec')].pop();
    const newBtn = bubble.querySelector('.t-add');
    if (newSec && newBtn) openAddForm(newSec, newBtn, r.card.goals || goals);
    requestAnimationFrame(updateShape);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) save();
    if (e.key === 'Escape') {
      form.remove();
      addBtn.style.display = '';
      releaseBubble();
      requestAnimationFrame(updateShape);
    }
  });

  const row = document.createElement('div');
  row.className = 't-addrow';
  const ok = document.createElement('button');
  ok.className = 't-mbtn primary';
  ok.textContent = '추가';
  ok.addEventListener('click', save);
  row.append(input, ok);
  form.append(row, chips, msg);

  addBtn.style.display = 'none';
  sec.append(form);
  requestAnimationFrame(() => {
    input.focus();
    updateShape();
    form.scrollIntoView({ block: 'nearest' });
  });
}

// ---------- 할 일 누르면: 완료 · 수정 · 내일로 · 삭제 ----------
let todoBusy = false;

function closeTodoMenu() {
  bubble.querySelectorAll('.t-menu').forEach((m) => m.remove());
  bubble.querySelectorAll('.t-todo.picked').forEach((r) => r.classList.remove('picked'));
}

function holdBubble() {
  // 고르는 동안은 말풍선이 닫히지 않게
  clearTimeout(hideTimer);
  bubble.classList.add('paused');
}

function releaseBubble() {
  bubble.classList.remove('paused');
  showFor(14);
}

async function runTodo(t, op, title) {
  if (todoBusy) return;
  todoBusy = true;
  const menu = bubble.querySelector('.t-menu');
  if (menu) menu.classList.add('busy');
  const r = await api.todoAction(t.id, op, title);
  todoBusy = false;
  if (!r.ok) {
    if (menu) {
      menu.classList.remove('busy');
      const err = menu.querySelector('.t-menu-msg') || menu.appendChild(Object.assign(document.createElement('div'), { className: 't-menu-msg' }));
      err.textContent = r.message;
    }
    return;
  }
  currentCard = r.card;
  drawCard(r.card, 20, cardExpanded);
  bubble.classList.remove('hidden');
  releaseBubble();
  if (op === 'done') {
    char3d.squish();
    emote('✅', { cls: 'pop', dx: 26 });
  }
  emote(r.message, { cls: 'talk', dx: 34 });
  requestAnimationFrame(updateShape);
}

function openTodoMenu(t, row) {
  const wasOpen = row.classList.contains('picked');
  closeTodoMenu();
  if (wasOpen) {
    releaseBubble();
    requestAnimationFrame(updateShape);
    return;
  }
  holdBubble();
  activity();
  row.classList.add('picked');
  const menu = document.createElement('div');
  menu.className = 't-menu';
  menu.addEventListener('click', (e) => e.stopPropagation());
  const btn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 't-mbtn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  const showButtons = () => {
    menu.replaceChildren(
      t.done ? btn('↩️ 완료 취소', '', () => runTodo(t, 'undone')) : btn('✅ 완료', 'primary', () => runTodo(t, 'done')),
      btn('✏️ 수정', '', showEdit),
      btn('➡️ 내일로', '', () => runTodo(t, 'tomorrow')),
      btn('🗑️', 'danger', showDelete),
    );
  };
  const showEdit = () => {
    const input = document.createElement('input');
    input.className = 't-medit';
    input.value = t.title;
    input.maxLength = 100;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') showButtons();
    });
    const save = () => {
      const v = input.value.trim();
      if (v && v !== t.title) runTodo(t, 'rename', v);
      else showButtons();
    };
    menu.replaceChildren(input, btn('저장', 'primary', save), btn('취소', '', showButtons));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
      updateShape();
    });
  };
  const showDelete = () => {
    const q = document.createElement('span');
    q.className = 't-mq';
    q.textContent = '정말 지울까?';
    menu.replaceChildren(q, btn('지우기', 'danger solid', () => runTodo(t, 'delete')), btn('아니', '', showButtons));
  };
  showButtons();
  row.after(menu);
  requestAnimationFrame(updateShape);
}

function cardAction(id) {
  stopRing();
  api.cardAction(id);
  hideBubble();
}

// ---------- 알람 소리 (WebAudio 로 만든 딩동 소리) ----------
let audio = null;
let ringTimer = null;

function chime(loud) {
  audio = audio || new AudioContext();
  const t0 = audio.currentTime;
  const notes = loud ? [988, 1319, 988, 1319] : [784, 1047];
  notes.forEach((f, i) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = t0 + i * 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(loud ? 0.35 : 0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
}

function startRing(kind, seconds) {
  stopRing();
  const loud = kind === 'loud';
  chime(loud);
  if (!loud) return; // 예약 알림은 한 번만
  const until = Date.now() + Math.min(seconds, 60) * 1000;
  ringTimer = setInterval(() => {
    if (Date.now() > until) return stopRing();
    chime(true);
    char3d.hop(0.5);
  }, 1600);
}

function stopRing() {
  clearInterval(ringTimer);
  ringTimer = null;
}

function showFor(seconds) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, seconds * 1000);
}

// 전체 목록을 펼치고, 읽을 시간을 조금 더 준다 (마우스를 올려 두면 안 닫힘)
function expandCard() {
  if (!currentCard) return;
  const seconds = 28;
  drawCard(currentCard, seconds, true);
  bubble.classList.remove('hidden');
  showFor(seconds);
  requestAnimationFrame(updateShape);
  activity();
}

function hideBubble() {
  stopRing();
  clearTimeout(hideTimer);
  bubble.classList.add('hidden');
  bubbleOpen = false;
  currentCard = null;
  setTimeout(updateShape, 250); // 사라지는 애니메이션이 끝난 뒤 잘라 낸다
}
bubble.addEventListener('click', hideBubble);

// ✕ 버튼: '끄기' 버튼이 있는 카드(알람)면 끄기와 같게 처리
function closeCard() {
  if (currentCard && (currentCard.actions || []).some((a) => a.id === 'dismiss')) return cardAction('dismiss');
  hideBubble();
}
// 말풍선 위에 마우스를 올려 두면 닫히지 않게 잠깐 멈춘다
bubble.addEventListener('pointerenter', () => {
  if (!bubbleOpen) return;
  clearTimeout(hideTimer);
  bubble.classList.add('paused');
});
bubble.addEventListener('pointerleave', () => {
  if (!bubbleOpen) return;
  bubble.classList.remove('paused');
  showFor(bubble.classList.contains('expanded') ? 12 : 5);
});

// 말풍선 바깥을 누르면 닫는다
// - 컴퓨터: 말풍선·캐릭터를 한 번 만진 뒤 다른 창을 누르면 비서 창이 초점을 잃는다(blur) → 닫기
// - 폰 앱: 화면의 빈 곳을 누르면 닫기
// 울리는 알람은 실수로 놓치지 않게 '끄기'나 '5분 뒤'를 눌러야만 닫힌다.
function dismissFromOutside() {
  if (!bubbleOpen || ringTimer || (currentCard && currentCard.ring)) return;
  hideBubble();
}
if (api.onOutside) api.onOutside(dismissFromOutside);
window.addEventListener(
  'pointerdown',
  (e) => {
    if (bubble.contains(e.target) || stage.contains(e.target)) return;
    dismissFromOutside();
  },
  true,
);

// 자동으로 닫히는 시간: 글 길이에 맞춰 6~14초. 대답이 필요한 카드(알람·버튼 있는 카드)만 원래 시간대로
function readSeconds(card) {
  const parts = [card.title, card.sub, card.text];
  for (const t of card.todos || []) parts.push(t.title);
  for (const e of card.events || []) parts.push(e.title);
  for (const sec of card.sections || []) for (const it of sec.items || []) parts.push(it.text);
  const len = parts.filter(Boolean).join(' ').length;
  return Math.round(Math.min(14, Math.max(6, 5 + len / 12)));
}
const needsAnswer = (card) => !!card.ring || (card.actions || []).length > 0;

api.onSay(({ card, seconds: asked = 8 }) => {
  const seconds = needsAnswer(card) ? asked : Math.min(Math.max(asked, 6), readSeconds(card));
  if (sleeping) setSleeping(false);
  activity();
  currentCard = card;
  drawCard(card, seconds);
  if (card.ring) startRing(card.ring, seconds);
  else stopRing();
  bubbleOpen = true;
  requestAnimationFrame(updateShape);
  showFor(seconds);

  if (mode === '3d') {
    if (card.react && namedReact(card.react)) {
      if (card.react !== 'glare') {
        char3d.express(card.tone === 'happy' ? 'happy' : 'surprise', 1.2);
        emote(card.icon || '✨', { cls: 'pop', dx: 26 });
      }
    } else react.say(card.tone || 'info');
  }
  else {
    img.classList.remove('talking');
    void img.offsetWidth;
    img.classList.add('talking');
  }
});

// ======================================================================
// 캐릭터 크기 (설정 또는 캐릭터 위에서 마우스 휠)
// ======================================================================
api.onSize(({ stage: px }) => {
  document.documentElement.style.setProperty('--stage', `${px}px`);
  requestAnimationFrame(() => requestAnimationFrame(updateShape));
});

let wheelAt = 0;
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const t = performance.now();
    if (t - wheelAt < 90) return; // 휠 한 칸에 한 번만
    wheelAt = t;
    api.resizeBy(e.deltaY < 0 ? 1 : -1);
    char3d.squish();
  },
  { passive: false },
);

// ======================================================================
// 다른 곳(물어보기, 알림)에서 시키는 반응
// ======================================================================
function namedReact(name) {
  if (mode !== '3d') return false;
  activity();
  const fn = {
    love: () => react.love(),
    dance: () => {
      char3d.dance(2.6);
      char3d.express('happy', 2.6);
      emote('♪', { dx: 26 });
      emote('♫', { dx: -24, delay: 700 });
    },
    cheer: () => {
      char3d.cheer(1.6);
      char3d.express('happy', 1.6);
      emote('🔥', { cls: 'pop', dx: 26 });
    },
    stretch: () => {
      char3d.stretch();
      char3d.express('happy', 1.4);
    },
    hop: () => {
      char3d.hop(0.45);
      char3d.express('happy', 1);
    },
    nod: () => {
      char3d.nod();
      char3d.express('happy', 0.9);
    },
    wave: () => {
      char3d.wave();
      char3d.hop(0.3);
      char3d.express('happy', 1.2);
    },
    happy: () => {
      char3d.express('happy', 1.5);
      char3d.squish();
      emote('😊', { cls: 'pop', dx: 26 });
    },
    lookAround: () => char3d.lookAround(),
    // 집중 지킴이: 째려보기
    glare: () => {
      char3d.express('sad', 2.5);
      char3d.shake();
      char3d.blush(0);
      emote('💢', { cls: 'pop', dx: 26, size: 26 });
      setTimeout(() => emote('👀', { cls: 'pop', dx: -26 }), 500);
    },
  }[name];
  if (!fn) return false;
  fn();
  return true;
}
api.onReact((name) => namedReact(name));

// ======================================================================
// 타이머 표시 (캐릭터 아래 작은 알약)
// ======================================================================
const timerPill = document.createElement('div');
timerPill.id = 'timerPill';
timerPill.className = 'off';
document.body.append(timerPill);
let timerWasOn = false;

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s2).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

api.onTimer((t) => {
  const on = !!t;
  if (on) {
    const icon = { focus: '🍅', break: '☕', timer: '⏱️' }[t.mode] || '⏱️';
    const label = { focus: '집중', break: '휴식', timer: '' }[t.mode] || '';
    const ratio = t.total ? t.left / t.total : 0;
    timerPill.className = `mode-${t.mode}`;
    timerPill.style.setProperty('--p', String(ratio));
    timerPill.innerHTML = '';
    const ic = document.createElement('span');
    ic.className = 'tp-icon';
    ic.textContent = icon;
    const tx = document.createElement('span');
    tx.className = 'tp-text';
    tx.textContent = `${label ? label + ' ' : ''}${fmt(t.left)}`;
    const x = document.createElement('span');
    x.className = 'tp-stop';
    x.textContent = '✕';
    x.title = '타이머 멈추기';
    timerPill.append(ic, tx, x);
  } else timerPill.className = 'off';
  if (on !== timerWasOn) {
    timerWasOn = on;
    requestAnimationFrame(updateShape);
  }
});

timerPill.addEventListener('click', (e) => {
  if (e.target.classList.contains('tp-stop')) api.stopTimer();
});

// ======================================================================
// 캐릭터 바꾸기
// ======================================================================
// 경험치를 얻으면 머리 위에 "+10 XP"
if (api.onXp) {
  api.onXp(({ gained }) => {
    if (!gained) return;
    emote(`+${gained} XP`, { cls: 'talk xp', dx: -36 });
    emote('✨', { cls: 'pop', dx: 30, delay: 150 });
  });
}

api.onCharacter((c) => {
  mode = c.kind;
  canvas.classList.toggle('off', mode !== '3d');
  img.classList.toggle('off', mode === '3d');
  if (mode === '3d') {
    char3d.setAccessory(c.accessory || null);
    char3d.setType(c.type);
    char3d.hop(0.4);
    char3d.express('happy', 1.2);
    emote('✨', { cls: 'pop', dx: 24, delay: 200 });
  } else {
    img.src = c.url;
  }
  requestAnimationFrame(() => requestAnimationFrame(updateShape));
});
