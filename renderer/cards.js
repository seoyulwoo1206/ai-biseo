// 말풍선 카드 그리기.
// - kind: 'today' → 오늘의 할 일 카드 (진행률 링, 일정 타임라인, 목표 색 체크리스트)
// - 그 밖 → 아이콘 + 제목 + 설명 한 줄짜리 카드 (알림, 안내)

const MAX_TODOS = 5;
const MAX_EVENTS = 3;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// 목표 색('#RRGGBB' 또는 'linear-gradient(...)')에서 대표 단색
function baseColor(color) {
  const m = (color || '').match(/#[0-9a-fA-F]{6}/);
  return m ? m[0] : '#a3a9bd';
}

function inText(min) {
  if (min == null) return '';
  if (min < 1) return '곧';
  if (min < 60) return `${min}분 후`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분 후` : `${h}시간 후`;
}

function ring(done, total) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const ratio = total ? done / total : 1;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.classList.add('t-ring');
  svg.innerHTML = `
    <defs>
      <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--accent)"/>
        <stop offset="1" stop-color="var(--accent2)"/>
      </linearGradient>
    </defs>
    <circle cx="24" cy="24" r="${r}" class="t-ring-bg"/>
    <circle cx="24" cy="24" r="${r}" class="t-ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c}"/>`;
  // 화면 보안 규칙(CSP)이 HTML 안의 style="…" 을 막아서, 채울 양은 코드로 넣는다 (안 그러면 늘 꽉 참)
  svg.querySelector('.t-ring-fg').style.setProperty('--to', `${c * (1 - ratio)}px`);
  const wrap = el('div', 't-ring-wrap');
  wrap.append(svg);
  const label = el('div', 't-ring-label');
  label.append(el('b', '', String(done)), el('span', '', `/${total}`));
  wrap.append(label);
  return wrap;
}

function renderToday(card, expanded, onMore, onTodo, onAdd) {
  const root = el('div', 't-card');

  // 머리: 제목 + 날짜 + 진행률
  const head = el('div', 't-head');
  const titles = el('div', 't-titles');
  titles.append(el('div', 't-title', card.title), el('div', 't-date', card.sub || ''));
  head.append(titles);
  if (card.progress.total) head.append(ring(card.progress.done, card.progress.total));
  root.append(head);

  if (card.cheer) root.append(el('div', 't-cheer', card.cheer));

  const body = el('div', 't-body');

  // 일정 타임라인
  const past = card.events.filter((e) => e.state === 'past');
  const shown = expanded ? card.events : card.events.filter((e) => e.state !== 'past').slice(0, MAX_EVENTS);
  if (shown.length || past.length) {
    const sec = el('div', 't-sec');
    const label = el('div', 't-label');
    label.append(el('span', 't-label-icon', '📅'), el('span', '', '일정'));
    if (!expanded && past.length) label.append(el('span', 't-label-note', `지난 일정 ${past.length}`));
    sec.append(label);
    const line = el('div', 't-timeline');
    for (const e of shown) {
      const row = el('div', `t-ev is-${e.state}`);
      row.append(el('div', 't-ev-time', e.time));
      const dot = el('div', 't-ev-dot');
      row.append(dot);
      const main = el('div', 't-ev-main');
      main.append(el('span', 't-ev-title', e.title));
      if (e.end) main.append(el('span', 't-ev-end', `~${e.end}`));
      row.append(main);
      if (e.state === 'now') row.append(el('div', 't-badge now', '진행 중'));
      else if (e.state === 'next') row.append(el('div', 't-badge next', inText(e.inMin)));
      line.append(row);
    }
    if (!shown.length) line.append(el('div', 't-empty', '남은 일정 없음'));
    sec.append(line);
    body.append(sec);
  }

  // 할 일 체크리스트 (할 일이 없어도 목표가 있으면 '추가' 버튼은 보여 준다)
  const canAdd = !!(onAdd && card.goals && card.goals.length);
  if (card.todos.length || canAdd) {
    const sec = el('div', 't-sec');
    const label = el('div', 't-label');
    const left = card.todos.filter((t) => !t.done);
    const done = card.todos.filter((t) => t.done);
    label.append(el('span', 't-label-icon', '✅'), el('span', '', '할 일'));
    label.append(el('span', 't-label-note', left.length ? `${left.length}개 남음` : card.todos.length ? '다 했어!' : '아직 없어'));
    sec.append(label);
    const list = el('div', 't-todos');
    const items = expanded ? [...left, ...done] : left.slice(0, MAX_TODOS);
    for (const t of items) {
      const row = el('div', 't-todo' + (t.done ? ' done' : ''));
      const box = el('div', 't-check');
      box.style.setProperty('--goal', baseColor(t.color));
      if (t.done) {
        box.style.background = t.color || baseColor(t.color);
        box.textContent = '✓';
      }
      row.append(box);
      const txt = el('div', 't-todo-main');
      txt.append(el('div', 't-todo-title', t.title));
      if (t.goal && expanded) txt.append(el('div', 't-todo-goal', t.goal));
      row.append(txt);
      if (t.time) row.append(el('div', 't-time', `⏰ ${t.time}`));
      row.title = '눌러서 완료·수정·미루기·삭제';
      if (t.id && onTodo) {
        row.classList.add('tappable');
        row.addEventListener('click', (e) => {
          e.stopPropagation(); // 말풍선 닫기로 넘어가지 않게
          onTodo(t, row);
        });
      }
      list.append(row);
    }
    sec.append(list);

    const hidden = expanded ? 0 : left.length - items.length;
    if (!expanded && (hidden > 0 || done.length || past.length)) {
      const parts = [];
      if (hidden > 0) parts.push(`${hidden}개 더`);
      if (done.length) parts.push(`끝낸 일 ${done.length}`);
      if (!parts.length) parts.push('지난 일정');
      const more = el('button', 't-more', `${parts.join(' · ')} 보기 ▾`);
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        onMore();
      });
      sec.append(more);
    }
    if (canAdd) {
      const add = el('button', 't-add', '＋ 할 일 추가');
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        onAdd(sec, add, card.goals);
      });
      sec.append(add);
    }
    body.append(sec);
  } else if (!shown.length) {
    body.append(el('div', 't-empty big', '오늘은 할 일이 없어 🌿'));
  }

  root.append(body);
  return root;
}

// 아침 브리핑 카드
function renderBrief(card) {
  const root = el('div', 'br-card');
  const head = el('div', 'br-head');
  head.append(el('div', 'br-title', card.title), el('div', 'br-date', card.sub || ''));
  root.append(head);

  const w = card.weather;
  if (w) {
    const box = el('div', 'br-weather');
    const big = el('div', 'br-w-main');
    big.append(el('div', 'br-w-emoji', w.now.emoji));
    const temps = el('div', 'br-w-temps');
    const t = el('div', 'br-w-temp');
    t.append(el('b', '', `${w.now.temp}°`), el('span', '', ` ${w.now.desc}`));
    temps.append(t, el('div', 'br-w-range', `${w.place} · 최고 ${w.today.max}° 최저 ${w.today.min}°`));
    big.append(temps);
    box.append(big);
    const chips = el('div', 'br-chips');
    chips.append(el('span', 'br-chip' + (w.today.rain >= 50 ? ' warn' : ''), `☂️ 비 ${w.today.rain}%`));
    if (w.dust) chips.append(el('span', 'br-chip' + (/나쁨/.test(w.dust.label) ? ' warn' : ''), `${w.dust.emoji} 미세먼지 ${w.dust.label}`));
    chips.append(el('span', 'br-chip', `체감 ${w.now.feels}°`));
    box.append(chips);
    box.append(el('div', 'br-advice', w.advice));
    root.append(box);
  }

  const list = el('div', 'br-list');
  const row = (icon, text, sub) => {
    const r = el('div', 'br-row');
    r.append(el('span', 'br-row-icon', icon));
    const tx = el('div', 'br-row-text');
    tx.append(el('div', '', text));
    if (sub) tx.append(el('div', 'br-row-sub', sub));
    r.append(tx);
    list.append(r);
  };
  if (card.login) row('🔑', '체크메이트에 로그인하면 일정도 알려줄게');
  else {
    const ev = card.events || [];
    if (ev.length) row('📅', `오늘 일정 ${ev.length}개`, ev.slice(0, 2).map((e) => `${e.time} ${e.title}`).join(' · '));
    else row('📅', '오늘은 일정이 없어');
    row('✅', card.todosTotal ? `할 일 ${card.todosLeft}개 남았어` : '오늘 할 일은 아직 없어', card.todosTotal ? `전체 ${card.todosTotal}개` : '');
  }
  if (card.alarms && card.alarms.length) {
    row('⏰', `오늘 알람 ${card.alarms.length}개`, card.alarms.slice(0, 2).map((a) => a.when + (a.what ? ` ${a.what}` : '')).join(' · '));
  }
  root.append(list);

  if (card.dDays && card.dDays.length) {
    const dd = el('div', 'br-ddays');
    for (const d of card.dDays) {
      const c = el('div', 'br-dday' + (d.days <= 7 ? ' near' : ''));
      c.append(el('span', '', `${d.emoji} ${d.title}`), el('b', '', d.days === 0 ? 'D-DAY' : `D-${d.days}`));
      dd.append(c);
    }
    root.append(dd);
  }
  return root;
}

function renderSimple(card, onAction) {
  const root = el('div', 's-card');
  if (card.icon) {
    const icon = el('div', 's-icon', card.icon);
    if (card.color) icon.style.background = card.color;
    root.append(icon);
  }
  const text = el('div', 's-text');
  text.append(el('div', 's-title', card.title || ''));
  if (card.sub) text.append(el('div', 's-sub', card.sub));
  root.append(text);
  if (card.countdown) root.append(el('div', 's-count', `${card.countdown}분`));
  if (!card.actions || !card.actions.length) return root;
  // 버튼이 있는 카드 (알람: 다시 울리기 / 끄기)
  const wrap = el('div', 's-wrap');
  const row = el('div', 's-actions');
  card.actions.forEach((a, i) => {
    const b = el('button', i === 0 ? 's-act primary' : 's-act', a.label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction(a.id);
    });
    row.append(b);
  });
  wrap.append(root, row);
  return wrap;
}

export function renderCard(bubble, card, { seconds, expanded = false, onMore, onAction = () => {}, onTodo, onAdd, onClose }) {
  const inner = el('div', 'b-inner');
  inner.append(
    card.kind === 'today'
      ? renderToday(card, expanded, onMore, onTodo, onAdd)
      : card.kind === 'brief'
        ? renderBrief(card)
        : renderSimple(card, onAction),
  );
  const timer = el('div', 'b-timer');
  timer.style.animationDuration = `${seconds}s`;
  // 오른쪽 위 모서리의 닫기 버튼
  const close = el('button', 'b-close', '✕');
  close.title = '닫기';
  close.setAttribute('aria-label', '닫기');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onClose) onClose();
  });
  bubble.replaceChildren(inner, timer, close);
  bubble.className = `tone-${card.tone || 'info'}`;
  bubble.classList.toggle('wide', card.kind === 'today' || card.kind === 'brief');
  bubble.classList.toggle('expanded', expanded);
}
