const api = window.assistant;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const DOT = {
  cat: '#9fd3ff',
  bunny: '#ffc8d6',
  bear: '#d8a06c',
  chick: '#ffdf55',
  mochi: '#fbf9f4',
  penguin: '#46598a',
  frog: '#94d978',
  puppy: '#f3dbb4',
  panda: 'linear-gradient(90deg, #2b2b36 50%, #fbfbf8 50%)',
  hamster: '#f6bb73',
};
const REMIND_OPTIONS = [0, 5, 10, 30];
const SIZE_OPTIONS = [
  [0.8, '작게'],
  [1, '보통'],
  [1.25, '크게'],
  [1.5, '왕'],
];

function chip(label, on, onClick, color) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  if (color) {
    const d = document.createElement('span');
    d.className = 'dot';
    d.style.background = color;
    b.append(d);
  }
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = label;
  b.append(n);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

function render(s) {
  $('chars3d').replaceChildren(
    ...s.characters3d.map((c) =>
      chip(c.name, s.current === '3d:' + c.id, () => api.settings.setCharacter('3d:' + c.id), DOT[c.id]),
    ),
  );
  $('charsImg').replaceChildren(
    ...s.images.map((name) => {
      const label = name.replace(/\.[^.]+$/, '');
      const b = chip(label, s.current === name, () => api.settings.setCharacter(name), null);
      // ✕ : 목록에서 지우기 (PC 는 휴지통으로 보내서 되살릴 수 있다)
      if (api.settings.removeImage) {
        const x = document.createElement('span');
        x.className = 'chip-x';
        x.textContent = '✕';
        x.title = '이 그림 지우기';
        // 확인은 칸 안에서 바로 묻는다. (confirm() 창을 띄우면 설정 창이 초점을 잃고 닫혀 버려서 지우기가 안 됐다)
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          const ask = document.createElement('div');
          ask.className = 'chip-confirm';
          const q = document.createElement('span');
          q.textContent = `"${label.length > 12 ? label.slice(0, 12) + '…' : label}" 지울까?`;
          const yes = document.createElement('button');
          yes.className = 'yes';
          yes.textContent = '지우기';
          yes.title = '컴퓨터에서는 휴지통으로 가요';
          yes.addEventListener('click', (ev) => {
            ev.stopPropagation();
            yes.disabled = true;
            api.settings.removeImage(name);
          });
          const no = document.createElement('button');
          no.textContent = '아니';
          no.addEventListener('click', (ev) => {
            ev.stopPropagation();
            ask.replaceWith(b);
          });
          ask.append(q, yes, no);
          b.replaceWith(ask);
        });
        b.append(x);
      }
      return b;
    }),
  );

  renderGrowth(s.growth, s.current);

  $('remind').replaceChildren(
    ...REMIND_OPTIONS.map((m) => {
      const b = document.createElement('button');
      b.textContent = m === 0 ? '정각' : `${m}분`;
      b.title = m === 0 ? '정각에만 알려줘요' : `${m}분 전, 그리고 정각에 알려줘요`;
      if (m === s.remindBefore) b.className = 'on';
      b.addEventListener('click', () => api.settings.setRemind(m));
      return b;
    }),
  );

  // 휠로 조절한 크기는 가장 가까운 칸에 불을 켠다
  const near = SIZE_OPTIONS.reduce((a, b) => (Math.abs(b[0] - s.size) < Math.abs(a[0] - s.size) ? b : a))[0];
  $('size').replaceChildren(
    ...SIZE_OPTIONS.map(([v, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (v === near) b.className = 'on';
      b.addEventListener('click', () => api.settings.setSize(v));
      return b;
    }),
  );

  $('autostart').checked = !!s.autoStart;

  renderAI(s.ai);
  renderLink(s.connect);
  renderSchool(s.school);

  $('placeName').textContent = s.place ? s.place.name : '서울';
  $('placeName').title = s.place ? `${s.place.admin || ''} ${s.place.name}`.trim() : '';
  $('briefing').checked = !!s.briefing;
  $('rainAlert').checked = !!s.rainAlert;
  $('focusGuard').checked = !!s.focusGuard;

  const fm = s.focusMinutes || 25;
  $('focus').textContent = s.timer ? '⏹ 타이머 멈추기' : `🍅 집중 ${fm}분`;
  $('focus').classList.toggle('running', !!s.timer);
  // 집중 시간 고르기 (말로 정한 시간이 칸에 없으면 그 칸도 보여 준다)
  const opts = [...new Set([...(s.focusOptions || [15, 25, 30, 45, 60, 90]), fm])].sort((a, b) => a - b);
  $('focusLen').replaceChildren(
    ...opts.map((m) => {
      const b = document.createElement('button');
      b.textContent = String(m);
      b.title = `집중 ${m}분 · 쉬는 시간 ${m >= 80 ? 15 : m >= 45 ? 10 : 5}분`;
      if (m === fm) b.className = 'on';
      b.addEventListener('click', () => api.settings.setFocusMinutes(m));
      return b;
    }),
  );

  const HEALTH = [
    ['water', '💧 물 마시기', '1시간마다'],
    ['stretch', '🙆 스트레칭', '50분마다'],
    ['eyes', '👀 눈 쉬기', '20분마다'],
  ];
  // 건강 알림: 한 줄에 하나씩 켜기/끄기 스위치
  $('health').replaceChildren(
    ...HEALTH.map(([key, label, every], i) => {
      const row = document.createElement('label');
      row.className = 'row between switch-row' + (i ? ' line' : '');
      const text = document.createElement('span');
      text.textContent = label;
      const hint = document.createElement('small');
      hint.className = 'hint';
      hint.textContent = every;
      text.append(' ', hint);
      const sw = document.createElement('input');
      sw.type = 'checkbox';
      sw.className = 'switch';
      sw.dataset.key = key;
      sw.checked = !!(s.health && s.health[key]);
      sw.addEventListener('change', () => api.settings.setHealth(key, sw.checked));
      row.append(text, sw);
      return row;
    }),
  );

  $('account').textContent = s.email ? `✅ ${s.email}` : '로그인 안 됨';
  $('auth').textContent = s.email ? '로그아웃' : '로그인';
  $('auth').onclick = () => (s.email ? api.settings.logout() : api.settings.login());
}

