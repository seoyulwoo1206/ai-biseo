// 음성 입력: 윈도우 기본 "음성 입력"(Win+H)을 대신 눌러 준다.
// 글자 칸에 커서가 있는 상태에서 부르면, 말한 내용이 그 칸에 받아써진다.
// PowerShell 을 한 번 띄워 두고 재사용한다 (매번 띄우면 1~2초 늦어서).
// 맥에는 대신 눌러 줄 방법이 없어서(받아쓰기 단축키는 fn 두 번), 물어보기 창에서 안내만 한다.
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

let ps = null;
let ready = false;

const SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AiKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void WinH() {
    keybd_event(0x5B, 0, 0, UIntPtr.Zero);
    keybd_event(0x48, 0, 0, UIntPtr.Zero);
    keybd_event(0x48, 0, 2, UIntPtr.Zero);
    keybd_event(0x5B, 0, 2, UIntPtr.Zero);
  }
}
"@
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq "winh") { [AiKeys]::WinH() }
}
`;

function start() {
  if (!IS_WIN || ps) return;
  // 한글·여러 줄 스크립트를 안전하게 넘기려고 UTF-16 Base64(EncodedCommand)로 보낸다
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  ps.stdout.on('data', (d) => {
    if (String(d).includes('READY')) ready = true;
  });
  ps.on('exit', () => {
    ps = null;
    ready = false;
  });
}

// 음성 입력 열기 (아직 준비 중이면 준비되는 대로)
function openVoiceTyping() {
  if (!IS_WIN) return false;
  start();
  const send = () => ps && ps.stdin.write('winh\n');
  if (ready) {
    send();
    return true;
  }
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (ready || Date.now() - t0 > 6000) {
      clearInterval(iv);
      if (ready) send();
    }
  }, 50);
  return true;
}

function isReady() {
  return ready;
}

function stop() {
  if (ps) ps.kill();
}

module.exports = { start, openVoiceTyping, isReady, stop };
