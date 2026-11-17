// 화면 봐 주기: 찍기(전체 · 지금 창 · 영역 고르기), AI 에게 보낼 크기로 맞추기, 모드별 안내문.
// - 물어볼 때만 찍는다. 찍는 동안 비서 창은 잠깐 숨긴다.
// - 사진은 저장하지 않는다. 고른 AI 에게만 보내고, 이어지는 질문을 위해 3분 동안만 메모리에 둔다.
const path = require('path');
const { desktopCapturer, screen, BrowserWindow } = require('electron');
const winwatch = require('./winwatch');

// 최신 Claude 는 긴 쪽 2576px · 3.75MP 까지 줄이지 않고 본다 (작은 글자를 더 정확히 읽음)
const AI_MAX_EDGE = 2576;
const AI_MAX_PIXELS = 3750000;
const MAX_B64 = 4.5 * 1024 * 1024; // 그림 한 장 한도(5MB) 아래로

// ---------- 무엇을 해 줄지 (모드) ----------
const MODES = {
  auto: {
    label: '알아서',
    emoji: '✨',
    effort: 'medium',
    ask: '지금 내 화면을 보고, 내가 뭘 하고 있는지 파악해서 지금 가장 도움이 될 걸 알려줘',
    guide: [
      '사용자가 지금 무엇을 하고 있는지 화면에서 파악하고, 질문이 있으면 그 질문에 먼저 정확히 답해.',
      '질문이 막연하면 지금 상황에서 가장 쓸모 있는 도움 한두 가지(다음 할 일, 놓친 것, 주의할 것)를 알려 줘.',
    ],
  },
  explain: {
    label: '설명',
    emoji: '🔍',
    effort: 'low',
    ask: '이 화면에 뭐가 있는지 설명해줘',
    guide: [
      '첫 줄: 무슨 앱·사이트·문서인지 한 문장.',
      '그다음 화면의 핵심 내용 3~4개를 "• " 목록으로. 눈에 띄는 알림·경고·빨간 표시가 있으면 꼭 넣어.',
      '마지막 줄: 사용자가 바로 해 볼 만한 다음 행동 하나.',
    ],
  },
  solve: {
    label: '문제 풀이',
    emoji: '✏️',
    effort: 'high',
    ask: '화면에 있는 문제 풀어줘',
    guide: [
      '먼저 문제를 화면에서 정확히 옮겨 적어(숫자·기호·단위·보기 그대로). 잘 안 보이는 부분은 확대해서 확인해.',
      '첫 줄은 "답: …" (객관식이면 보기 번호와 내용).',
      '그 아래 핵심 풀이를 번호 목록 3~6단계로. 공식은 쓰고, 계산은 한 번 더 검산해.',
      '문제가 여러 개면 번호별로 짧게. 학생이 이해하도록 왜 그렇게 되는지 한 줄씩 덧붙여.',
    ],
  },
  translate: {
    label: '번역',
    emoji: '🌐',
    effort: 'low',
    ask: '화면에 있는 글 한국어로 번역해줘',
    guide: [
      '화면의 본문 외국어 글을 자연스러운 한국어로 옮겨. 메뉴·버튼 같은 화면 장식 글자는 빼.',
      '문단·목록 구조는 살리고, 길면 사용자가 보고 있는 가운데 부분 위주로.',
      '끝에 어려운 단어·표현 2~3개를 "• 단어: 뜻" 목록으로.',
    ],
  },
  error: {
    label: '오류 해결',
    emoji: '🐞',
    effort: 'high',
    ask: '화면에 뜬 오류가 뭔지, 어떻게 고치는지 알려줘',
    guide: [
      '첫 줄: 핵심 오류 메시지를 화면 그대로 짧게 인용.',
      '"원인:" 한두 문장. 확실하지 않으면 가능성이 큰 순서로 두 개까지.',
      '"해결:" 번호 목록으로 바로 따라 할 수 있게. 코드 오류면 고칠 줄을 짧게 보여 줘.',
    ],
  },
  summary: {
    label: '요약',
    emoji: '📝',
    effort: 'low',
    ask: '화면에 있는 글 요약해줘',
    guide: ['첫 줄: 한 문장 요약.', '그 아래 핵심 3~5개를 "• " 목록으로. 숫자·날짜·이름은 화면 그대로 정확히.'],
  },
};

