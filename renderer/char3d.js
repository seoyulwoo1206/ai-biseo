// 말랑한 장난감 느낌의 3D 캐릭터. 모양은 전부 코드로 만든다 (외부 모델 파일 없음).
// 여기는 "몸을 어떻게 움직이고 어떤 표정을 짓는지"만 담당하고,
// 언제 어떤 반응을 할지는 renderer.js 가 정한다.
import * as THREE from '../node_modules/three/build/three.module.js';

const ORANGE = '#ffad42';
const INK = '#2b2b36';

const TYPES = {
  cat: { iris: '#4f7cff', body: '#9fd3ff', belly: '#eef8ff', ear: 'cat', inner: '#ffb3c7', face: 'cat' },
  bunny: { iris: '#d0508a', body: '#ffc8d6', belly: '#fff4f7', ear: 'bunny', inner: '#ff98b3', face: 'cat' },
  bear: { iris: '#8a5a2b', body: '#d8a06c', belly: '#f8e4c9', ear: 'bear', inner: '#b77e4b', face: 'muzzle' },
  chick: { iris: '#d08a1a', body: '#ffdf55', belly: '#fff4b5', ear: 'tuft', inner: ORANGE, face: 'beak', foot: ORANGE, wings: true },
  mochi: { iris: '#8a7ad8', body: '#fbf9f4', belly: null, ear: 'none', inner: '#ffc2d1', face: 'smile' },
  penguin: {
    iris: '#4f7cff',
    body: '#46598a', belly: '#ffffff', bellyBig: true, ear: 'none', inner: ORANGE,
    face: 'beak', foot: ORANGE, wings: true, mask: '#ffffff',
  },
  frog: { iris: '#3c9a52', body: '#94d978', belly: '#eafad8', ear: 'frog', inner: '#ff9fb4', face: 'wide' },
  puppy: { iris: '#8a5a2b', body: '#f3dbb4', belly: '#fff8ec', ear: 'floppy', earColor: '#b98457', inner: '#b98457', face: 'puppy', patch: '#d6a676' },
  panda: {
    iris: '#6d6d8a',
    body: '#fbfbf8', belly: null, ear: 'bear', earColor: INK, inner: INK, face: 'muzzle',
    muzzle: '#ffffff', arm: INK, foot: INK, eyePatch: INK,
  },
  hamster: { iris: '#a2602a', body: '#f6bb73', belly: '#fff6ea', ear: 'mouse', inner: '#ffb5c2', face: 'hamster' },
};

// 몸통(타원체) 반지름
const A = 1.05;
const B = 0.95;
const C = 1.0;

function soft(color, extra = {}) {
  const base = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: 0.5,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
    sheen: 0.8,
    sheenRoughness: 0.5,
    sheenColor: base.clone().lerp(new THREE.Color('#ffffff'), 0.6),
    envMapIntensity: 0.55,
    ...extra,
  });
}

const glossyBlack = () =>
  new THREE.MeshPhysicalMaterial({ color: '#1d2230', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.25 });
const flat = (color) => new THREE.MeshBasicMaterial({ color });

// 몸통 표면 위의 점과 그 점의 바깥 방향
function surface(x, y, lift = 0) {
  const z = C * Math.sqrt(Math.max(0, 1 - (x / A) ** 2 - (y / B) ** 2));
  const n = new THREE.Vector3(x / (A * A), y / (B * B), z / (C * C)).normalize();
  const p = new THREE.Vector3(x, y, z).addScaledVector(n, lift);
  return { p, n };
}

function place(mesh, p, n) {
  mesh.position.copy(p);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return mesh;
}

function stickOn(mesh, x, y, lift = 0) {
  const { p, n } = surface(x, y, lift);
  return place(mesh, p, n);
}

// 캔버스로 그린 텍스처는 한 번만 만들어 돌려 쓴다
const texCache = new Map();
function canvasTex(key, size, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

// 가장자리가 부드럽게 번지는 볼터치
const blushTex = () =>
  canvasTex('blush', 128, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,120,160,0.95)');
    grad.addColorStop(0.45, 'rgba(255,135,170,0.6)');
    grad.addColorStop(1, 'rgba(255,150,180,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    // 작은 반짝이 선 세 개
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = n * 0.035;
    g.lineCap = 'round';
    for (const dx of [-0.16, 0, 0.16]) {
      g.beginPath();
      g.moveTo(n * (0.5 + dx + 0.05), n * 0.4);
      g.lineTo(n * (0.5 + dx - 0.05), n * 0.6);
      g.stroke();
    }
  });

// 애니 느낌 눈동자: 가운데 진하고, 아래쪽은 색이 비치는 홍채
const irisTex = (color) =>
  canvasTex('iris' + color, 128, (g, n) => {
    const c = n / 2;
    g.fillStyle = '#141526';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    const lower = g.createLinearGradient(0, n * 0.35, 0, n);
    lower.addColorStop(0, 'rgba(0,0,0,0)');
    lower.addColorStop(1, color);
    g.fillStyle = lower;
    g.beginPath();
    g.arc(c, c, c * 0.92, 0, Math.PI * 2);
    g.fill();
    const pupil = g.createRadialGradient(c, c * 0.92, 0, c, c * 0.92, c * 0.5);
    pupil.addColorStop(0, 'rgba(8,8,18,1)');
    pupil.addColorStop(1, 'rgba(8,8,18,0)');
    g.fillStyle = pupil;
    g.fillRect(0, 0, n, n);
    g.strokeStyle = 'rgba(10,10,20,0.9)';
    g.lineWidth = n * 0.06;
    g.beginPath();
    g.arc(c, c, c * 0.95, 0, Math.PI * 2);
    g.stroke();
  });

