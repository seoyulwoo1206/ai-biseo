const api = window.assistant.ask;
const $ = (id) => document.getElementById(id);
const log = $('log');
const input = $('input');
const mic = $('mic');

// ---------- 소리로 읽어 주기 (컴퓨터에 깔린 한국어 목소리 / 폰 앱은 폰의 읽어 주기 기능) ----------
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let ttsOn = true;
try {
  ttsOn = localStorage.getItem('tts') !== 'off';
} catch {
  /* 저장소를 못 쓰면 기본값 */
}
function paintTts() {
  $('tts').classList.toggle('muted', !ttsOn);
  $('tts').textContent = ttsOn ? '🔊' : '🔇';
}
paintTts();
$('tts').addEventListener('click', () => {
  ttsOn = !ttsOn;
  try {
    localStorage.setItem('tts', ttsOn ? 'on' : 'off');
  } catch {
    /* 무시 */
  }
  if (!ttsOn) stopSpeaking();
  paintTts();
});

function stopSpeaking() {
  if (api.stopSpeak) api.stopSpeak();
  else if (synth) synth.cancel();
}

function koreanVoice() {
  const voices = synth.getVoices();
  return voices.find((v) => /ko(-|_)KR/i.test(v.lang) && /Heami|SunHi|InJoon/i.test(v.name)) || voices.find((v) => /^ko/i.test(v.lang));
}
if (synth) synth.getVoices(); // 목록 미리 불러오기

function speak(text) {
  if (!ttsOn || !text) return;
  // 이모지·기호는 읽지 않게 지운다
  const clean = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}•"]/gu, ' ').trim();
  if (!clean) return;
  if (api.speak) return api.speak(clean);
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = koreanVoice();
  if (v) u.voice = v;
  u.lang = 'ko-KR';
  u.rate = 1.05;
  u.pitch = 1.15;
  synth.speak(u);
}

// ---------- 대화 그리기 ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function scrollDown() {
  log.scrollTop = log.scrollHeight;
}

function addMe(text) {
  const m = el('div', 'msg me');
  m.append(el('div', 'bubble', text));
  log.append(m);
  scrollDown();
}

// ---------- 대답 글을 읽기 좋게: 문단 나누기 · 목록 · "용어: 설명" 굵게 ----------
const LIST_LINE = /^(?:[•·\-*]|(\d+)[.)])\s+(.+)$/;

// 문장이 많이 붙은 긴 줄은 두 문장씩 문단으로 나눈다
function splitLong(line) {
  if (line.length < 90) return [line];
  const ss = line.split(/(?<=[.!?])\s+(?=\S)/);
  if (ss.length < 3) return [line];
  const out = [];
  for (let i = 0; i < ss.length; i += 2) out.push(ss.slice(i, i + 2).join(' '));
  return out;
}

function fillItem(li, s) {
  const t = s.match(/^([^:：]{1,18})[:：]\s+(.+)$/);
  if (t) li.append(el('b', '', `${t[1]}:`), document.createTextNode(` ${t[2]}`));
  else li.textContent = s;
}

function richText(text) {
  const box = el('div', 'b-text');
  for (const block of String(text || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    let list = null;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(LIST_LINE);
      if (m) {
        const ordered = !!m[1];
        if (!list || (list.tagName === 'OL') !== ordered) {
          list = el(ordered ? 'ol' : 'ul', 'b-list');
          box.append(list);
        }
        const li = el('li');
        fillItem(li, m[2]);
        list.append(li);
        continue;
      }
      list = null;
      for (const chunk of splitLong(line)) box.append(el('p', 'b-p', chunk));
    }
  }
  return box;
}

function addBot(ans) {
  const m = el('div', 'msg bot');
  m.append(el('div', 'avatar', '🐾'));
  const b = el('div', 'bubble');
  if (ans.typing) {
    const t = el('div', 'typing');
    t.append(el('span'), el('span'), el('span'));
    b.append(t);
  } else {
    b.append(richText(ans.text));
    if (ans.sub) b.append(el('div', ans.ai ? 'b-sub b-ai' : 'b-sub', ans.sub));
    if (ans.buttons && ans.buttons.length) {
      const row = el('div', 'b-btns');
      for (const btn of ans.buttons) {
        const isLink = btn.action === 'link';
        const x = el('button', isLink ? 'link' : btn.engine || '', `${isLink ? '🔗' : '🔍'} ${btn.label}`);
        x.title = isLink ? btn.url : `${btn.label}에서 검색`;
        x.addEventListener('click', () => (isLink ? api.link(btn.url) : api.search(btn.engine, btn.query)));
        row.append(x);
      }
      b.append(row);
    }
  }
  m.append(b);
  log.append(m);
  scrollDown();
  return m;
}

async function ask(text, { screen = null } = {}) {
  text = text.trim();
  if (!text && !screen) return;
  const chips = $('chips');
  if (chips) chips.remove();
  if (screen) {
    const kindIcon = { full: '🖥️', window: '🪟', region: '✂️' }[screen.kind] || '📸';
    const m = shotModes.find((x) => x.id === screen.mode);
    addMe(`${kindIcon} ${m ? `${m.emoji} ${m.label}` : '화면'}${text ? ` · ${text}` : ''}`);
  } else addMe(text);
  input.value = '';
  const typing = addBot({ typing: true });
  const run = screen ? api.screen({ text, mode: screen.mode, kind: screen.kind }) : api.submit(text);
  const [ans] = await Promise.all([run, new Promise((r) => setTimeout(r, 350))]);
  typing.remove();
  addBot(ans);
  speak(ans.text);
}