// 물어본 말에서 모드 고르기
function detectMode(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (/(오류|에러|error|안돼|안되|버그|고쳐|실패|경고|빨간)/i.test(t)) return 'error';
  if (/(번역|해석|영어로|한국어로|일본어|중국어|뭐라고써|무슨뜻)/.test(t)) return 'translate';
  if (/(풀어|풀이|정답|답이뭐|답알려|문제|계산|구해)/.test(t)) return 'solve';
  if (/(요약|정리|핵심만|간추)/.test(t)) return 'summary';
  if (/(설명|뭐야|뭐가있|뭐하는|무슨화면|어떤화면)/.test(t)) return 'explain';
  return 'auto';
}

// 물어본 말에서 찍는 범위 고르기
function detectKind(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (/(영역|부분만|여기만|골라|잘라)/.test(t)) return 'region';
  if (/(이창|지금창|창만|프로그램만)/.test(t)) return 'window';
  return 'full';
}

// ---------- AI 에게 보낼 크기 ----------
function fitForAI(img) {
  let { width, height } = img.getSize();
  const s = Math.min(1, AI_MAX_EDGE / Math.max(width, height), Math.sqrt(AI_MAX_PIXELS / (width * height)));
  let out = img;
  if (s < 1) {
    width = Math.max(1, Math.round(width * s));
    height = Math.max(1, Math.round(height * s));
    out = img.resize({ width, height, quality: 'best' });
  }
  let q = 88;
  let data = out.toJPEG(q).toString('base64');
  while (data.length > MAX_B64 && q > 50) {
    q -= 12;
    data = out.toJPEG(q).toString('base64');
  }
  return { mime: 'image/jpeg', data, width, height };
}

// 보낸 사진의 좌표(x,y,w,h)로 원본에서 잘라 크게 본다 (Claude 의 확대 도구용)
function zoomer(native, sent) {
  const n = native.getSize();
  const rx = n.width / sent.width;
  const ry = n.height / sent.height;
  return ({ x, y, width, height }) => {
    const X = Math.max(0, Math.min(n.width - 8, Math.round(x * rx)));
    const Y = Math.max(0, Math.min(n.height - 8, Math.round(y * ry)));
    const W = Math.max(8, Math.min(n.width - X, Math.round(width * rx)));
    const H = Math.max(8, Math.min(n.height - Y, Math.round(height * ry)));
    let crop = native.crop({ x: X, y: Y, width: W, height: H });
    // 아주 작은 조각은 2배로 키워서 읽기 쉽게
    if (Math.max(W, H) < 700) crop = crop.resize({ width: W * 2, height: H * 2, quality: 'best' });
    const f = fitForAI(crop);
    return { mime: f.mime, data: f.data, note: `원본 ${W}×${H}px 부분을 ${f.width}×${f.height}로 확대` };
  };
}

// ---------- 찍기 ----------
// 비서 창을 잠깐 숨기고 fn 을 실행한 뒤 다시 보이게 한다
async function withOursHidden(fn) {
  const ours = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible());
  const focused = BrowserWindow.getFocusedWindow();
  for (const w of ours) w.hide();
  try {
    await new Promise((r) => setTimeout(r, 350)); // 창이 사라진 화면이 다시 그려질 때까지
    return await fn();
  } finally {
    for (const w of ours) if (!w.isDestroyed()) w.showInactive();
    if (focused && !focused.isDestroyed()) focused.focus();
  }
}

function nativeSize(display) {
  return { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
}

async function grabDisplay(display) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: nativeSize(display) });
  const src = sources.find((x) => x.display_id === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('화면을 못 찍었어.');
  return src.thumbnail;
}