// 머리 위 광택
const shineTex = () =>
  canvasTex('shine', 128, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  });

// 아래로 갈수록 살짝 어두워지는 몸통 (가짜 그림자로 입체감)
function shadeBody(geo) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = THREE.MathUtils.smoothstep(y, -1, 0.7);
    let k = 0.8 + 0.2 * t;
    k *= 0.96 + 0.04 * Math.max(0, z); // 앞쪽이 조금 더 밝게
    colors[i * 3] = k;
    colors[i * 3 + 1] = k * 0.985;
    colors[i * 3 + 2] = Math.min(1, k * 1.02);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function arcMesh(r, tube, mat, flip) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24, Math.PI), mat);
  if (flip) m.rotation.z = Math.PI;
  return m;
}

// 표정별 눈 한 쌍을 만든다. anchors: 왼/오른 눈 자리 [{ p, n }]
function buildEyes(anchors, irisColor = '#6d5bd0') {
  const sets = { open: new THREE.Group(), happy: new THREE.Group(), closed: new THREE.Group(), squeeze: new THREE.Group() };
  const ink = glossyBlack();
  anchors.forEach(({ p, n }, i) => {
    const side = i === 0 ? -1 : 1;
    const wrap = (child) => {
      const g = new THREE.Group();
      place(g, p, n);
      g.add(child);
      return g;
    };

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.135, 32, 24), ink);
    eye.scale.set(1, 1.32, 0.55);
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(0.143, 40),
      new THREE.MeshBasicMaterial({ map: irisTex(irisColor), transparent: true, toneMapped: false }),
    );
    iris.position.z = 0.134;
    const hl1 = new THREE.Mesh(new THREE.SphereGeometry(0.046, 16, 12), flat('#ffffff'));
    hl1.scale.set(1, 0.85, 0.4);
    hl1.position.set(0.042, 0.052, 0.14);
    const hl2 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), flat('#ffffff'));
    hl2.scale.set(1, 1, 0.4);
    hl2.position.set(-0.044, -0.054, 0.14);
    const hl3 = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), flat('#ffffff'));
    hl3.scale.set(1, 1, 0.4);
    hl3.position.set(0.066, -0.01, 0.14);
    eye.add(iris, hl1, hl2, hl3);
    sets.open.add(wrap(eye));

    sets.happy.add(wrap(arcMesh(0.085, 0.022, ink, false)));

    const closed = arcMesh(0.075, 0.018, ink, true);
    closed.position.y = 0.02;
    sets.closed.add(wrap(closed));

    // > <
    const sq = new THREE.Group();
    for (const k of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.13, 4, 8), ink);
      bar.rotation.z = -side * (Math.PI / 2 - k * 0.55);
      bar.position.set(side * 0.045, k * 0.045, 0);
      sq.add(bar);
    }
    sets.squeeze.add(wrap(sq));
  });
  return sets;
}