// ---------- 꾸미기 (레벨 · 아이템) ----------
function renderGrowth(g, current) {
  if (!g) return;
  $('lvNum').textContent = `Lv.${g.level}`;
  $('lvBar').style.width = `${Math.round((g.cur / g.need) * 100)}%`;
  $('lvXp').textContent = `${g.cur} / ${g.need}`;
  const isImage = current && !current.startsWith('3d:');
  // 아이템 칸: 위에 그림, 아래에 이름 (이름이 길어도 칸 밖으로 안 나가게)
  const tile = (icon, label, on, onClick) => {
    const b = document.createElement('button');
    b.className = 'chip item' + (on ? ' on' : '');
    const i = document.createElement('span');
    i.className = 'item-icon';
    i.textContent = icon;
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = label;
    b.append(i, n);
    b.title = label;
    b.addEventListener('click', onClick);
    return b;
  };
  $('items').replaceChildren(
    tile('✕', '없음', !g.accessory, () => api.settings.setAccessory(null)),
    ...g.items.map((it) => {
      if (!it.unlocked) {
        const b = tile('🔒', `Lv.${it.level}`, false, () => {});
        b.classList.add('locked');
        b.title = `Lv.${it.level}이 되면 ${it.emoji} ${it.name}`;
        return b;
      }
      const b = tile(it.emoji, it.name, g.accessory === it.id, () => api.settings.setAccessory(it.id));
      b.title = isImage ? '3D 캐릭터에만 달 수 있어요' : it.name;
      return b;
    }),
  );
}

