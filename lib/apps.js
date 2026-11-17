// "○○ 열어줘": 시작 메뉴에 있는 앱이나 자주 가는 사이트를 연다.
// - 윈도우: Get-StartApps 로 앱 목록을 읽고(설치 앱 + 스토어 앱 + 웹 앱), shell:AppsFolder 로 실행한다.
// - 맥: 응용 프로그램 폴더의 .app 을 읽고 open 으로 실행한다.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let apps = []; // { name, id, key }
let loading = null;

// 부르는 이름 → 시작 메뉴 이름 (앞에 있을수록 먼저)
const ALIASES = {
  카톡: ['카카오톡'],
  카카오: ['카카오톡'],
  크롬: ['Google Chrome'],
  구글크롬: ['Google Chrome'],
  엣지: ['Microsoft Edge'],
  엑셀: ['Excel'],
  워드: ['Word'],
  파워포인트: ['PowerPoint'],
  피피티: ['PowerPoint'],
  ppt: ['PowerPoint'],
  한글: ['한글 2020', '한글'],
  한셀: ['한셀 2020'],
  한쇼: ['한쇼 2020'],
  원노트: ['OneNote'],
  아웃룩: ['Outlook'],
  팀즈: ['Microsoft Teams', 'Microsoft Teams (personal)'],
  스포티파이: ['Spotify'],
  스팀: ['Steam'],
  탐색기: ['파일 탐색기'],
  파일: ['파일 탐색기'],
  내pc: ['내 PC', '파일 탐색기'],
  캡처: ['캡처 도구'],
  캡쳐: ['캡처 도구'],
  스크린샷: ['캡처 도구'],
  메모: ['스티커 메모', '메모장'],
  포스트잇: ['스티커 메모'],
  시계: ['시계'],
  알람앱: ['시계'],
  사진: ['사진'],
  카메라: ['카메라'],
  계산기: ['계산기'],
  그림판: ['그림판'],
  설정: ['설정'],
  윈도우설정: ['설정'],
  블렌더: ['Blender'],
  vscode: ['Visual Studio Code'],
  비주얼스튜디오코드: ['Visual Studio Code'],
  코드: ['Visual Studio Code'],
  안드로이드스튜디오: ['Android Studio'],
  굿노트: ['Goodnotes for GalaxyBook'],
  노트쉘프: ['Noteshelf Samsung'],
  삼성노트: ['삼성 노트'],
  매스픽스: ['Mathpix Snipping Tool'],
  체크메이트: ['체크메이트'],
  클립챔프: ['Microsoft Clipchamp'],
};

// 맥 앱 이름 (디스크에는 영어 이름으로 들어 있다)
const MAC_ALIASES = {
  카톡: ['KakaoTalk'],
  카카오: ['KakaoTalk'],
  카카오톡: ['KakaoTalk'],
  사파리: ['Safari'],
  파인더: ['Finder'],
  탐색기: ['Finder'],
  파일: ['Finder'],
  메모: ['Notes', 'Stickies'],
  메모장: ['TextEdit', 'Notes'],
  포스트잇: ['Stickies'],
  시계: ['Clock'],
  알람앱: ['Clock'],
  사진: ['Photos'],
  카메라: ['Photo Booth'],
  계산기: ['Calculator'],
  설정: ['System Settings', 'System Preferences'],
  시스템설정: ['System Settings', 'System Preferences'],
  캘린더앱: ['Calendar'],
  미리알림: ['Reminders'],
  음악: ['Music'],
  메시지: ['Messages'],
  페이스타임: ['FaceTime'],
  캡처: ['Screenshot'],
  캡쳐: ['Screenshot'],
  스크린샷: ['Screenshot'],
  터미널: ['Terminal'],
  키노트: ['Keynote'],
  페이지스: ['Pages'],
  넘버스: ['Numbers'],
  미리보기: ['Preview'],
  앱스토어: ['App Store'],
};

const MAC_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')];
const MAC_EXTRA = ['/System/Library/CoreServices/Finder.app'];