function buildCharacter(t) {
  const parts = { ears: [], arms: [], blushes: [], ear: t.ear };
  const turn = new THREE.Group();
  const lift = t.mask ? 0.07 : 0; // 얼굴 가면이 있으면 눈·입을 그만큼 띄운다

  const bodyMat = soft(t.body);
  const bodyShadedMat = soft(t.body, { vertexColors: true });
  const body = new THREE.Mesh(shadeBody(new THREE.SphereGeometry(1, 72, 56)), bodyShadedMat);
  body.scale.set(A, B, C);
  turn.add(body);

  // 머리 위 반짝 광택
  const shine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.3),
    new THREE.MeshBasicMaterial({ map: shineTex(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 }),
  );
  stickOn(shine, -0.38, 0.62, 0.015);
  shine.rotateZ(0.5);
  turn.add(shine);

  // 배
  if (t.belly) {
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), soft(t.belly));
    if (t.bellyBig) {
      belly.scale.set(0.66, 0.5, 0.3);
      stickOn(belly, 0, -0.5, -0.17);
    } else {
      belly.scale.set(0.52, 0.34, 0.28);
      stickOn(belly, 0, -0.56, -0.16);
    }
    turn.add(belly);
  }

  // 얼굴 가면 (펭귄)
  if (t.mask) {
    const maskMat = soft(t.mask);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), maskMat);
      m.scale.set(0.34, 0.36, 0.2);
      stickOn(m, s * 0.27, 0.05, -0.12);
      turn.add(m);
    }
  }

  // 판다 눈 무늬
  if (t.eyePatch) {
    const patchMat = soft(t.eyePatch);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), patchMat);
      m.scale.set(0.17, 0.23, 0.08);
      stickOn(m, s * 0.35, 0.08, -0.05);
      m.rotateZ(s * 0.5);
      turn.add(m);
    }
  }

  // 강아지 한쪽 눈 얼룩
  if (t.patch) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), soft(t.patch));
    m.scale.set(0.22, 0.24, 0.08);
    stickOn(m, 0.36, 0.14, -0.055);
    turn.add(m);
  }

  // 개구리: 머리 위 눈 혹
  let eyeAnchors;
  if (t.ear === 'frog') {
    eyeAnchors = [];
    for (const s of [-1, 1]) {
      const c = new THREE.Vector3(s * 0.4, 0.7, 0.32);
      const bump = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), bodyMat);
      bump.position.copy(c);
      turn.add(bump);
      const n = new THREE.Vector3(s * 0.2, 0.15, 1).normalize();
      eyeAnchors.push({ p: c.clone().addScaledVector(n, 0.27), n });
    }
  } else {
    eyeAnchors = [-1, 1].map((s) => surface(s * 0.34, 0.1, lift));
  }
  const eyes = buildEyes(eyeAnchors, t.iris);
  for (const g of Object.values(eyes)) turn.add(g);
  parts.eyes = eyes;
  parts.eyeAnchors = eyeAnchors; // 안경 자리

  // 볼터치
  for (const s of [-1, 1]) {
    const mat = new THREE.MeshBasicMaterial({ map: blushTex(), transparent: true, opacity: 0.7, depthWrite: false });
    const blush = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), mat);
    const by = t.ear === 'frog' ? 0.02 : -0.08;
    stickOn(blush, s * 0.57, by, 0.012 + (t.mask ? 0.0 : 0));
    turn.add(blush);
    parts.blushes.push(mat);
  }

  // 입: 평소 / 벌린 입 / 시무룩
  const mouthMat = flat('#3a2a2a');
  const mouthNormal = new THREE.Group();
  const mouthOpen = new THREE.Group();
  const mouthSad = new THREE.Group();
  let mouthY = -0.06;
  // 주둥이가 있으면 입을 주둥이 앞으로 띄운다
  const faceLift = lift + (t.face === 'muzzle' || t.face === 'puppy' ? 0.1 : 0);
  const addArc = (group, x, y, r, up = false) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 8, 20, Math.PI), mouthMat);
    stickOn(m, x, y, 0.01 + faceLift);
    if (!up) m.rotateZ(Math.PI);
    group.add(m);
  };
  const addMuzzle = (color, y) => {
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), soft(color));
    muzzle.scale.set(0.27, 0.2, 0.14);
    stickOn(muzzle, 0, y, -0.04);
    turn.add(muzzle);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), glossyBlack());
    nose.scale.set(1.3, 0.9, 0.8);
    stickOn(nose, 0, y + 0.07, 0.1);
    turn.add(nose);
  };

  if (t.face === 'cat' || t.face === 'hamster') {
    addArc(mouthNormal, -0.05, -0.06, 0.05);
    addArc(mouthNormal, 0.05, -0.06, 0.05);
    if (t.face === 'hamster') {
      const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.02), flat('#ffffff'));
      stickOn(teeth, 0, -0.13, 0.01);
      mouthNormal.add(teeth);
      for (const s of [-1, 1]) {
        const cheek = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), soft('#fff6ea'));
        cheek.scale.set(0.2, 0.16, 0.12);
        stickOn(cheek, s * 0.6, -0.24, -0.06);
        turn.add(cheek);
      }
    }
  } else if (t.face === 'smile') {
    addArc(mouthNormal, 0, -0.05, 0.075);
  } else if (t.face === 'wide') {
    addArc(mouthNormal, 0, -0.02, 0.2);
    mouthY = -0.12;
  } else if (t.face === 'muzzle') {
    addMuzzle(t.muzzle || t.belly, -0.1);
    addArc(mouthNormal, -0.045, -0.15, 0.045);
    addArc(mouthNormal, 0.045, -0.15, 0.045);
    mouthY = -0.2;
  } else if (t.face === 'puppy') {
    addMuzzle(t.belly, -0.1);
    addArc(mouthNormal, -0.045, -0.15, 0.045);
    addArc(mouthNormal, 0.045, -0.15, 0.045);
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), soft('#ff8fa6'));
    tongue.scale.set(0.05, 0.065, 0.03);
    stickOn(tongue, 0, -0.22, 0.08);
    mouthNormal.add(tongue);
    mouthY = -0.2;
  } else if (t.face === 'beak') {
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 24), soft(t.inner));
    beak.scale.set(1.4, 1, 0.75);
    stickOn(beak, 0, -0.08, 0.08 + lift);
    beak.rotateX(Math.PI / 2);
    turn.add(beak);
    mouthY = null; // 부리는 벌린 입 대신 그대로
  }

  if (mouthY !== null) {
    const o = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), flat('#5a2630'));
    o.scale.set(0.065, 0.075, 0.02);
    stickOn(o, 0, mouthY, 0.005 + faceLift);
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), flat('#ff8fa6'));
    tongue.scale.set(0.04, 0.03, 0.01);
    stickOn(tongue, 0, mouthY - 0.03, 0.02 + faceLift);
    mouthOpen.add(o, tongue);
    addArc(mouthSad, 0, mouthY - 0.02, 0.05, true);
  }
  mouthOpen.visible = false;
  mouthSad.visible = false;
  turn.add(mouthNormal, mouthOpen, mouthSad);
  parts.mouths = { normal: mouthNormal, open: mouthOpen, sad: mouthSad, hasOpen: mouthY !== null };

  // 귀
  const earMat = t.earColor ? soft(t.earColor) : bodyMat;
  const innerMat = soft(t.inner);
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    if (t.ear === 'cat') {
      ear.position.set(s * 0.5, 0.6, 0);
      ear.rotation.z = -s * 0.36;
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.64, 32), earMat);
      outer.scale.set(1, 1, 0.6);
      outer.position.y = 0.3;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 32), innerMat);
      inner.scale.set(1, 1, 0.4);
      inner.position.set(0, 0.26, 0.12);
      ear.add(outer, inner);
    } else if (t.ear === 'bunny') {
      ear.position.set(s * 0.32, 0.78, -0.05);
      ear.rotation.z = -s * 0.14;
      const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.72, 8, 24), earMat);
      outer.scale.set(1, 1, 0.7);
      outer.position.y = 0.45;
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.56, 8, 16), innerMat);
      inner.scale.set(1, 1, 0.4);
      inner.position.set(0, 0.45, 0.08);
      ear.add(outer, inner);
    } else if (t.ear === 'bear' || t.ear === 'mouse') {
      const r = t.ear === 'mouse' ? 0.22 : 0.26;
      ear.position.set(s * (t.ear === 'mouse' ? 0.55 : 0.6), 0.66, -0.05);
      const outer = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), earMat);
      outer.scale.set(1, 1, 0.7);
      outer.position.y = 0.06;
      const inner = new THREE.Mesh(new THREE.SphereGeometry(r * 0.58, 24, 16), innerMat);
      inner.scale.set(1, 1, 0.4);
      inner.position.set(0, 0.05, r * 0.5);
      ear.add(outer, inner);
    } else if (t.ear === 'floppy') {
      ear.position.set(s * 0.72, 0.58, 0.3);
      ear.rotation.z = s * 0.25;
      const flap = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), earMat);
      flap.scale.set(0.27, 0.46, 0.14);
      flap.position.set(s * 0.06, -0.3, 0);
      ear.add(flap);
    } else {
      continue;
    }
    parts.ears.push({ group: ear, side: s, base: ear.rotation.z });
    turn.add(ear);
  }
  if (t.ear === 'tuft') {
    const tuft = new THREE.Group();
    tuft.position.set(0, 0.88, 0);
    [-0.45, 0, 0.45].forEach((a) => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42 - Math.abs(a) * 0.25, 16), bodyMat);
      f.position.set(Math.sin(a) * 0.16, 0.16, 0);
      f.rotation.z = -a;
      tuft.add(f);
    });
    parts.ears.push({ group: tuft, side: 1, base: 0 });
    turn.add(tuft);
  }

  // 팔(날개)
  const armMat = t.arm ? soft(t.arm) : bodyMat;
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.86, -0.12, 0.12);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), armMat);
    m.scale.set(t.wings ? 0.5 : 0.85, t.wings ? 1.25 : 1.15, t.wings ? 1.0 : 0.85);
    m.position.y = -0.16;
    arm.rotation.z = s * 0.35;
    arm.add(m);
    parts.arms.push({ group: arm, side: s, base: arm.rotation.z });
    turn.add(arm);
  }

  // 발
  const footMat = t.foot ? soft(t.foot) : bodyMat;
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 18), footMat);
    foot.scale.set(1.15, 0.6, 1.35);
    foot.position.set(s * 0.4, -0.86, 0.22);
    turn.add(foot);
  }

  return { turn, parts };
}