// ---------- AI 연결 ----------
let aiState = null;

function renderAI(a) {
  if (!a) return;
  aiState = a;
  $('aiProvider').replaceChildren(
    ...a.providers.map((p) => {
      const b = document.createElement('button');
      b.textContent = `${p.name}${p.id === 'gemini' ? ' (무료)' : ' (유료)'}${p.hasKey ? ' ✓' : ''}`;
      if (p.id === a.provider) b.className = 'on';
      b.addEventListener('click', () => {
        $('aiMsg').textContent = '';
        api.settings.aiSet({ provider: p.id });
      });
      return b;
    }),
  );
  const name = a.provider === 'claude' ? 'Claude' : '제미나이';
  if (a.ready) {
    const model = a.provider === 'claude' ? (a.claudeModels.find((m) => m.id === a.claudeModel) || {}).name : a.geminiModel;
    $('aiStatus').textContent = `✅ ${name} 연결됨${model ? ' · ' + model : ''}`;
    $('aiStatus').className = 'ai-status ok';
    $('aiKey').placeholder = '다른 키로 바꾸려면 붙여 넣기';
  } else {
    $('aiStatus').textContent =
      a.provider === 'claude'
        ? 'Anthropic 콘솔에서 받은 키(sk-ant-…)를 넣어 줘. 쓴 만큼 요금이 나가.'
        : '구글 AI Studio 에서 무료 키를 받아서 넣어 줘.';
    $('aiStatus').className = 'ai-status';
    $('aiKey').placeholder = 'API 키 붙여 넣기';
  }
  $('aiClear').style.display = a.ready ? '' : 'none';

  const showModels = a.provider === 'claude';
  $('claudeModels').style.display = showModels ? '' : 'none';
  if (showModels) {
    $('claudeModels').replaceChildren(
      ...a.claudeModels.map((m) => {
        const b = document.createElement('button');
        b.textContent = m.name;
        b.title = m.note;
        if (m.id === a.claudeModel) b.className = 'on';
        b.addEventListener('click', () => api.settings.aiSet({ claudeModel: m.id }));
        return b;
      }),
    );
  }
}

$('aiForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('aiKey').value.trim();
  if (!key || !aiState) return;
  $('aiSave').disabled = true;
  $('aiMsg').className = 'ai-msg';
  $('aiMsg').textContent = '키 확인하는 중…';
  const r = await api.settings.aiSaveKey(aiState.provider, key);
  $('aiSave').disabled = false;
  if (r.ok) {
    $('aiKey').value = '';
    $('aiMsg').className = 'ai-msg ok';
    $('aiMsg').textContent = '연결됐어! 물어보기에서 아무거나 물어봐 🎉';
  } else {
    $('aiMsg').className = 'ai-msg err';
    $('aiMsg').textContent = r.message;
  }
});
$('aiKeyPage').addEventListener('click', () => aiState && api.settings.aiKeyPage(aiState.provider));
$('aiClear').addEventListener('click', () => {
  if (aiState) api.settings.aiClearKey(aiState.provider);
  $('aiMsg').textContent = '키를 지웠어.';
});

// ---------- 브리핑 · 날씨 ----------
$('placeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('placeInput').value.trim();
  if (!name) return;
  $('placeResults').textContent = '찾는 중…';
  const r = await api.settings.placeSearch(name);
  if (!r.ok || !r.list.length) {
    $('placeResults').textContent = r.ok ? '못 찾았어. 시·군·구 이름으로 다시 해 봐.' : r.message;
    return;
  }
  $('placeResults').replaceChildren(
    ...r.list.map((p) =>
      chip(`${p.name}${p.admin && p.admin !== p.name ? ` (${p.admin})` : ''}`, false, () => {
        api.settings.setPlace(p);
        $('placeInput').value = '';
        $('placeResults').replaceChildren();
      }),
    ),
  );
});
for (const key of ['briefing', 'rainAlert', 'focusGuard']) {
  $(key).addEventListener('change', (e) => api.settings.toggle(key, e.target.checked));
}
$('briefNow').addEventListener('click', () => api.settings.brief());

