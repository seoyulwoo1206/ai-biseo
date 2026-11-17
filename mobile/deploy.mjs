// 아이폰 웹앱 올리기: node mobile/deploy.mjs  (= npm run mobile:deploy)
// 폰 파일을 새로 묶고 Vercel 의 ai-biseo 프로젝트에 올린다 → https://ai-biseo-mocha.vercel.app
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
execSync('node mobile/build.mjs', { cwd: path.resolve(here, '..'), stdio: 'inherit' });

const fix = path.join(here, 'hostfix.cjs').replace(/\\/g, '/');
execSync('npx --yes vercel@latest deploy --prod --yes', {
  cwd: path.join(here, 'www'),
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: `--require "${fix}"` },
});