// ---------- 꾸미기 아이템 (레벨이 오르면 생김) ----------
// 모두 고개(turn)에 붙여서 고개를 돌리면 같이 돈다. top = 꾸미기 전 캐릭터 키(귀 끝).
function gold() {
  return new THREE.MeshPhysicalMaterial({ color: '#ffc93c', metalness: 0.65, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 1.1 });
}

function starShape(outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

// 개구리는 머리 양옆에 눈 혹이 있어서, 머리핀은 눈 혹 바깥 위쪽에 꽂는다 (s: -1 왼쪽, 1 오른쪽)
const FROG_BUMP = (s) => new THREE.Vector3(s * 0.4, 0.7, 0.32);
function onFrogBump(mesh, s, lift = 0.02) {
  const dir = new THREE.Vector3(s * 0.62, 0.72, 0.3).normalize();
  const p = FROG_BUMP(s).addScaledVector(dir, 0.3 + lift);
  const n = dir.clone().add(new THREE.Vector3(0, 0, 1.1)).normalize(); // 정면 쪽으로 돌려서 잘 보이게
  return place(mesh, p, n);
}

function buildAccessory(id, parts, top) {
  const g = new THREE.Group();
  g.name = 'accessory';
  const frog = parts.ear === 'frog';
  if (id === 'ribbon') {
    const mat = soft('#ff6f9f');
    const bow = new THREE.Group();
    for (const s of [-1, 1]) {
      const loop = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
      loop.scale.set(0.17, 0.11, 0.07);
      loop.position.x = s * 0.15;
      loop.rotation.z = s * 0.35;
      bow.add(loop);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 12), mat);
      tail.position.set(s * 0.06, -0.1, -0.01);
      tail.rotation.z = s * 0.5;
      bow.add(tail);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 16), soft('#ff4f86'));
    knot.scale.set(1, 1, 0.8);
    bow.add(knot);
    if (frog) {
      bow.scale.setScalar(0.85);
      onFrogBump(bow, 1, 0.03);
      bow.rotateZ(-0.6);
    } else {
      stickOn(bow, 0.5, 0.62, 0.05);
      bow.rotateZ(-0.45);
    }
    g.add(bow);
  } else if (id === 'flower') {
    const flower = new THREE.Group();
    const petal = soft('#ffb3cf');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), petal);
      m.scale.set(0.085, 0.06, 0.035);
      m.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0);
      m.rotation.z = a;
      flower.add(m);
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), soft('#ffd84d'));
    center.position.z = 0.02;
    flower.add(center);
    flower.scale.setScalar(frog ? 1.4 : 1.7);
    if (frog) onFrogBump(flower, -1, 0.05);
    else stickOn(flower, -0.5, 0.55, 0.06);
    g.add(flower);
  } else if (id === 'glasses') {
    const mat = new THREE.MeshPhysicalMaterial({ color: '#3d3550', roughness: 0.35, clearcoat: 0.8 });
    const anchors = parts.eyeAnchors || [];
    const centers = anchors.map((a) => a.p.clone().addScaledVector(a.n, 0.07));
    anchors.forEach((a, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.022, 12, 40), mat);
      place(ring, centers[i], a.n);
      g.add(ring);
      // 렌즈: 살짝 반짝이는 투명 유리
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.165, 32),
        new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.05, clearcoat: 1 }),
      );
      place(lens, centers[i], a.n);
      g.add(lens);
    });
    if (centers.length === 2) {
      const mid = centers[0].clone().add(centers[1]).multiplyScalar(0.5);
      const len = centers[0].distanceTo(centers[1]) - 0.33;
      const bridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, Math.max(0.02, len), 4, 8), mat);
      bridge.position.copy(mid).add(new THREE.Vector3(0, 0.03, 0));
      bridge.rotation.z = Math.PI / 2;
      g.add(bridge);
    }
  } else if (id === 'crown') {
    const mat = gold();
    const crown = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.14, 40, 1, true), mat);
    band.material.side = THREE.DoubleSide;
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 12), mat);
      spike.position.set(Math.sin(a) * 0.27, 0.14, Math.cos(a) * 0.27);
      crown.add(spike);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), soft(['#ff5f86', '#5fa8ff', '#5fdc9a', '#b58bff', '#ff9f43'][i]));
      gem.position.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
      crown.add(gem);
    }
    // 귀 사이에 쏙: 크게, 앞으로 살짝 기울여서 정면에서도 잘 보이게
    if (frog) {
      // 개구리: 두 눈 혹 사이 정수리에 살짝 작게
      crown.scale.setScalar(1.1);
      crown.position.set(0, 1.0, 0.02);
      crown.rotation.set(0.28, 0, 0);
    } else {
      crown.scale.setScalar(1.35);
      crown.position.set(0.04, 1.02, 0.12);
      crown.rotation.set(0.32, 0, -0.12);
    }
    g.add(crown);
  } else if (id === 'star') {
    const star = new THREE.Mesh(
      new THREE.ExtrudeGeometry(starShape(0.2, 0.09), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 }),
      gold(),
    );
    star.geometry.center();
    if (frog) {
      star.scale.setScalar(1.1);
      onFrogBump(star, 1, 0.07);
    } else stickOn(star, 0.42, 0.58, 0.06);
    star.rotateZ(-0.25);
    g.add(star);
  } else if (id === 'scarf') {
    const red = soft('#ff6b6b');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 16, 64), red);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1.06, 1.0, 1.4);
    ring.position.y = -0.3;
    g.add(ring);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.91, 0.03, 8, 64), soft('#fff3f3'));
    stripe.rotation.x = Math.PI / 2;
    stripe.scale.copy(ring.scale);
    stripe.position.y = -0.3;
    g.add(stripe);
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 16), red);
    tail.scale.set(1, 1, 0.5);
    tail.position.set(0.42, -0.52, 0.86);
    tail.rotation.z = 0.25;
    g.add(tail);
  } else if (id === 'halo') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 16, 48), new THREE.MeshBasicMaterial({ color: '#ffe680', toneMapped: false }));
    halo.rotation.x = Math.PI / 2 - 0.25;
    halo.position.y = top + 0.2;
    halo.userData.bob = true;
    g.add(halo);
  } else {
    return null;
  }
  return g;
}

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export function createCharacter3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  // 고해상도 화면에서 2배로 그리면 GPU 가 바빠져 컴퓨터 전체가 버벅인다 → 1.5배까지만 (차이는 거의 안 보임)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.98;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  // 캐릭터를 화면 조금 아래에 두어 머리 위(긴 귀·점프) 자리를 남긴다
  camera.position.set(0, 0.75, 7.4);
  camera.lookAt(0, 0.42, 0);

  // 부드러운 스튜디오 환경 (위는 따뜻한 흰빛, 아래는 푸른빛, 왼쪽 위에 큰 조명판)
  {
    const env = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const cols = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i) / 10;
      const c = new THREE.Color('#bcd0ff').lerp(new THREE.Color('#fff6ee'), (y + 1) / 2);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
    panel.material.color.multiplyScalar(3);
    panel.position.set(-4, 6, 6);
    panel.lookAt(0, 0, 0);
    env.add(panel);
    const pink = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: '#ffd6e6', side: THREE.DoubleSide }));
    pink.material.color.multiplyScalar(1.6);
    pink.position.set(6, 1, -5);
    pink.lookAt(0, 0, 0);
    env.add(pink);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
  }

  scene.add(new THREE.HemisphereLight('#ffffff', '#c9dcff', 0.7));
  const key = new THREE.DirectionalLight('#ffffff', 1.7);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight('#ffe3ee', 1.6);
  rim.position.set(-4, 2.5, -3);
  const fill = new THREE.DirectionalLight('#dfeaff', 0.6);
  fill.position.set(-2, -1, 4);
  scene.add(key, rim, fill);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.0;
  scene.add(shadow);

  // root: 위치(점프) / squash: 아래쪽 기준으로 찌그러짐 / turn: 고개 돌리기
  const root = new THREE.Group();
  const squash = new THREE.Group();
  squash.position.y = -0.95;
  root.add(squash);
  scene.add(root);

  let current = null;
  let parts = null;
  let topExtent = 1;
  let baseTop = 1;
  let accessoryId = null;
  let accessory = null;

  // 캐릭터 키 (몸 가운데에서 귀 끝·꾸미기까지) — 창 모양 계산에 쓴다
  function measure() {
    current.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(current);
    return Math.max(1, box.max.y - root.position.y);
  }

  function applyAccessory() {
    if (accessory) {
      current.remove(accessory);
      disposeTree(accessory);
      accessory = null;
    }
    if (accessoryId) {
      accessory = buildAccessory(accessoryId, parts, baseTop);
      if (accessory) current.add(accessory);
    }
    topExtent = measure();
  }

  function setType(type) {
    const t = TYPES[type] || TYPES.cat;
    if (current) {
      squash.remove(current);
      disposeTree(current);
    }
    accessory = null;
    const built = buildCharacter(t);
    current = built.turn;
    current.position.y = 0.95;
    parts = built.parts;
    squash.add(current);
    baseTop = measure();
    applyAccessory();
  }

  function setAccessory(id) {
    accessoryId = id || null;
    if (current) applyAccessory();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  // 캐릭터 크기를 바꾸면 캔버스 크기도 바뀐다
  new ResizeObserver(resize).observe(canvas);

  // ---------- 상태 ----------
  const now = () => performance.now() / 1000;
  let last = now();
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const acts = {}; // 이름 → { start, dur, ... }
  let held = false;
  let sleeping = false;
  let expr = null; // { name, until }
  let blinkAt = now() + 2;
  let blinkStart = -1;
  let blush = 0.7;
  let blushUntil = 0;

  function play(name, dur, extra = {}) {
    acts[name] = { start: now(), dur, ...extra };
  }
  // 진행률 0~1, 끝났으면 -1
  function prog(name, t) {
    const a = acts[name];
    if (!a) return -1;
    const p = (t - a.start) / a.dur;
    if (p >= 1) {
      delete acts[name];
      return -1;
    }
    return p;
  }

  function charCenterPx() {
    const v = new THREE.Vector3(0, 0, 0);
    current.getWorldPosition(v);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
    };
  }

  function unitPx() {
    const dist = camera.position.length();
    return canvas.clientHeight / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }

  function setExpression(name) {
    const e = parts.eyes;
    const eyeName = {
      normal: 'open', surprise: 'open', sad: 'open', wink: 'open',
      happy: 'happy', love: 'happy', kiss: 'happy', shy: 'happy',
      sleep: 'closed', dizzy: 'squeeze', squeeze: 'squeeze',
    }[name] || 'open';
    for (const [k, g] of Object.entries(e)) {
      g.visible = k === eyeName || (name === 'wink' && k === 'happy');
      g.children.forEach((c) => (c.visible = true));
    }
    if (name === 'wink') {
      // 왼쪽 눈은 감고(^) 오른쪽 눈은 뜬다
      e.open.children[0].visible = false;
      e.happy.children[1].visible = false;
    }
    const m = parts.mouths;
    const mouth = m.hasOpen
      ? ({ surprise: 'open', love: 'open', happy: 'open', dizzy: 'open', kiss: 'open', wink: 'open', sad: 'sad' }[name] || 'normal')
      : 'normal';
    m.open.scale.setScalar(name === 'kiss' ? 0.6 : 1);
    m.normal.visible = mouth === 'normal';
    m.open.visible = mouth === 'open';
    m.sad.visible = mouth === 'sad';
  }

  // 그리는 횟수 조절: 움직일 때만 초당 60번, 가만히 숨 쉴 때 30번, 잘 때 15번.
  // (예전엔 화면 주사율(120Hz 등) 그대로 계속 그려서 GPU·CPU 를 많이 썼다)
  let lastDraw = 0;
  function targetFps(t) {
    if (held || Object.keys(acts).length) return 60;
    const lx = sleeping ? 0 : look.tx; // 잘 때는 고개가 가운데로 돌아간다
    const ly = sleeping ? 0 : look.ty;
    if (Math.abs(lx - look.x) + Math.abs(ly - look.y) > 0.004) return 60;
    if (blinkStart >= 0 || t < blushUntil) return 60;
    return sleeping ? 15 : 30;
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!current || document.hidden) return;
    const t = now();
    if (!window.__noFpsCap && t - lastDraw < 1 / targetFps(t) - 0.004) return;
    lastDraw = t;
    window.__draws = (window.__draws || 0) + 1; // 속도 재기용 (그린 횟수)
    const dt = Math.min(t - last, 0.1);
    last = t;

    let sy = 1 + (sleeping ? 0.045 * Math.sin(t * 1.3) : 0.025 * Math.sin(t * 2.2));
    let y = sleeping ? 0 : 0.05 * Math.sin(t * 1.5);
    let rotZ = 0;
    let rotX = sleeping ? 0.16 : 0;
    let rotY = 0;
    let x = 0;
    let armLift = 0; // 양팔 들기 (0~1)
    let earWiggle = 0;

    // 점프 (높이 h)
    let p = prog('hop', t);
    if (p >= 0) {
      const h = acts.hop.h;
      if (p < 0.15) sy *= 1 - 0.16 * Math.sin((p / 0.15) * Math.PI);
      else if (p < 0.75) {
        const q = (p - 0.15) / 0.6;
        y += h * Math.sin(Math.PI * q);
        sy *= 1 + 0.1 * Math.sin(Math.PI * q);
        armLift = Math.max(armLift, Math.sin(Math.PI * q));
      } else sy *= 1 - 0.14 * Math.sin(((p - 0.75) / 0.25) * Math.PI);
    }

    // 말랑 눌림
    p = prog('squish', t);
    if (p >= 0) sy *= 1 - 0.22 * Math.exp(-p * 5) * Math.cos(p * 18);

    // 한 바퀴 돌기
    p = prog('spin', t);
    if (p >= 0) {
      rotY += Math.PI * 2 * ease(p);
      y += 0.25 * Math.sin(Math.PI * p);
      armLift = Math.max(armLift, Math.sin(Math.PI * p));
    }

    // 춤
    p = prog('dance', t);
    if (p >= 0) {
      const env = Math.sin(Math.PI * Math.min(1, p * 4)) * (p > 0.85 ? (1 - p) / 0.15 : 1);
      const beat = t * 9;
      rotZ += 0.2 * Math.sin(beat) * env;
      x += 0.12 * Math.sin(beat) * env;
      y += 0.12 * Math.abs(Math.sin(beat)) * env;
      armLift = Math.max(armLift, 0.8 * env);
      earWiggle += 0.15 * Math.sin(beat * 2) * env;
    }

    // 끄덕끄덕
    p = prog('nod', t);
    if (p >= 0) rotX += 0.18 * Math.sin(p * Math.PI * 4) * (1 - p);

    // 도리도리
    p = prog('shake', t);
    if (p >= 0) rotY += 0.35 * Math.sin(p * Math.PI * 6) * (1 - p);

    // 어질어질 (흔들고 난 뒤)
    p = prog('wobble', t);
    if (p >= 0) {
      const k = 1 - p;
      rotZ += 0.25 * Math.sin(t * 10) * k;
      x += 0.08 * Math.sin(t * 6) * k;
    }

    // 기지개
    p = prog('stretch', t);
    if (p >= 0) {
      const s = Math.sin(Math.PI * p);
      sy *= 1 + 0.14 * s;
      armLift = Math.max(armLift, s * 1.2);
      rotX -= 0.15 * s;
    }

    // 갸웃
    p = prog('tilt', t);
    if (p >= 0) rotZ += acts.tilt.dir * 0.22 * Math.sin(Math.PI * p);

    // 두리번
    p = prog('lookAround', t);
    let lookOverride = null;
    if (p >= 0) lookOverride = 0.6 * Math.sin(p * Math.PI * 2) * Math.sin(Math.PI * p);

    // 깜짝 (부르르)
    p = prog('jolt', t);
    if (p >= 0) x += 0.05 * Math.sin(t * 60) * (1 - p);

    // 뿌잉뿌잉 (빠르게 좌우로 흔들며 통통)
    p = prog('wiggle', t);
    if (p >= 0) {
      const env = Math.sin(Math.PI * p);
      rotZ += 0.28 * Math.sin(t * 17) * env;
      sy *= 1 - 0.07 * Math.abs(Math.sin(t * 17)) * env;
      earWiggle += 0.22 * Math.sin(t * 17) * env;
      armLift = Math.max(armLift, 0.5 * env);
    }

    // 데굴데굴 (옆으로 한 바퀴 구르기)
    p = prog('roll', t);
    if (p >= 0) {
      const d = acts.roll.dir;
      rotZ += -d * Math.PI * 2 * ease(p);
      x += d * 0.35 * Math.sin(Math.PI * p);
      y += 0.12 * Math.sin(Math.PI * p);
    }

    // 만세
    p = prog('cheer', t);
    if (p >= 0) {
      const env = Math.sin(Math.PI * Math.min(1, p * 2.5)) * (p > 0.8 ? (1 - p) / 0.2 : 1);
      armLift = Math.max(armLift, 1.7 * env);
      y += 0.1 * Math.abs(Math.sin(t * 10)) * env;
    }

    // 부끄 (고개 돌리고 숙이기)
    let tuck = 0;
    p = prog('shy', t);
    if (p >= 0) {
      const env = Math.sin(Math.PI * Math.min(1, p * 3)) * (p > 0.8 ? (1 - p) / 0.2 : 1);
      lookOverride = acts.shy.dir * 0.7 * env;
      rotX += 0.2 * env;
      rotZ += acts.shy.dir * 0.12 * env;
      tuck = env;
    }

    // 귀 쫑긋
    p = prog('ears', t);
    if (p >= 0) earWiggle += Math.sin(p * Math.PI * 6) * 0.2 * Math.sin(Math.PI * p);

    // 들려 있을 때 대롱대롱
    if (held) {
      sy *= 1.07;
      rotZ += Math.sin(t * 5) * 0.1;
      armLift = 1;
    }

    const sx = 1 / Math.sqrt(sy);
    squash.scale.set(sx, sy, sx);
    root.position.set(x, y, 0);
    shadow.position.x = x;
    shadow.scale.setScalar(1 - Math.min(Math.max(y, 0), 0.6) * 0.6);
    shadow.material.opacity = 1 - Math.min(Math.max(y, 0), 0.6) * 0.8;

    // 고개 (커서 따라보기 + 동작)
    const k = Math.min(1, dt * 6);
    const tx = sleeping ? 0 : lookOverride ?? look.tx;
    const ty = sleeping ? 0 : look.ty;
    look.x += (tx - look.x) * k;
    look.y += (ty - look.y) * k;
    current.rotation.y = look.x + rotY;
    current.rotation.x = look.y + rotX;
    current.rotation.z += (rotZ - current.rotation.z) * Math.min(1, dt * 12);
    // 천사 링은 머리 위에서 살랑살랑
    if (accessory) {
      for (const c of accessory.children) {
        if (!c.userData.bob) continue;
        c.position.y = baseTop + 0.2 + Math.sin(t * 2.2) * 0.03;
        c.rotation.y = Math.sin(t * 1.3) * 0.15;
      }
    }

    // 표정
    let name = 'normal';
    if (expr && t < expr.until) name = expr.name;
    else expr = null;
    if (sleeping && !expr) name = 'sleep';
    if (held && !expr) name = 'surprise';
    setExpression(name);

    // 눈 깜빡임 + 놀란 눈
    if (t > blinkAt && blinkStart < 0) blinkStart = t;
    let eyeY = 1;
    if (blinkStart >= 0) {
      const q = (t - blinkStart) / 0.16;
      if (q >= 1) {
        blinkStart = -1;
        blinkAt = t + 2 + Math.random() * 3.5;
        if (Math.random() < 0.2) blinkAt = t + 0.2; // 가끔 두 번 깜빡
      } else eyeY = Math.max(0.08, Math.abs(Math.cos(q * Math.PI)));
    }
    const eyeSize = name === 'surprise' ? 1.25 : name === 'sad' ? 0.85 : 1;
    for (const g of parts.eyes.open.children) {
      g.scale.set(eyeSize, eyeSize * eyeY, eyeSize);
    }

    // 볼터치
    const targetBlush = t < blushUntil ? 1 : 0.7;
    blush += (targetBlush - blush) * Math.min(1, dt * 4);
    for (const m of parts.blushes) m.opacity = blush;

    // 귀
    for (const e of parts.ears) {
      const droop = sleeping ? 0.15 : 0;
      e.group.rotation.z = e.base + e.side * (earWiggle + droop + 0.04 * Math.sin(t * 2.2 + e.side));
    }

    // 팔: 평소 살랑, 들기, 손 흔들기, 잘 때는 축
    for (const a of parts.arms) {
      let r = a.base + a.side * (sleeping ? -0.15 : 0.06 * Math.sin(t * 2.2));
      r += a.side * armLift * 1.3;
      r -= a.side * tuck * 0.55;
      // 콩콩 펀치 (양팔 번갈아)
      const pp = prog('punch', t);
      if (pp >= 0) r = a.base + a.side * (0.8 + 0.8 * Math.max(0, Math.sin(t * 18 + (a.side > 0 ? 0 : Math.PI))));
      const w = prog('wave', t);
      if (w >= 0 && a.side === 1) {
        r = a.base + 1.9 * Math.sin(Math.PI * Math.min(1, w * 3)) * (w < 0.85 ? 1 : (1 - w) / 0.15) + 0.35 * Math.sin(w * 30);
      }
      if (held) r = a.base + a.side * (1.1 + 0.4 * Math.sin(t * 14 + a.side));
      a.group.rotation.z = r;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  return {
    setType,
    setAccessory,
    // 캔버스 기준 커서 위치(px)
    // close: 손가락처럼 캐릭터 바로 앞에서 움직일 때 → 조금만 움직여도 확실히 따라보게
    lookAt(px, py, close = false) {
      if (!current) return;
      const c = charCenterPx();
      const kk = 1 / (unitPx() * (close ? 1.3 : 3));
      look.tx = THREE.MathUtils.clamp((px - c.x) * kk, -1, 1) * 0.5;
      look.ty = THREE.MathUtils.clamp((py - c.y) * kk, -1, 1) * 0.3;
    },
    // 캐릭터가 차지하는 영역 (캔버스 기준 px). 점프·이모티콘 자리만큼 위쪽 여유를 둔다.
    bounds(extraTop = 0) {
      if (!current) return null;
      const c = charCenterPx();
      const u = unitPx();
      const r = u * 1.2;
      // 위로: 귀 끝 + 점프·둥실 여유
      const up = (topExtent + 0.75) * u + extraTop;
      return { x: c.x - r, y: c.y - up, width: r * 2, height: up + r + u * 0.15 };
    },
    // 머리 위 (이모티콘 띄울 자리, 캔버스 기준 px)
    headPx() {
      const v = new THREE.Vector3(0, 1.0, 0);
      current.localToWorld(v);
      v.project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
    },
    hitTest(px, py) {
      if (!current) return false;
      const c = charCenterPx();
      const r = unitPx() * 1.15;
      const dx = px - c.x;
      const dy = py - c.y;
      return dx * dx + dy * dy < r * r;
    },
    // ---- 동작 ----
    // 귀가 긴 캐릭터(토끼)는 너무 높이 뛰면 귀가 화면 위로 잘려서 조금 낮게
    hop: (h = 0.5) => play('hop', 0.75, { h: topExtent > 1.6 ? Math.min(h, 0.4) : h }),
    spin: () => play('spin', 0.9),
    dance: (sec = 2.5) => play('dance', sec),
    wave: () => play('wave', 1.4),
    squish: () => play('squish', 0.6),
    nod: () => play('nod', 0.9),
    shake: () => play('shake', 1.0),
    wobble: (sec = 2) => play('wobble', sec),
    stretch: () => play('stretch', 1.4),
    tilt: () => play('tilt', 1.6, { dir: Math.random() < 0.5 ? -1 : 1 }),
    lookAround: () => play('lookAround', 2.2),
    jolt: () => play('jolt', 0.35),
    ears: () => play('ears', 1.4),
    wiggle: (sec = 1.6) => play('wiggle', sec),
    roll: () => play('roll', 1.1, { dir: Math.random() < 0.5 ? -1 : 1 }),
    cheer: (sec = 1.8) => play('cheer', sec),
    shy: (sec = 2.2) => play('shy', sec, { dir: Math.random() < 0.5 ? -1 : 1 }),
    punch: (sec = 1.4) => play('punch', sec),
    // ---- 표정 ----
    express(name, sec = 1.5) {
      expr = { name, until: now() + sec };
    },
    blush(sec = 2) {
      blushUntil = now() + sec;
    },
    setSleeping(v) {
      sleeping = v;
    },
    setHeld(v) {
      held = v;
    },
  };
}