$('close').addEventListener('click', () => api.settings.close());
$('focus').addEventListener('click', () => api.settings.focus());
$('askBtn').addEventListener('click', () => api.settings.ask());
$('autostart').addEventListener('change', (e) => api.settings.setAutoStart(e.target.checked));
$('import').addEventListener('click', () => api.settings.importImage());
$('folder').addEventListener('click', () => api.settings.openFolder());
$('today').addEventListener('click', () => api.settings.today());
$('refresh').addEventListener('click', () => api.settings.refresh());
$('quit').addEventListener('click', () => api.settings.quit());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.settings.close();
});

api.settings.onUpdate(render);
api.settings.get().then(render);

// 미리 만들어 둔 창이 보일 때: 맨 위부터, 지난번 안내 글은 지우고, 여는 애니메이션 다시
if (api.settings.onReveal)
  api.settings.onReveal(() => {
    const p = document.querySelector('.panel');
    p.scrollTop = 0;
    for (const id of ['aiMsg', 'linkMsg', 'schoolMsg']) $(id).textContent = '';
    $('schoolResults').replaceChildren();
    $('placeResults').replaceChildren();
    $('placeInput').value = '';
    $('aiKey').value = '';
    p.classList.remove('reveal');
    void p.offsetWidth;
    p.classList.add('reveal');
  });

// ---------- 다른 AI 앱 연결 (Claude 데스크톱) ----------
let linkState = null;
function renderLink(c) {
  const sec = $('linkSection');
  if (!c) {
    sec.classList.add('off'); // 폰에는 없다
    return;
  }
  linkState = c.claude;
  const text = {
    connected: '연결됨 ✅',
    outdated: '다시 연결 필요',
    none: c.claudeInstalled ? '아직 안 함' : 'Claude 앱이 안 보여요',
    error: '설정 파일 확인 필요',
  }[c.claude];
  $('linkState').textContent = text || '';
  $('linkState').classList.toggle('ok', c.claude === 'connected');
  // 원격 (ChatGPT·폰)
  const rText = { on: '켜짐 ✅', connecting: '연결 중…', login: '체크메이트 로그인 필요', error: '연결 오류', off: '꺼짐' }[c.remote] || '';
  $('remoteState').textContent = c.remoteOn ? rText : '꺼짐';
  $('remoteState').className = 'hint' + (c.remoteOn && c.remote === 'on' ? ' ok' : c.remoteOn && (c.remote === 'error' || c.remote === 'login') ? ' bad' : '');
  $('remoteState').title = c.remoteError || '';
  $('remoteOn').checked = !!c.remoteOn;
  $('remoteBox').classList.toggle('off', !c.remoteOn);
  $('remoteUrl').textContent = c.remoteUrl || '';
  $('linkClaude').textContent = c.claude === 'connected' ? '연결 빼기' : c.claude === 'outdated' ? '다시 연결' : '연결하기';
}
$('linkClaude').addEventListener('click', async () => {
  const btn = $('linkClaude');
  btn.disabled = true;
  const r = await api.settings.connectClaude(linkState === 'connected' ? 'remove' : 'install');
  btn.disabled = false;
  $('linkMsg').textContent = r.message;
  $('linkMsg').className = 'ai-msg ' + (r.ok ? 'ok' : 'err');
});