// 앱이 아니라 사이트로 여는 것
const SITES = {
  유튜브: 'https://www.youtube.com',
  네이버: 'https://www.naver.com',
  구글: 'https://www.google.com',
  지메일: 'https://mail.google.com',
  메일: 'https://mail.google.com',
  인스타: 'https://www.instagram.com',
  인스타그램: 'https://www.instagram.com',
  넷플릭스: 'https://www.netflix.com',
  웹툰: 'https://comic.naver.com',
  네이버웹툰: 'https://comic.naver.com',
  나무위키: 'https://namu.wiki',
  파파고: 'https://papago.naver.com',
  번역기: 'https://papago.naver.com',
  구글번역: 'https://translate.google.com',
  지도: 'https://map.naver.com',
  네이버지도: 'https://map.naver.com',
  날씨: 'https://weather.naver.com',
  깃허브: 'https://github.com',
  노션: 'https://www.notion.so',
  클로드: 'https://claude.ai',
  제미나이: 'https://gemini.google.com',
  챗gpt: 'https://chatgpt.com',
  챗지피티: 'https://chatgpt.com',
  구글드라이브: 'https://drive.google.com',
  드라이브: 'https://drive.google.com',
  캘린더: 'https://calendar.google.com',
  구글캘린더: 'https://calendar.google.com',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[\s._\-()]/g, '');

// 지우기·도움말 같은 건 앱으로 치지 않는다
const JUNK = /(제거|uninstall|도움말|help|readme|release notes|documentation|manual|website|faq|설명서)/i;

function loadMac() {
  const list = [];
  const seen = new Set();
  const add = (full) => {
    const name = path.basename(full, '.app');
    if (seen.has(name) || JUNK.test(name)) return;
    seen.add(name);
    list.push({ name, id: full, key: norm(name) });
  };
  for (const dir of MAC_DIRS) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith('.app')) add(path.join(dir, n));
  }
  for (const full of MAC_EXTRA) if (fs.existsSync(full)) add(full);
  return list;
}

function load() {
  if (loading) return loading;
  if (!IS_WIN) {
    apps = IS_MAC ? loadMac() : [];
    loading = Promise.resolve(apps);
    return loading;
  }
  const script =
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  loading = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: 20000 },
      (err, stdout) => {
        try {
          const list = JSON.parse(stdout || '[]');
          apps = (Array.isArray(list) ? list : [list])
            .filter((a) => a && a.Name && a.AppID && !JUNK.test(a.Name))
            .map((a) => ({ name: a.Name, id: a.AppID, key: norm(a.Name) }));
        } catch {
          apps = [];
        }
        resolve(apps);
      },
    );
  });
  return loading;
}

function reload() {
  loading = null;
  return load();
}

// 이름으로 앱 찾기
function find(query) {
  const q = norm(query);
  if (!q) return null;
  const byName = (name) => apps.find((a) => a.key === norm(name));
  const aliases = IS_MAC ? [...(MAC_ALIASES[q] || []), ...(ALIASES[q] || [])] : ALIASES[q] || [];
  for (const name of aliases) {
    const hit = byName(name);
    if (hit) return hit;
  }
  const exact = apps.find((a) => a.key === q);
  if (exact) return exact;
  // 이름에 들어 있는 것 중 가장 짧은 것 (예: "엑셀" 대신 "excel" 이라고 해도)
  const contains = apps.filter((a) => a.key.includes(q) || (q.length >= 3 && q.includes(a.key)));
  contains.sort((a, b) => a.key.length - b.key.length);
  return contains[0] || null;
}

function site(query) {
  return SITES[norm(query)] || null;
}

function launch(app) {
  if (IS_MAC) {
    spawn('open', [app.id], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (!IS_WIN) return;
  // 설치 앱·스토어 앱·웹 앱 모두 이 방법으로 열린다
  const child = spawn('explorer.exe', [`shell:AppsFolder\\${app.id}`], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

module.exports = { load, reload, find, site, launch, norm };