// ---------- 📸 화면 봐 주기 (PC 만: 폰은 다른 앱 화면을 찍을 수 없다) ----------
// 📸 를 누르면 판이 열린다: 어디를 찍을지(전체 · 지금 창 · 영역) 고르고, 무엇을 해 줄지(설명 · 풀이 …) 누르면 바로 찍어서 물어본다.
const shot = $('shot');
const panel = $('shotPanel');
let shooting = false;
let shotModes = [];
let shotKind = 'full';
try {
  shotKind = localStorage.getItem('shotKind') || 'full';
} catch {
  /* 저장소를 못 쓰면 기본값 */
}

function paintKinds() {
  for (const b of panel.querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === shotKind);
}

function togglePanel(open = panel.classList.contains('off')) {
  panel.classList.toggle('off', !open);
  shot.classList.toggle('active', open);
  if (open) scrollDown();
}

async function askScreen(req = {}) {
  if (shooting) return;
  shooting = true;
  shot.disabled = true;
  togglePanel(false);
  stopSpeaking();
  try {
    await ask(input.value, { screen: { mode: req.mode || 'auto', kind: req.kind || shotKind } });
  } finally {
    shooting = false;
    shot.disabled = false;
  }
}

if (api.screen) {
  shot.addEventListener('click', () => togglePanel());
  for (const b of panel.querySelectorAll('[data-kind]')) {
    b.addEventListener('click', () => {
      shotKind = b.dataset.kind;
      try {
        localStorage.setItem('shotKind', shotKind);
      } catch {
        /* 무시 */
      }
      paintKinds();
    });
  }
  paintKinds();
  (api.screenModes ? api.screenModes() : Promise.resolve([])).then((modes) => {
    shotModes = modes;
    $('spModes').replaceChildren(
      ...modes.map((m) => {
        const b = el('button', m.id === 'auto' ? 'primary' : '', `${m.emoji} ${m.label}`);
        b.type = 'button';
        b.addEventListener('click', () => askScreen({ mode: m.id }));
        return b;
      }),
    );
  });
  if (api.onRunScreen) api.onRunScreen((req) => askScreen(req));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('off')) {
      e.stopImmediatePropagation();
      togglePanel(false);
    }
  }, true);
} else {
  shot.remove();
  panel.remove();
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(autoSend);
  ask(input.value);
});

for (const chip of document.querySelectorAll('#chips button')) {
  chip.addEventListener('click', () => ask(chip.textContent));
}

// ---------- 말로 입력 (윈도우: 음성 입력 Win+H 를 대신 눌러 줌 / 맥: 받아쓰기 fn 두 번 안내) ----------
const IS_MAC = window.assistant && window.assistant.platform === 'darwin';
// 받아쓴 글자가 들어오고 1.8초 동안 더 안 들어오면 자동으로 보낸다.
let lastKey = 0;
let autoSend = null;
let listening = false;

input.addEventListener('keydown', () => {
  lastKey = Date.now();
});

input.addEventListener('input', (e) => {
  const byVoice = Date.now() - lastKey > 600 && /^insert/.test(e.inputType || '');
  clearTimeout(autoSend);
  if (byVoice && listening) {
    autoSend = setTimeout(() => {
      if (input.value.trim()) ask(input.value);
      setListening(false);
    }, 1800);
  }
});

function setListening(v) {
  listening = v;
  mic.classList.toggle('listening', v);
  const listen = api.listen ? '듣고 있어요… 말해 줘요' : IS_MAC ? 'fn(🌐) 키를 두 번 누르고 말해 줘요. 말이 끝나면 알아서 보낼게요' : '듣고 있어요… 말이 끝나면 알아서 보낼게요';
  $('hint').textContent = v ? listen : IDLE_HINT;
}
const IDLE_HINT = document.documentElement.classList.contains('mobile')
  ? '🎤 를 누르면 말로 물어볼 수 있어요'
  : 'Ctrl+Shift+Space 로 어디서든 열 수 있어요';
$('hint').textContent = IDLE_HINT;

mic.addEventListener('click', async () => {
  stopSpeaking();
  // 폰 앱: 폰의 음성 인식으로 바로 받아쓴다
  if (api.listen) {
    if (listening) return;
    setListening(true);
    const said = await api.listen().catch(() => '');
    setListening(false);
    if (said) ask(said);
    return;
  }
  input.focus();
  if (listening) {
    setListening(false);
    return;
  }
  setListening(true);
  api.voice();
  // 30초 동안 아무 말이 없으면 듣기 표시를 끈다
  setTimeout(() => {
    if (listening && !input.value) setListening(false);
  }, 30000);
});

// ---------- 창 ----------
$('close').addEventListener('click', () => api.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.close();
});
api.onFocus(() => input.focus());
// 미리 만들어 둔 창이 보일 때: 여는 애니메이션을 다시
if (api.onReveal)
  api.onReveal(() => {
    const p = document.querySelector('.panel');
    if (!p) return;
    p.classList.remove('reveal');
    void p.offsetWidth;
    p.classList.add('reveal');
  });
window.addEventListener('load', () => input.focus());