// ---------- 학교 (급식·시간표) ----------
let schoolState = null;
function renderSchool(sc) {
  const sec = $('schoolSection');
  if (!sc || !api.settings.schoolSet) {
    sec.classList.add('off'); // 폰에는 아직 없다
    return;
  }
  schoolState = sc;
  const name = $('schoolName');
  name.textContent = sc.school ? sc.school.name : '아직 안 골랐어요';
  name.classList.toggle('empty', !sc.school);
  name.title = sc.school ? sc.school.name : '';
  $('schoolInput').placeholder = sc.school ? '다른 학교' : '학교 이름';
  document.querySelector('.school-more').classList.toggle('off', !sc.school);
  if (!sc.school) return;

  const maxGrade = /초등/.test(sc.school.kind || '') ? 6 : 3;
  $('schoolGrade').replaceChildren(
    ...Array.from({ length: maxGrade }, (_, i) => i + 1).map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(g);
      b.title = `${g}학년`;
      if (g === sc.grade) b.className = 'on';
      b.addEventListener('click', () => api.settings.schoolSet({ grade: g }));
      return b;
    }),
  );
  if (document.activeElement !== $('schoolCls')) $('schoolCls').value = sc.cls || '';
  $('schoolBrief').checked = !!sc.mealBrief;
  $('schoolAlert').checked = !!sc.classAlert;
  if (document.activeElement !== $('bellStart')) $('bellStart').value = sc.start || '08:40';
  $('classMin').replaceChildren(
    ...[45, 50].map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(m);
      b.title = `수업 한 시간이 ${m}분`;
      if (m === sc.classMin) b.className = 'on';
      b.addEventListener('click', () => api.settings.schoolSet({ classMin: m }));
      return b;
    }),
  );
  // 서버에 키가 있으면 따로 안 넣어도 7교시까지 보인다 → 내 키는 원하는 사람만
  $('neisToggle').textContent = sc.hasKey ? '🔑 내 나이스 키 넣음 ✓' : sc.serverKey ? '✅ 7교시까지 보여요 · 내 키 쓰기' : '🔑 7교시까지 보기';
  $('neisToggle').classList.toggle('muted', !!sc.serverKey && !sc.hasKey);
  $('neisPage').style.display = sc.serverKey && !sc.hasKey ? 'none' : '';
  const mineN = (sc.mine || []).length;
  $('mineState').textContent = mineN ? `${mineN}개 골랐어 · 나머지 시간은 공강` : '영재고·과학고처럼 수업을 골라 듣는 학교';
  $('mineOpen').textContent = mineN ? '바꾸기' : '고르기';
}

$('schoolForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('schoolInput').value.trim();
  if (!name) return;
  $('schoolMsg').className = 'ai-msg';
  $('schoolMsg').textContent = '찾는 중…';
  const r = await api.settings.schoolSearch(name);
  $('schoolMsg').textContent = '';
  if (!r.ok || !r.list.length) {
    $('schoolMsg').textContent = r.ok ? '못 찾았어. 학교 이름을 조금 더 정확히 써 줘 (예: OO고등학교)' : r.message;
    return;
  }
  $('schoolResults').replaceChildren(
    ...r.list.map((s) => {
      const b = chip(s.name, false, () => {
        api.settings.schoolSet({ school: s });
        $('schoolInput').value = '';
        $('schoolResults').replaceChildren();
        $('schoolMsg').className = 'ai-msg ok';
        $('schoolMsg').textContent = '골랐어! 학년·반도 알려 줘';
      });
      const where = document.createElement('small');
      where.textContent = s.area;
      b.append(where);
      b.title = `${s.name} · ${s.area}`;
      return b;
    }),
  );
});
$('schoolCls').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  if (v >= 1 && v <= 30) api.settings.schoolSet({ cls: v });
});
$('bellStart').addEventListener('change', (e) => {
  if (/^\d{2}:\d{2}$/.test(e.target.value)) api.settings.schoolSet({ start: e.target.value });
});
$('schoolBrief').addEventListener('change', (e) => api.settings.schoolSet({ mealBrief: e.target.checked }));
$('schoolAlert').addEventListener('change', (e) => api.settings.schoolSet({ classAlert: e.target.checked }));
$('neisToggle').addEventListener('click', () => $('neisForm').classList.toggle('off'));
$('neisPage').addEventListener('click', () => api.settings.aiKeyPage && api.settings.aiKeyPage('neis'));
$('neisForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('neisKey').value.trim();
  if (!key && !(schoolState && schoolState.hasKey)) return;
  $('schoolMsg').className = 'ai-msg';
  $('schoolMsg').textContent = '키 확인하는 중…';
  const r = await api.settings.schoolKey(key);
  $('schoolMsg').className = 'ai-msg ' + (r.ok ? 'ok' : 'err');
  $('schoolMsg').textContent = r.message;
  if (r.ok) {
    $('neisKey').value = '';
    $('neisForm').classList.add('off');
  }
});

