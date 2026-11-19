// 영역 고르기 화면: 끌어서 네모를 고른 뒤 ✅ 를 누르면 그 좌표(화면 기준 CSS px)를 돌려준다.
// 마우스·손가락·펜 모두 된다. 확인 전에는 몇 번이든 다시 끌어서 고칠 수 있다.
const api = window.assistant.snip;
const $ = (id) => document.getElementById(id);
const box = $('box');
const size = $('size');
const dim = $('dim');
const tools = $('tools');
const bar = $('bar');
let start = null; // 끄는 중이면 시작점
let pointerId = null;
let rect = null; // 고른 네모
let sent = false;

api.onImage((url) => {
  $('shot').src = url;
});

function finish(r) {
  if (sent) return;
  sent = true;
  api.done(r);
}

function draw(e) {
  const x = Math.min(start.x, e.clientX);
  const y = Math.min(start.y, e.clientY);
  rect = { x, y, width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
  box.style.setProperty('left', `${x}px`);
  box.style.setProperty('top', `${y}px`);
  box.style.setProperty('width', `${rect.width}px`);
  box.style.setProperty('height', `${rect.height}px`);
  size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  size.classList.toggle('inside', y < 30);
}

// 확인 버튼은 네모 아래(자리가 없으면 위, 그것도 없으면 네모 안 아래쪽)에 붙인다
function placeTools() {
  tools.classList.remove('off');
  const tw = tools.offsetWidth;
  const th = tools.offsetHeight;
  const gap = 10;
  let left = rect.x + rect.width - tw;
  left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  let top = rect.y + rect.height + gap;
  if (top + th > window.innerHeight - 8) top = rect.y - th - gap;
  if (top < 8) top = rect.y + rect.height - th - gap;
  tools.style.setProperty('left', `${left}px`);
  tools.style.setProperty('top', `${Math.max(8, top)}px`);
}

function reset() {
  rect = null;
  box.classList.add('off');
  tools.classList.add('off');
  dim.classList.remove('picking');
  bar.classList.remove('faded');
}

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return; // 버튼 누르기는 끌기가 아니다
  if (e.pointerType === 'mouse' && e.button === 2) return finish(null); // 오른쪽 클릭 = 취소
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (start) return; // 두 번째 손가락은 무시
  e.preventDefault();
  start = { x: e.clientX, y: e.clientY };
  pointerId = e.pointerId;
  try {
    document.body.setPointerCapture(e.pointerId);
  } catch {}
  tools.classList.add('off');
  box.classList.remove('off');
  dim.classList.add('picking');
  bar.classList.add('faded');
  draw(e);
});

window.addEventListener('pointermove', (e) => {
  if (start && e.pointerId === pointerId) draw(e);
});

function release(e) {
  if (!start || e.pointerId !== pointerId) return;
  if (e.type !== 'pointercancel') draw(e);
  start = null;
  pointerId = null;
  bar.classList.remove('faded');
  if (!rect || rect.width < 12 || rect.height < 12) return reset(); // 너무 작으면 다시 고르게
  placeTools();
}
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

// 버튼: 마우스는 click, 손가락·펜은 손을 뗄 때 바로 (터치에서 click 이 늦거나 안 오는 경우가 있어서)
function tap(id, fn) {
  const b = $(id);
  let last = 0;
  const run = () => {
    if (Date.now() - last < 500) return; // 터치 뒤에 따라오는 click 은 한 번만
    last = Date.now();
    fn();
  };
  b.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') run();
  });
  b.addEventListener('click', run);
}
tap('ok', () => rect && finish(rect));
tap('redo', reset);
tap('cancel', () => finish(null));
tap('cancel2', () => finish(null));
tap('whole', () => finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }));

// 네모 안을 두 번 누르거나 Enter = 확인, Esc = 취소
window.addEventListener('dblclick', (e) => {
  if (!rect || e.target.closest('button')) return;
  const inside = e.clientX >= rect.x && e.clientX <= rect.x + rect.width && e.clientY >= rect.y && e.clientY <= rect.y + rect.height;
  if (inside) finish(rect);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') finish(null);
  if (e.key === 'Enter' && rect) finish(rect);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
