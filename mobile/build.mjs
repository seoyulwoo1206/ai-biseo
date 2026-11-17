// 폰 버전 만들기: PC 버전 화면 파일 + 폰 두뇌(backend.js)를 한 폴더(mobile/www)로 묶는다.
// 같은 결과물을 아이폰 웹앱(PWA)과 안드로이드 앱(assets/www) 둘 다 쓴다.
// 사용: node mobile/build.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const R = (...p) => path.join(root, ...p);
const OUT = R('mobile', 'www');
const ANDROID_ASSETS = R('mobile', 'android', 'app', 'src', 'main', 'assets', 'www');

// 지난 결과물은 지우되, Vercel 연결 정보(.vercel)는 남긴다
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f !== '.vercel') fs.rmSync(path.join(OUT, f), { recursive: true, force: true });

// 체크메이트 주소와 공개용(publishable) 키 — PC 버전과 같은 파일에서 읽는다
const cm = JSON.parse(fs.readFileSync(R('checkmate.config.json'), 'utf8'));
const target = ['chrome100', 'safari15'];

await build({
  entryPoints: [R('mobile', 'web', 'backend.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target,
  outfile: path.join(OUT, 'backend.js'),
  define: { CHECKMATE_URL: JSON.stringify(cm.url), CHECKMATE_KEY: JSON.stringify(cm.key) },
  logLevel: 'warning',
});
await build({
  entryPoints: [R('renderer', 'renderer.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target,
  outfile: path.join(OUT, 'renderer.js'),
  logLevel: 'warning',
});

const copy = (from, to = path.basename(from)) => fs.copyFileSync(from, path.join(OUT, to));
for (const f of ['style.css', 'settings.css', 'ask.css', 'settings.js', 'ask.js', 'login.js']) copy(R('renderer', f));
for (const f of ['shell.css', 'shell.js', 'bridge.js', 'settings-mobile.js', 'mobile.css', 'overlay-host.js']) copy(R('mobile', 'web', f));
for (const f of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) copy(R('mobile', 'web', 'icons', f));

// PC 화면 HTML 을 폰용으로: 보안 정책 줄은 빼고(두뇌가 같은 창에서 인터넷을 쓰므로),
// 화면 이름 표시 + 폰 화면 맞춤 + 맨 앞에 bridge.js
function page(src, dest, name, { before = [], after = [] } = {}) {
  let html = fs.readFileSync(R('renderer', src), 'utf8');
  html = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  html = html.replace('<html lang="ko">', `<html lang="ko" data-page="${name}">`);
  const scripts = [...before, 'bridge.js'].map((s) => `    <script src="${s}"></script>`).join('\n');
  html = html.replace(
    '<meta charset="utf-8" />',
    '<meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />\n' + scripts,
  );
  html = html.replace('</head>', '    <link rel="stylesheet" href="mobile.css" />\n  </head>');
  for (const s of after) html = html.replace('</body>', `  <script src="${s}"></script>\n  </body>`);
  fs.writeFileSync(path.join(OUT, dest), html);
}
page('index.html', 'stage.html', 'main');
page('index.html', 'overlay.html', 'main', { before: ['backend.js', 'overlay-host.js'] });
page('settings.html', 'settings.html', 'settings', { after: ['settings-mobile.js'] });
page('ask.html', 'ask.html', 'ask');
page('login.html', 'login.html', 'login');

// 앱 틀 (아이폰 웹앱 첫 화면 · 안드로이드 앱 화면)
fs.copyFileSync(R('mobile', 'web', 'shell.html'), path.join(OUT, 'index.html'));

fs.writeFileSync(
  path.join(OUT, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'AI 비서',
      short_name: 'AI 비서',
      description: '체크메이트 일정을 알려 주는 귀여운 캐릭터 비서',
      lang: 'ko',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#eef3ff',
      theme_color: '#eaf1ff',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ),
);

// 아이폰 웹앱을 Vercel 에 올릴 때: 오프라인 파일(sw.js)은 늘 새로 받게
fs.writeFileSync(
  path.join(OUT, 'vercel.json'),
  JSON.stringify(
    {
      headers: [
        { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
        { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
      ],
    },
    null,
    2,
  ),
);

const skip = new Set(['sw.js', 'overlay.html', 'overlay-host.js', 'vercel.json']);
const files = fs.readdirSync(OUT).filter((f) => !skip.has(f) && !f.startsWith('.'));
const sw = fs
  .readFileSync(R('mobile', 'web', 'sw.js'), 'utf8')
  .replace('__BUILD__', Date.now().toString(36))
  .replace('__FILES__', JSON.stringify(['./', ...files]));
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

// 안드로이드 앱이 있으면 같은 파일을 앱 안에도 넣는다
if (fs.existsSync(R('mobile', 'android'))) {
  fs.rmSync(ANDROID_ASSETS, { recursive: true, force: true });
  fs.cpSync(OUT, ANDROID_ASSETS, { recursive: true, filter: (src) => !/[\\/]\.vercel([\\/]|$)|vercel\.json$/.test(src) });
}

const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
console.log(`mobile/www 완료: backend ${kb('backend.js')}KB, renderer ${kb('renderer.js')}KB, 파일 ${fs.readdirSync(OUT).length}개`);