// ---------- 내 수업 고르기 (영재고·과학고: 분반마다 듣는 수업이 달라서 반 시간표가 없다) ----------
$('mineOpen').addEventListener('click', async () => {
  const box = $('minePicker');
  if (!box.classList.contains('off')) return box.classList.add('off');
  box.classList.remove('off');
  box.replaceChildren(el('div', 'hint', '이번 주 수업 목록 불러오는 중…'));
  const r = await api.settings.schoolCourses();
  if (!r.ok) return box.replaceChildren(el('div', 'ai-msg err', r.message));
  if (!r.list) return box.replaceChildren(el('div', 'hint', '이 학교는 반 시간표가 있어서 고를 필요 없어 🙂'));
  if (!r.list.length) return box.replaceChildren(el('div', 'hint', '이번 주 수업이 아직 안 올라왔어'));
  const picked = new Set(r.mine);
  const list = el('div', 'mine-list');
  for (const c of r.list) {
    const line = el('div', 'mine-row');
    line.append(el('span', 'mine-name', c.subject));
    const secs = el('div', 'mine-secs');
    for (const n of c.sections) {
      const id = `${c.subject}|${n}`;
      const b = el('button', 'mine-sec' + (picked.has(id) ? ' on' : ''), String(n));
      b.type = 'button';
      b.title = `${c.subject} ${n}분반`;
      b.addEventListener('click', () => {
        if (picked.has(id)) picked.delete(id);
        else picked.add(id);
        b.classList.toggle('on', picked.has(id));
      });
      secs.append(b);
    }
    line.append(secs);
    list.append(line);
  }
  const save = el('button', 'primary small', '저장');
  save.type = 'button';
  save.addEventListener('click', () => {
    api.settings.schoolSet({ mine: [...picked] });
    box.classList.add('off');
    $('schoolMsg').className = 'ai-msg ok';
    $('schoolMsg').textContent = picked.size ? '저장했어! 고른 수업만 보여 주고 나머지는 공강으로 둘게' : '다 지웠어. 반 번호로 다시 맞춰 볼게';
  });
  const clear = el('button', 'ghost small', '모두 지우기');
  clear.type = 'button';
  clear.addEventListener('click', () => {
    picked.clear();
    list.querySelectorAll('.mine-sec.on').forEach((b) => b.classList.remove('on'));
  });
  const btns = el('div', 'row');
  btns.append(clear, save);
  box.replaceChildren(el('div', 'hint', '내가 듣는 과목의 분반 번호를 눌러 줘'), list, btns);
});

$('remoteOn').addEventListener('change', (e) => api.settings.remoteSet(e.target.checked));
$('remoteCopy').addEventListener('click', () => {
  api.settings.remoteCopy();
  $('remoteCopy').textContent = '복사됨 ✓';
  setTimeout(() => ($('remoteCopy').textContent = '복사'), 1500);
});
$('remoteReset').addEventListener('click', async () => {
  const r = await api.settings.remoteReset();
  $('linkMsg').textContent = r.message;
  $('linkMsg').className = 'ai-msg ' + (r.ok ? 'ok' : 'err');
});
