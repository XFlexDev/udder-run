import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Cow } from './cow';
import { Sfx } from './audio';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('is-touch');

// ---------- renderer / scene ----------
const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY_TOP = new THREE.Color(0x3b5bdb), SKY_MID = new THREE.Color(0xffa8a8), SKY_LOW = new THREE.Color(0xffd8a8);
scene.fog = new THREE.Fog(0xffc9b0, 45, 140);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

// sky dome
{
  const g = new THREE.SphereGeometry(300, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, mid: { value: SKY_MID }, low: { value: SKY_LOW } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vp;
      void main(){ float h = vp.y; vec3 c = mix(low, mid, smoothstep(-0.02, 0.12, h)); c = mix(c, top, smoothstep(0.12, 0.6, h));
      vec3 sd = normalize(vec3(0.6, 0.12, -0.8)); float s = max(dot(vp, sd), 0.); c += vec3(1.,.85,.6) * (pow(s, 400.)*2. + pow(s, 12.)*.25);
      gl_FragColor = vec4(c, 1.); }`,
  });
  scene.add(new THREE.Mesh(g, m));
}

const hemi = new THREE.HemisphereLight(0xffe3d0, 0x5a7a3a, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
sun.position.set(-6, 14, 8);
sun.castShadow = true;
sun.shadow.camera.left = -14; sun.shadow.camera.right = 22;
sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
sun.target.position.set(4, 0, 0);

// ---------- textures ----------
function noiseTex(base: string, dots: string[], size = 256, count = 2600, rep: [number, number] = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    g.fillStyle = dots[i % dots.length];
    const x = Math.random() * size, y = Math.random() * size;
    g.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const grassTex = noiseTex('#6fae4a', ['#5d9a3c', '#82c25a', '#4e8a33', '#93cf68'], 256, 5000, [60, 14]);
const dirtTex = noiseTex('#c99a66', ['#b8865a', '#d9ad7a', '#a87a50', '#e2bc8c'], 256, 3500, [100, 1]);

// ---------- ground ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 90), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(40, 0, -20); ground.receiveShadow = true;
scene.add(ground);
const path = new THREE.Mesh(new THREE.PlaneGeometry(400, 3.2), new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 }));
path.rotation.x = -Math.PI / 2; path.position.set(40, 0.01, 0); path.receiveShadow = true;
scene.add(path);

// hills
const hillMat = new THREE.MeshStandardMaterial({ color: 0x6f9e52, roughness: 1, flatShading: true });
for (let i = 0; i < 14; i++) {
  const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
  const r = 18 + Math.random() * 26;
  h.scale.set(r * 1.6, r * (0.35 + Math.random() * 0.25), r);
  h.position.set(-80 + i * 22 + Math.random() * 10, -2, -75 - Math.random() * 30);
  scene.add(h);
}

// ---------- scrolling scenery ----------
type Scroller = { obj: THREE.Object3D; span: number };
const scrollers: Scroller[] = [];
const SPAN = 160, BACK = -45;
const treeTrunk = new THREE.MeshStandardMaterial({ color: 0x7a4e2d, roughness: 0.9 });
const leafMats = [0x4f9a3a, 0x5cae45, 0x3f8a30, 0x76b84e].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2, 7), treeTrunk);
  trunk.position.y = 1; trunk.castShadow = true; g.add(trunk);
  const lm = leafMats[(Math.random() * leafMats.length) | 0];
  const n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 - i * 0.2, 1), lm);
    b.position.set((Math.random() - 0.5) * 0.6, 2.4 + i * 0.9, (Math.random() - 0.5) * 0.6);
    b.castShadow = true; g.add(b);
  }
  const s = 0.8 + Math.random() * 0.9; g.scale.setScalar(s);
  return g;
}
for (let i = 0; i < 34; i++) {
  const t = makeTree();
  const far = i % 3 !== 0;
  t.position.set(BACK + Math.random() * SPAN, 0, far ? -12 - Math.random() * 30 : -6 - Math.random() * 4);
  scene.add(t); scrollers.push({ obj: t, span: SPAN });
}
// fence along the back of the track
const postGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16);
const woodMat = new THREE.MeshStandardMaterial({ color: 0xb98557, roughness: 0.9 });
const POSTS = 56, POST_GAP = SPAN / POSTS;
const posts = new THREE.InstancedMesh(postGeo, woodMat, POSTS);
posts.castShadow = true; posts.receiveShadow = true;
scene.add(posts);
const postX = Array.from({ length: POSTS }, (_, i) => BACK + i * POST_GAP);
for (const y of [0.45, 0.85]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 0.09, 0.06), woodMat);
  rail.position.set(BACK + SPAN / 2, y, -2.6); rail.castShadow = true; scene.add(rail);
}
// grass tufts & flowers (instanced)
const TUFTS = 260;
const tuftGeo = new THREE.ConeGeometry(0.08, 0.45, 4); tuftGeo.translate(0, 0.22, 0);
const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0x7cc152, roughness: 1 }), TUFTS);
const tuftData = Array.from({ length: TUFTS }, () => ({ x: BACK + Math.random() * SPAN, z: Math.random() < 0.65 ? -(1.8 + Math.random() * 10) : 1.8 + Math.random() * 3.5, s: 0.6 + Math.random(), r: Math.random() * 6 }));
scene.add(tufts);
const FLOWERS = 90;
const flowerGeo = new THREE.SphereGeometry(0.08, 6, 4); flowerGeo.scale(1, 0.45, 1); flowerGeo.translate(0, 0.05, 0);
const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), FLOWERS);
const flowerData = Array.from({ length: FLOWERS }, () => ({ x: BACK + Math.random() * SPAN, z: Math.random() < 0.65 ? -(2 + Math.random() * 9) : 2 + Math.random() * 3.5 }));
const flowerCols = [0xffffff, 0xffd43b, 0xff8fab, 0xb197fc].map(c => new THREE.Color(c));
flowerData.forEach((_, i) => flowers.setColorAt(i, flowerCols[i % flowerCols.length]));
scene.add(flowers);
// clouds
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffd6c2, emissiveIntensity: 0.35, flatShading: true });
const clouds: THREE.Group[] = [];
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + Math.random() * 2, 1), cloudMat);
    b.position.set(k * 2.6, Math.random() * 1.2, Math.random() * 1.5); g.add(b);
  }
  g.position.set(-60 + i * 30, 22 + Math.random() * 14, -60 - Math.random() * 40);
  scene.add(g); clouds.push(g);
}

const dummy = new THREE.Object3D();
function layoutInstances() {
  for (let i = 0; i < POSTS; i++) { dummy.position.set(postX[i], 0.55, -2.6); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix); }
  posts.instanceMatrix.needsUpdate = true;
  tuftData.forEach((t, i) => { dummy.position.set(t.x, 0, t.z); dummy.rotation.set(0, t.r, 0.15); dummy.scale.setScalar(t.s); dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix); });
  tufts.instanceMatrix.needsUpdate = true;
  flowerData.forEach((f, i) => { dummy.position.set(f.x, 0, f.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); flowers.setMatrixAt(i, dummy.matrix); });
  flowers.instanceMatrix.needsUpdate = true;
}
const wrap = (x: number) => (x < BACK ? x + SPAN : x);

// ---------- cow ----------
const cow = new Cow();
scene.add(cow.root);
const blobShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
blobShadow.rotation.x = -Math.PI / 2; blobShadow.position.y = 0.02; blobShadow.scale.set(1.3, 0.8, 1);
scene.add(blobShadow);

// ---------- obstacles ----------
const hayMat = new THREE.MeshStandardMaterial({ map: noiseTex('#e8c35a', ['#d4a93f', '#f3d77a', '#c99a34'], 128, 1800, [2, 1]), roughness: 0.95 });
const hayEnd = new THREE.MeshStandardMaterial({ color: 0xd8b04c, roughness: 1 });
const redMat = new THREE.MeshStandardMaterial({ color: 0xd94848, roughness: 0.6 });
const whiteWood = new THREE.MeshStandardMaterial({ color: 0xf6efe4, roughness: 0.7 });
const canMat = new THREE.MeshStandardMaterial({ color: 0xc9d3dd, metalness: 0.8, roughness: 0.3 });

type Obstacle = { obj: THREE.Object3D; x: number; w: number; h: number; kind: string };
const obstacles: Obstacle[] = [];
function shadowAll(o: THREE.Object3D) { o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }
function hayBale(stack = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < stack; i++) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(1.1, 1.0, 1.6, 3, 0.14), hayMat);
    b.position.y = 0.5 + i * 1.0; b.rotation.y = (Math.random() - 0.5) * 0.15; g.add(b);
    const twine = new THREE.Mesh(new THREE.BoxGeometry(1.13, 1.03, 0.05), hayEnd);
    [-0.4, 0.4].forEach(z => { const t = twine.clone(); t.position.set(0, b.position.y, z); g.add(t); });
  }
  return shadowAll(g);
}
function roundBale() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.5, 24), [hayMat, hayEnd, hayEnd] as any);
  b.rotation.x = Math.PI / 2; b.position.y = 0.62; g.add(b);
  return shadowAll(g);
}
function fence() {
  const g = new THREE.Group();
  [-0.9, 0.9].forEach(z => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.35, 0.2), whiteWood); p.position.set(0, 0.67, z); g.add(p); });
  [0.45, 1.05].forEach(y => { const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 2.1), redMat); r.position.set(0, y, 0); g.add(r); });
  const x = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 2.3), whiteWood); x.position.y = 0.75; x.rotation.x = 0.55; g.add(x);
  return shadowAll(g);
}
function milkCans() {
  const g = new THREE.Group();
  [-0.35, 0.35].forEach((z, i) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 16), canMat); c.position.set(i * 0.1, 0.4, z); g.add(c);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.25, 0.25, 16), canMat); n.position.set(i * 0.1, 0.92, z); g.add(n);
  });
  return shadowAll(g);
}
function spawnObstacle(kind: string, x: number) {
  let obj: THREE.Object3D, w = 1, h = 1;
  switch (kind) {
    case 'tall': obj = hayBale(2); w = 1.1; h = 2.0; break;
    case 'round': obj = roundBale(); w = 1.2; h = 1.22; break;
    case 'fence': obj = fence(); w = 0.25; h = 1.2; break;
    case 'cans': obj = milkCans(); w = 0.65; h = 1.05; break;
    default: obj = hayBale(1); w = 1.1; h = 1.0;
  }
  obj.position.set(x, 0, 0);
  scene.add(obj);
  obstacles.push({ obj, x, w, h, kind });
}

// bells (collectibles)
const bellGeo = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0.32), new THREE.Vector2(0.12, 0.3), new THREE.Vector2(0.18, 0.15), new THREE.Vector2(0.22, -0.08), new THREE.Vector2(0.3, -0.2), new THREE.Vector2(0.0, -0.2)], 18);
const bellMat = new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 0.9, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 0.35 });
type Pickup = { obj: THREE.Mesh; x: number; y: number; taken: boolean };
const pickups: Pickup[] = [];
function spawnBell(x: number, y: number) {
  const m = new THREE.Mesh(bellGeo, bellMat); m.castShadow = true;
  m.position.set(x, y, 0); scene.add(m);
  pickups.push({ obj: m, x, y, taken: false });
}

// particles (milk splash, sparkles, dust)
const P_MAX = 160;
const pGeo = new THREE.SphereGeometry(1, 6, 4);
const pMesh = new THREE.InstancedMesh(pGeo, new THREE.MeshStandardMaterial({ roughness: 0.4 }), P_MAX);
pMesh.frustumCulled = false;
scene.add(pMesh);
type Part = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; s: number; grav: number; col: THREE.Color };
const parts: Part[] = [];
const MILK = new THREE.Color(0xffffff), GOLD = new THREE.Color(0xffd166), DUST = new THREE.Color(0xd8b48a);
function emit(pos: THREE.Vector3, n: number, col: THREE.Color, spread: number, up: number, size: number, grav = 30, life = 0.7) {
  for (let i = 0; i < n && parts.length < P_MAX; i++) {
    parts.push({ p: pos.clone(), v: new THREE.Vector3((Math.random() - 0.5) * spread - speed * 0.3, Math.random() * up, (Math.random() - 0.5) * spread), life, max: life, s: size * (0.6 + Math.random() * 0.8), grav, col });
  }
}

// ---------- game state ----------
const sfx = new Sfx();
let state: 'menu' | 'run' | 'dead' = 'menu';
let speed = 0, dist = 0, score = 0, bells = 0, best = Number(localStorage.getItem('udder.best') || 0);
let y = 0, vy = 0, jumpsLeft = 2, holding = false, grounded = true, wasCompressed = false;
let deadT = 0, spin = new THREE.Vector3(), tumble = new THREE.Vector3(), deadX = 0, deadVx = 0;
let nextSpawn = 0, shake = 0, comboTimer = 0, combo = 0;
const G = 42, JUMP_V = 14.5, DJUMP_V = 12.5, HOP_V = 4.6, GROUND_K = 900, GROUND_C = 18;
const BASE_SPEED = 12, MAX_SPEED = 30;

const scoreEl = $('score'), bestEl = $('best'), startEl = $('start'), overEl = $('over'), comboEl = $('combo');
bestEl.textContent = `BEST ${best}`;

function resetRun() {
  obstacles.forEach(o => scene.remove(o.obj)); obstacles.length = 0;
  pickups.forEach(p => scene.remove(p.obj)); pickups.length = 0;
  speed = BASE_SPEED; dist = 0; score = 0; bells = 0; y = 0; vy = 0; jumpsLeft = 2; nextSpawn = 30; combo = 0;
  cow.reset(); cow.root.position.x = 0; cow.root.rotation.set(0, 0, 0);
}

function startRun() {
  sfx.unlock();
  resetRun();
  state = 'run';
  startEl.classList.add('hidden'); overEl.classList.add('hidden');
  vy = JUMP_V * 0.8; sfx.boing(0.9);
}

function jump() {
  if (state !== 'run') return;
  if (jumpsLeft <= 0) return;
  const first = jumpsLeft === 2;
  vy = first ? Math.max(vy, JUMP_V) : DJUMP_V;
  jumpsLeft--;
  cow.shake(first ? 1.2 : 2.2);
  sfx.boing(first ? 1 : 1.35);
  if (!first) emit(new THREE.Vector3(0, y + 0.2, 0), 10, MILK, 4, 3, 0.07, 20, 0.5);
}

function die() {
  state = 'dead'; deadT = 0;
  vy = 11; deadX = 0; deadVx = -3;
  spin.set((Math.random() - 0.5) * 8, 0, 9 + Math.random() * 5);
  tumble.set(0, 0, 0);
  shake = 0.6;
  cow.shake(6);
  sfx.squish(1.5); sfx.moo();
  emit(new THREE.Vector3(0.6, y + 1, 0), 40, MILK, 10, 12, 0.1, 28, 1.1);
  emit(new THREE.Vector3(0.9, 0.6, 0), 24, GOLD, 8, 8, 0.06, 20, 0.6);
  if (score > best) { best = score; localStorage.setItem('udder.best', String(best)); }
  if (navigator.vibrate) navigator.vibrate(60);
  setTimeout(() => {
    $('final').textContent = String(score);
    $('finalBest').textContent = score >= best && score > 0 ? 'NEW BEST!' : `BEST ${best}`;
    bestEl.textContent = `BEST ${best}`;
    overEl.classList.remove('hidden');
  }, 900);
}

function popCombo(text: string) {
  comboEl.textContent = text; comboEl.classList.add('show'); comboTimer = 0.8;
}

function spawnPattern() {
  const diff = Math.min(1, dist / 1800);
  const r = Math.random();
  const x = 75;
  let len = 0;
  if (r < 0.1 + diff * 0.15 && dist > 250) { spawnObstacle('tall', x); len = 2; for (let i = 0; i < 3; i++) spawnBell(x - 1.5 + i * 1.5, 3.4 + Math.sin(i / 2 * Math.PI) * 0.8); }
  else if (r < 0.28 + diff * 0.15 && dist > 150) {
    const gap = 4.2 + Math.random() * 1.5 + speed * 0.12;
    spawnObstacle('bale', x); spawnObstacle(Math.random() < 0.5 ? 'cans' : 'bale', x + gap); len = gap + 1;
    spawnBell(x + gap / 2, 2.6);
  }
  else if (r < 0.48) { spawnObstacle('fence', x); len = 1; }
  else if (r < 0.62) { spawnObstacle('round', x); len = 1.3; }
  else if (r < 0.74) { spawnObstacle('cans', x); len = 1; spawnBell(x, 2.4); }
  else if (r < 0.86) { spawnObstacle('bale', x); len = 1.1; }
  else {
    for (let i = 0; i < 5; i++) spawnBell(x + i * 1.6, 1.0 + Math.sin(i / 4 * Math.PI) * 2.2);
    len = 8;
  }
  const minGap = speed * 0.62 + 5;
  nextSpawn = len + minGap + Math.random() * (speed * (0.9 - diff * 0.45) + 6);
}

// ---------- input ----------
function press() {
  sfx.unlock();
  if (state === 'menu') { startRun(); return; }
  if (state === 'dead') { if (deadT > 1.0) startRun(); return; }
  holding = true; jump();
}
function release() {
  holding = false;
  if (state === 'run' && vy > 5) vy *= 0.6;
}
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) press(); }
});
window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') release(); });
window.addEventListener('pointerdown', e => {
  if ((e.target as HTMLElement).closest('.ui')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault(); press();
}, { passive: false });
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden) last = 0; });

// ---------- settings / quality ----------
const qNames = ['Potato', 'Low', 'High', 'Ultra'];
const qEl = $<HTMLInputElement>('quality'), qLabel = $('qlabel'), soundEl = $<HTMLInputElement>('sound'), jigEl = $<HTMLInputElement>('jiggle');
const savedQ = localStorage.getItem('udder.q');
let quality = savedQ !== null ? Number(savedQ) : isTouch ? 1 : 2;
let autoQ = savedQ === null;
function applyQuality(q: number) {
  quality = q; qEl.value = String(q); qLabel.textContent = qNames[q];
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio([0.6, Math.min(dpr, 1), Math.min(dpr, 1.5), Math.min(dpr, 2)][q]);
  renderer.shadowMap.enabled = q >= 1;
  sun.castShadow = q >= 1;
  const ms = [256, 512, 1024, 2048][q];
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); sun.shadow.map?.dispose(); (sun.shadow as any).map = null; }
  blobShadow.visible = q === 0;
  tufts.count = [60, 140, 220, TUFTS][q];
  flowers.count = [20, 50, 70, FLOWERS][q];
  scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  resize();
}
qEl.addEventListener('input', () => { autoQ = false; localStorage.setItem('udder.q', qEl.value); applyQuality(Number(qEl.value)); });
soundEl.checked = localStorage.getItem('udder.sound') !== '0';
sfx.enabled = soundEl.checked;
soundEl.addEventListener('change', () => { sfx.enabled = soundEl.checked; localStorage.setItem('udder.sound', soundEl.checked ? '1' : '0'); });
jigEl.value = localStorage.getItem('udder.jiggle') ?? '1';
cow.jiggle = Number(jigEl.value);
jigEl.addEventListener('input', () => { cow.jiggle = Number(jigEl.value); localStorage.setItem('udder.jiggle', jigEl.value); cow.shake(3); });
$('gear').addEventListener('click', () => $('settings').classList.toggle('hidden'));

// ---------- camera framing ----------
const camBase = new THREE.Vector3(), camLook = new THREE.Vector3();
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const a = camera.aspect;
  if (a < 1) { // portrait: pull behind the cow so the track recedes into view
    camera.fov = 62;
    camBase.set(-8.6, 4.4, 3.9); camLook.set(5, 1.2, -0.3);
  } else {
    camera.fov = 45;
    camBase.set(-4.5, 3.4, 10.5); camLook.set(6, 1.3, -0.5);
  }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- loop ----------
let last = 0, fpsAcc = 0, fpsFrames = 0, fpsChecks = 0, time = 0;
const tmp = new THREE.Vector3();

function step(dt: number) {
  time += dt;
  const running = state === 'run';
  const scroll = running ? speed : state === 'menu' ? 7 : Math.max(0, speed * (1 - deadT * 1.5));

  if (running) {
    speed = Math.min(MAX_SPEED, BASE_SPEED + dist * 0.0075);
    dist += speed * dt;
    score = Math.floor(dist / 2) + bells * 25;
    scoreEl.textContent = String(score);
  }

  // cow vertical physics: gravity + squishy udder spring against the ground
  if (state !== 'dead') {
    const n = 4, h = dt / n;
    for (let i = 0; i < n; i++) {
      let a = -G * (holding && vy > 0 ? 0.72 : 1);
      if (y < 0) a += -y * GROUND_K - vy * GROUND_C;
      vy += a * h; y += vy * h;
      const compressed = y < 0;
      if (compressed && !wasCompressed) {
        const impact = -vy;
        jumpsLeft = 2; grounded = true;
        if (impact > 9) {
          cow.shake(Math.min(4, impact / 6));
          sfx.squish(impact / 14);
          cow.teatTips.forEach(t => { t.getWorldPosition(tmp); emit(tmp, 3 + ((impact / 5) | 0), MILK, 3, 4 + impact * 0.2, 0.06, 26, 0.55); });
          if (impact > 14) shake = Math.max(shake, 0.12);
        } else if (running || state === 'menu') sfx.plop();
        emit(new THREE.Vector3(0, 0.05, 0), 3, DUST, 2, 1.5, 0.12, 4, 0.5);
      }
      if (!compressed && wasCompressed) {
        // running on the udder: bounce off at least a little each step
        if (vy < HOP_V) vy = HOP_V * (state === 'menu' ? 1.2 : 1);
        grounded = false;
      }
      wasCompressed = compressed;
    }
  } else {
    deadT += dt;
    vy -= G * 0.8 * dt; y += vy * dt; deadX += deadVx * dt;
    if (y < 0) { y = 0; vy = Math.abs(vy) > 4 ? -vy * 0.45 : 0; spin.multiplyScalar(0.6); deadVx *= 0.6; if (Math.abs(vy) > 2) { cow.shake(3); sfx.squish(0.7); } }
    tumble.addScaledVector(spin, dt);
    cow.root.position.x = deadX;
    cow.root.rotation.set(tumble.x, 0, tumble.z);
  }
  cow.update(dt, y, vy, state === 'dead' ? 4 : scroll, state === 'dead');
  if (state !== 'dead') cow.root.rotation.z = THREE.MathUtils.lerp(cow.root.rotation.z, grounded ? 0 : THREE.MathUtils.clamp(vy * 0.02, -0.25, 0.25), 0.15);
  blobShadow.position.x = cow.root.position.x;
  const bs = 1 / (1 + Math.max(0, y) * 0.35); blobShadow.scale.set(1.3 * bs, 0.8 * bs, 1);

  // scroll world
  const dx = scroll * dt;
  grassTex.offset.x += dx / (400 / 60);
  dirtTex.offset.x += dx / (400 / 100);
  for (const s of scrollers) { s.obj.position.x -= dx; if (s.obj.position.x < BACK) s.obj.position.x += s.span; }
  for (let i = 0; i < POSTS; i++) postX[i] = wrap(postX[i] - dx);
  tuftData.forEach(t => (t.x = wrap(t.x - dx)));
  flowerData.forEach(f => (f.x = wrap(f.x - dx)));
  layoutInstances();
  clouds.forEach(c => { c.position.x -= dx * 0.05 + dt * 0.6; if (c.position.x < -110) c.position.x += 260; });

  // spawn
  if (running) {
    nextSpawn -= dx;
    if (nextSpawn <= 0) spawnPattern();
  }

  // obstacles + collision
  const cowL = -0.75, cowR = 1.15, cowB = Math.max(0, y) + 0.12, cowT = Math.max(0, y) + 2.0;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= dx; o.obj.position.x = o.x;
    if (running) {
      const l = o.x - o.w / 2 + 0.08, r = o.x + o.w / 2 - 0.08, top = o.h - 0.08;
      if (r > cowL && l < cowR && cowB < top && cowT > 0) {
        // landing on top from above is a hard bounce, not a crash
        if (vy < 0 && cowB > top - 0.35) { y = top + 0.01; vy = JUMP_V * 0.75; jumpsLeft = 1; cow.shake(2.5); sfx.boing(0.8); popCombo('BOUNCE!'); score += 10; bells += 0.4; }
        else die();
      }
    }
    if (o.x < -25) { scene.remove(o.obj); obstacles.splice(i, 1); }
  }
  const cy = Math.max(0, y) + 1.1;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.x -= dx; p.obj.position.x = p.x;
    p.obj.rotation.y += dt * 4;
    p.obj.position.y = p.y + Math.sin(time * 4 + p.x) * 0.12;
    if (!p.taken && running && Math.abs(p.x - 0.2) < 1.2 && Math.abs(p.obj.position.y - cy) < 1.3) {
      p.taken = true; bells++; combo++;
      sfx.bell();
      emit(p.obj.position, 12, GOLD, 5, 5, 0.06, 10, 0.5);
      popCombo(combo > 2 ? `+25 ×${combo}` : '+25');
    }
    if (p.taken) { p.obj.scale.multiplyScalar(0.8); p.obj.position.y += dt * 6; }
    if (p.x < -25 || p.obj.scale.x < 0.02) { scene.remove(p.obj); pickups.splice(i, 1); }
  }
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) { comboEl.classList.remove('show'); combo = 0; } }

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.v.y -= p.grav * dt; p.p.addScaledVector(p.v, dt);
    if (p.p.y < 0.03) { p.p.y = 0.03; p.v.set(-scroll, 0, 0); }
  }
  for (let i = 0; i < P_MAX; i++) {
    const p = parts[i];
    if (p) { dummy.position.copy(p.p); dummy.scale.setScalar(p.s * Math.min(1, (p.life / p.max) * 2)); pMesh.setColorAt(i, p.col); }
    else dummy.scale.setScalar(0);
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pMesh.setMatrixAt(i, dummy.matrix);
  }
  pMesh.count = Math.max(1, parts.length);
  pMesh.instanceMatrix.needsUpdate = true;
  if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;

  // camera
  shake = Math.max(0, shake - dt * 1.5);
  const follow = Math.max(0, y) * (camera.aspect < 1 ? 0.6 : 0.35);
  const sway = Math.sin(time * 0.4) * 0.3;
  tmp.set(camBase.x + sway, camBase.y + follow, camBase.z);
  if (state === 'dead') tmp.x += Math.min(deadT, 1) * 1.5;
  camera.position.lerp(tmp, 1 - Math.pow(0.001, dt));
  camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
  camera.lookAt(camLook.x + (state === 'dead' ? deadX * 0.5 - Math.min(deadT, 1) * 2 : 0), camLook.y + follow * 0.7, camLook.z);
}

function frame(t: number) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  let dt = last ? now - last : 1 / 60;
  last = now;
  dt = Math.min(dt, 1 / 30);
  step(dt);
  renderer.render(scene, camera);

  // auto-drop quality if the device can't keep up
  if (autoQ) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 2.5) {
      const fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; fpsChecks++;
      if (fps < 48 && quality > 0) applyQuality(quality - 1);
      if (fpsChecks > 6) autoQ = false;
    }
  }
}

applyQuality(quality);
layoutInstances();
requestAnimationFrame(frame);

// debug hook for automated screenshots: ?debug
if (new URLSearchParams(location.search).has('debug')) {
  (window as any).__game = { startRun, jump, die, step, get state() { return state; }, setY: (v: number) => { y = v; vy = 0; }, spawnObstacle, spawnBell, cow };
}