// 맨 앞 창만: 창 목록에서 제목이 같은 창을 찾는다 (못 찾으면 null → 전체 화면으로)
async function grabWindow(display, fg) {
  if (!fg || !fg.title) return null;
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: nativeSize(display) });
  const src = sources.find((x) => x.name === fg.title) || sources.find((x) => fg.title.length > 6 && x.name.includes(fg.title));
  return src && !src.thumbnail.isEmpty() ? src.thumbnail : null;
}

// 영역 고르기: 찍어 둔 화면을 꽉 차게 띄우고, 끌어서 고른 네모만 잘라 준다 (Esc · 오른쪽 클릭 = 취소)
function pickRegion(display, full, preload) {
  return new Promise((resolve) => {
    const b = display.bounds;
    const w = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#000000',
      webPreferences: { preload },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setBounds(b);
    let done = false;
    const finish = (rect) => {
      if (done) return;
      done = true;
      if (!w.isDestroyed()) w.close();
      if (!rect || rect.width < 6 || rect.height < 6) return resolve(null);
      const n = full.getSize();
      const sx = n.width / b.width;
      const sy = n.height / b.height;
      const X = Math.max(0, Math.round(rect.x * sx));
      const Y = Math.max(0, Math.round(rect.y * sy));
      resolve(full.crop({ x: X, y: Y, width: Math.min(n.width - X, Math.round(rect.width * sx)), height: Math.min(n.height - Y, Math.round(rect.height * sy)) }));
    };
    const onDone = (e, rect) => {
      if (e.sender === w.webContents) finish(rect);
    };
    const { ipcMain } = require('electron');
    ipcMain.on('snip:done', onDone);
    w.on('closed', () => {
      ipcMain.removeListener('snip:done', onDone);
      finish(null);
    });
    w.loadFile(path.join(__dirname, '..', 'renderer', 'snip.html'));
    w.webContents.once('did-finish-load', () => {
      w.webContents.send('snip:image', 'data:image/jpeg;base64,' + full.toJPEG(90).toString('base64'));
      w.show();
      w.focus();
    });
    pickRegion.current = w; // 자동 테스트용
  });
}

/**
 * 찍기
 * @param {'full'|'window'|'region'} kind
 * @param {{ preload: string, lastForeground?: {title:string, proc:string}|null }} opts
 * @returns {Promise<null | { native: Electron.NativeImage, kind: string, title: string, app: string, display: {width:number,height:number} }>}
 */
async function capture(kind, { preload, lastForeground = null } = {}) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const shot = await withOursHidden(async () => {
    // 맨 앞 창이 비서 창(숨기는 중)이면, 물어보기 창을 열기 전에 기억해 둔 창을 쓴다
    const ourTitles = new Set(BrowserWindow.getAllWindows().map((w) => w.getTitle()));
    let fg = await winwatch.foregroundSoon().catch(() => null);
    if (!fg || !fg.title || ourTitles.has(fg.title)) fg = lastForeground;
    const full = await grabDisplay(display);
    let native = full;
    let got = 'full';
    if (kind === 'window') {
      const win = await grabWindow(display, fg).catch(() => null);
      if (win) {
        native = win;
        got = 'window';
      }
    }
    return { native, full, got, fg };
  });
  let { native, got } = shot;
  if (kind === 'region') {
    native = await pickRegion(display, shot.full, preload);
    if (!native) return null; // 취소
    got = 'region';
  }
  const fg = shot.fg || {};
  return { native, kind: got, title: fg.title || '', app: fg.proc || '', display: nativeSize(display) };
}

// AI 에게 같이 알려 줄 '어떻게 찍었는지'
function describeShot(s, sent) {
  const where = { full: '전체 화면', window: '맨 앞 창만', region: '사용자가 직접 고른 영역' }[s.kind] || '화면';
  const lines = [`찍은 범위: ${where} (보낸 사진 ${sent.width}×${sent.height}px, 모니터 ${s.display.width}×${s.display.height})`];
  if (s.title && s.kind !== 'region') lines.push(`맨 앞 창 제목: "${s.title.slice(0, 120)}"${s.app ? ` (${s.app})` : ''}`);
  return lines.join('\n');
}

module.exports = { MODES, detectMode, detectKind, fitForAI, zoomer, capture, describeShot, _snipWindow: () => pickRegion.current };
