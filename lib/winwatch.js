// 지금 맨 앞에 있는 창의 제목과 프로그램 이름 알아내기 (집중 지킴이용).
// 이 정보는 컴퓨터 밖으로 보내지 않는다.
// - 윈도우: PowerShell 하나를 띄워 두고 GetForegroundWindow 로 묻는다.
// - 맥: osascript 로 맨 앞 앱 이름과 창 제목을 묻는다 (창 제목은 '손쉬운 사용' 권한이 있어야 보인다).
const { spawn, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const MAC_SCRIPT = `
tell application "System Events"
  set p to first application process whose frontmost is true
  set n to name of p
  set t to ""
  try
    set t to name of front window of p
  end try
end tell
return n & linefeed & t`;

function foregroundMac() {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', MAC_SCRIPT], { timeout: 3000, encoding: 'utf8' }, (err, out) => {
      if (err) return resolve(null);
      const [proc = '', ...rest] = String(out).trim().split(/\r?\n/);
      resolve({ title: rest.join(' ').trim(), proc: proc.trim() });
    });
  });
}

let ps = null;
let ready = false;
let waiting = null;
let buf = '';

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AiWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Title() { var h = GetForegroundWindow(); var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static uint Pid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
}
"@
[Console]::Out.WriteLine("READY")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $name = ""
  try { $name = (Get-Process -Id ([AiWin]::Pid()) -ErrorAction Stop).ProcessName } catch {}
  $o = @{ title = [AiWin]::Title(); proc = $name } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($o)
}
`;

function start() {
  if (!IS_WIN || ps) return;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'READY') ready = true;
      else if (line.startsWith('{') && waiting) {
        const w = waiting;
        waiting = null;
        try {
          w(JSON.parse(line));
        } catch {
          w(null);
        }
      }
    }
  });
  ps.on('exit', () => {
    ps = null;
    ready = false;
    if (waiting) waiting(null);
    waiting = null;
  });
}

// { title, proc } 또는 null
function foreground() {
  if (IS_MAC) return foregroundMac();
  if (!IS_WIN) return Promise.resolve(null);
  start();
  if (!ready || waiting) return Promise.resolve(null);
  return new Promise((resolve) => {
    waiting = resolve;
    ps.stdin.write('q\n');
    setTimeout(() => {
      if (waiting === resolve) {
        waiting = null;
        resolve(null);
      }
    }, 3000);
  });
}

// 처음 부를 땐 PowerShell 이 준비될 때까지 잠깐(최대 ms) 기다렸다가 묻는다 (화면 찍기용)
async function foregroundSoon(ms = 4000) {
  if (!IS_WIN) return foreground();
  start();
  const t0 = Date.now();
  while (ps && (!ready || waiting) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 80));
  return foreground();
}

function stop() {
  if (ps) ps.kill();
}

// 딴짓으로 보는 것들 (공부용 영상은 봐 준다)
const DISTRACT = [
  { re: /(youtube|유튜브)/i, label: '유튜브', allow: /(강의|강좌|lecture|공부|study|수업|인강|ebs|문제\s*풀이|개념|해설|lofi|white noise|asmr 공부)/i },
  { re: /(netflix|넷플릭스)/i, label: '넷플릭스' },
  { re: /(twitch|치지직|chzzk|아프리카tv|afreeca|soop)/i, label: '방송' },
  { re: /(instagram|인스타그램)/i, label: '인스타' },
  { re: /(tiktok|틱톡)/i, label: '틱톡' },
  { re: /(웹툰|webtoon|카카오페이지)/i, label: '웹툰' },
  { re: /(디시인사이드|dcinside|에펨코리아|fmkorea|더쿠|theqoo)/i, label: '커뮤니티' },
];
const GAME_PROCS = /^(steam|leagueclient|league of legends|valorant|riotclientservices|robloxplayerbeta|minecraft|javaw|maplestory|nexon.*|fifa.*|fc ?online.*|overwatch|genshinimpact|hd-player|bluestacks)$/i;

function distraction(win) {
  if (!win) return null;
  const title = win.title || '';
  const proc = win.proc || '';
  if (GAME_PROCS.test(proc)) return '게임';
  for (const d of DISTRACT) {
    if (d.re.test(title) && !(d.allow && d.allow.test(title))) return d.label;
  }
  return null;
}

module.exports = { start, foreground, foregroundSoon, distraction, stop };
