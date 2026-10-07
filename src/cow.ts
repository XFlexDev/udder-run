import * as THREE from 'three';

/** Damped spring; display through out() for a soft limit instead of hard clamping. */
class Spring {
  x = 0; v = 0;
  constructor(public k: number, public c: number, public lim = 1) {}
  step(dt: number, force: number) {
    // Semi-implicit spring with bounded drive/velocity. The old unbounded
    // landing impulse could cross the soft limit in one frame and look like a snap.
    const drive = THREE.MathUtils.clamp(force, -360, 360);
    this.v += (-this.k * this.x - this.c * this.v + drive) * dt;
    this.v = THREE.MathUtils.clamp(this.v, -24, 24);
    this.x += this.v * dt;
  }
  out() { return this.lim * Math.tanh(this.x / this.lim); }
  kick(v: number) { this.v += v; }
  reset() { this.x = 0; this.v = 0; }
}
class Spring2 { a: Spring; b: Spring; constructor(k: number, c: number, lim: number) { this.a = new Spring(k, c, lim); this.b = new Spring(k * 0.93, c, lim); } }

function spotsTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf6ee'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#1b1416';
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 10; i++) {
    const cx = rnd() * 512, cy = 40 + rnd() * 176, r = 22 + rnd() * 34;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.25) {
      const rr = r * (0.75 + 0.35 * Math.sin(a * 3 + i) * Math.cos(a * 2 - i));
      const px = cx + Math.cos(a) * rr * 1.2, py = cy + Math.sin(a) * rr;
      a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

type Jelly = { off: THREE.Vector3; ripple: { value: number }; time: { value: number } };
type Fx = { wob: number; rim: number; rimCol?: number; shine?: number };

/** Shared by every cow material: animation clock and overall per-vertex wobble strength. */
const fxTime = { value: 0 };
const fxWob = { value: 0.02 };
let fxId = 0;

/**
 * Cow surface shader: every vertex wobbles along its normal (so all polys stay
 * connected), optional jelly lag above `bottom`, plus a cartoon rim light and highlight.
 */
function jellify(mat: THREE.Material, fx: Fx, bottom = -99, top = -98): Jelly {
  const off = new THREE.Vector3();
  const ripple = { value: 0 }, time = fxTime;
  const id = fxId++;
  mat.customProgramCacheKey = () => `cowfx${id}`;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, {
      uOff: { value: off }, uRipple: ripple, uTime: fxTime, uWob: fxWob,
      uWobK: { value: fx.wob }, uRim: { value: fx.rim },
      uRimCol: { value: new THREE.Color(fx.rimCol ?? 0xfff1e6) }, uShine: { value: fx.shine ?? 0.12 },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uOff; uniform float uRipple; uniform float uTime; uniform float uWob; uniform float uWobK;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float jw = smoothstep(${bottom.toFixed(3)}, ${top.toFixed(3)}, position.y);
        transformed += uOff * jw * jw;
        vec3 wp = position * 6.0;
        float wob = sin(wp.x * 1.3 + uTime * 5.1) * sin(wp.y * 1.1 - uTime * 4.3) * sin(wp.z * 1.2 + uTime * 3.7)
                  + 0.5 * sin(wp.x * 2.3 - wp.z * 1.7 + uTime * 6.7);
        transformed += normal * (wob * uWob * uWobK + sin(position.x * 7.0 + position.y * 5.0 - uTime * 18.0) * uRipple * jw);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim; uniform vec3 uRimCol; uniform float uShine;')
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
        float spot = smoothstep(0.82, 0.9, dot(normal, normalize(vec3(-0.35, 0.75, 0.55))));
        outgoingLight += uRimCol * fres * uRim + vec3(1.0, 0.97, 0.93) * spot * uShine;
        #include <opaque_fragment>`);
  };
  return { off, ripple, time };
}

export class Cow {
  root = new THREE.Group();
  private pivot = new THREE.Group();
  private inner = new THREE.Group();
  private udder = new THREE.Group();
  private udderMesh: THREE.Mesh;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private tongue = new THREE.Group();
  private cheeks: THREE.Mesh[] = [];
  private ears: THREE.Group[] = [];
  private teats: THREE.Group[] = [];
  private legs: { upper: THREE.Group; lower: THREE.Group; s1: Spring2; s2: Spring2; side: number; front: number }[] = [];
  private tail: THREE.Group[] = [];
  private bell = new THREE.Group();
  private eyes: { pupil: THREE.Mesh; s: Spring2; side: number; lid: THREE.Mesh }[] = [];
  private uJ: Jelly; private bJ: Jelly; private hJ: Jelly;

  private uY = new Spring(100, 2.8, 0.34);
  private uX = new Spring(75, 1.3, 0.48);
  private uZ = new Spring(75, 1.3, 0.42);
  private bY = new Spring(110, 3.0, 0.15);
  private bX = new Spring(80, 1.4, 0.6);
  private bZ = new Spring(80, 1.4, 0.5);
  private bP = new Spring(90, 2.0, 0.42);
  private hY = new Spring(110, 2.0, 0.36);
  private hP = new Spring(85, 1.6, 0.7);
  private earS = [new Spring(55, 1.0, 1.7), new Spring(60, 1.1, 1.7)];
  private teatS = [0, 1, 2, 3].map(i => new Spring2(70 + i * 7, 1.1, 1.4));
  private tailS = [new Spring(48, 1.1, 1.3), new Spring(42, 0.9, 1.5), new Spring(36, 0.8, 1.7)];
  private bellS = new Spring(45, 0.8, 1.6);
  private tongueS = new Spring(48, 1.0, 1.5);
  private cheekS = new Spring(100, 1.8, 0.7);
  private lastVy = 0;
  private smoothAy = 0;
  private motionReady = false;
  private t = 0;
  private blink = 2;
  private tongueOut = 0;
  jiggle = 1;
  spin = 0;
  teatTips: THREE.Object3D[] = [];
  readonly pivotY = 1.75;

  constructor() {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    const white = std({ color: 0xfbf6ee, roughness: 0.7 });
    const black = std({ color: 0x1b1416, roughness: 0.5 });
    const bodyMat = std({ map: spotsTexture(), roughness: 0.7 });
    const headMat = std({ color: 0xfbf6ee, roughness: 0.7 });
    const pink = new THREE.MeshPhysicalMaterial({ color: 0xff9fb2, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.3, sheen: 0.6, sheenColor: new THREE.Color(0xffd0da) });
    const pinkDark = std({ color: 0xf07c96, roughness: 0.45 });
    const snoutMat = std({ color: 0xffb3c1, roughness: 0.5 });
    const tongueMat = std({ color: 0xff5d84, roughness: 0.35 });
    const horn = std({ color: 0xf2e2c2, roughness: 0.5 });
    const hoof = std({ color: 0x3a2a26, roughness: 0.5 });
    const gold = std({ color: 0xffc94a, metalness: 0.85, roughness: 0.28 });
    const eyeW = std({ color: 0xffffff, roughness: 0.15 });
    jellify(white, { wob: 0.8, rim: 0.4 });
    jellify(black, { wob: 0.6, rim: 0.3, rimCol: 0xb9a4ff });
    jellify(pinkDark, { wob: 1.2, rim: 0.45, rimCol: 0xffd6e0, shine: 0.25 });
    jellify(snoutMat, { wob: 0.8, rim: 0.4, rimCol: 0xffd6e0, shine: 0.2 });
    jellify(tongueMat, { wob: 1.4, rim: 0.35, shine: 0.3 });
    jellify(eyeW, { wob: 0.25, rim: 0.2, shine: 0.4 });
    jellify(horn, { wob: 0, rim: 0.3 });
    jellify(hoof, { wob: 0, rim: 0.25 });
    jellify(gold, { wob: 0, rim: 0.5, rimCol: 0xffe08a, shine: 0.3 });
    const sh = <T extends THREE.Object3D>(m: T) => { m.castShadow = true; m.receiveShadow = true; return m; };

    this.root.add(this.pivot);
    this.pivot.position.y = this.pivotY;
    this.pivot.add(this.inner);
    this.inner.position.y = -this.pivotY;

    // ---- udder (the cow's one true foot) ----
    this.uJ = jellify(pink, { wob: 1.25, rim: 0.55, rimCol: 0xffd6e0, shine: 0.3 }, -0.6, 0.75);
    this.udderMesh = sh(new THREE.Mesh(new THREE.SphereGeometry(0.72, 48, 32), pink));
    this.udder.add(this.udderMesh);
    this.inner.add(this.udder);
    const teatGeo = new THREE.CapsuleGeometry(0.1, 0.28, 6, 14); teatGeo.translate(0, -0.2, 0);
    ([[0.22, 0.22], [0.22, -0.22], [-0.22, 0.22], [-0.22, -0.22]] as const).forEach(([x, z]) => {
      const tg = new THREE.Group();
      // Keep teats around the lower sides, not under the contact patch.
      tg.position.copy(new THREE.Vector3(x, -0.28, z).normalize().multiplyScalar(0.67));
      tg.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(x * 2.8, -0.12, z * 2.8).normalize());
      tg.add(sh(new THREE.Mesh(teatGeo, pinkDark)));
      const tip = new THREE.Object3D(); tip.position.y = -0.4; tg.add(tip);
      this.teatTips.push(tip);
      tg.userData.base = tg.quaternion.clone();
      this.udderMesh.add(tg); this.teats.push(tg);
    });

    // ---- big round body ----
    const bodyGeo = new THREE.SphereGeometry(1, 56, 36); bodyGeo.scale(1.28, 0.92, 1.05);
    this.bJ = jellify(bodyMat, { wob: 1, rim: 0.45 }, -0.9, 0.95);
    this.body.add(sh(new THREE.Mesh(bodyGeo, bodyMat)));
    this.inner.add(this.body);

    // ---- floppy stubby legs (never walk, only jiggle) ----
    const upperGeo = new THREE.CapsuleGeometry(0.15, 0.2, 6, 14); upperGeo.translate(0, -0.14, 0);
    const lowerGeo = new THREE.CapsuleGeometry(0.13, 0.14, 6, 14); lowerGeo.translate(0, -0.1, 0);
    const hoofGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.12, 16);
    ([[0.72, 0.62], [0.72, -0.62], [-0.72, 0.62], [-0.72, -0.62]] as const).forEach(([x, z], i) => {
      const upper = new THREE.Group();
      upper.position.set(x, -0.42, z);
      upper.add(sh(new THREE.Mesh(upperGeo, i === 1 ? black : white)));
      const lower = new THREE.Group(); lower.position.y = -0.3;
      lower.add(sh(new THREE.Mesh(lowerGeo, white)));
      const hf = sh(new THREE.Mesh(hoofGeo, hoof)); hf.position.y = -0.24; lower.add(hf);
      upper.add(lower);
      this.body.add(upper);
      this.legs.push({ upper, lower, s1: new Spring2(42 + i * 5, 0.8, 1.5), s2: new Spring2(55 + i * 4, 0.9, 1.7), side: Math.sign(z), front: Math.sign(x) });
    });

    // ---- head ----
    this.head.position.set(1.22, 0.42, 0);
    this.body.add(this.head);
    const skullGeo = new THREE.SphereGeometry(0.5, 40, 28); skullGeo.scale(1.0, 0.92, 1.0);
    this.hJ = jellify(headMat, { wob: 0.7, rim: 0.45 }, -0.4, 0.5);
    const skull = sh(new THREE.Mesh(skullGeo, headMat)); skull.position.set(0.12, 0.1, 0);
    this.head.add(skull);
    const patch = sh(new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), black));
    patch.scale.set(0.9, 0.85, 0.4); patch.position.set(0.2, 0.32, -0.33); patch.rotation.y = 0.5; this.head.add(patch);
    const snout = sh(new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 22), snoutMat));
    snout.scale.set(0.8, 0.7, 1.05); snout.position.set(0.52, -0.08, 0); this.head.add(snout);
    [-0.14, 0.14].forEach(z => {
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), black);
      n.position.set(0.79, -0.02, z); n.scale.set(0.45, 1.1, 0.9); this.head.add(n);
    });
    [-1, 1].forEach(s => {
      const ch = sh(new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), headMat));
      ch.position.set(0.3, -0.12, s * 0.34); this.head.add(ch); this.cheeks.push(ch);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), std({ color: 0xff8fab, transparent: true, opacity: 0.7, roughness: 1 }));
      blush.position.set(0.36, -0.1, s * 0.49); blush.rotation.y = s > 0 ? 0.4 : Math.PI - 0.4; this.head.add(blush);
    });
    this.jaw.position.set(0.48, -0.28, 0); this.head.add(this.jaw);
    const jawM = sh(new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), snoutMat)); jawM.scale.set(1.05, 0.4, 1.2); this.jaw.add(jawM);
    this.tongue.position.set(0.12, 0.02, 0.08); this.jaw.add(this.tongue);
    const tg = new THREE.CapsuleGeometry(0.07, 0.24, 6, 12); tg.translate(0, -0.15, 0);
    const tm = sh(new THREE.Mesh(tg, tongueMat)); tm.scale.set(1, 1, 1.5); this.tongue.add(tm);

    // googly eyes
    [1, -1].forEach(s => {
      const e = new THREE.Group();
      e.position.set(0.38, 0.3, s * 0.26);
      const w = sh(new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), eyeW));
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), black);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeW); glint.position.set(0.05, 0.04, 0.03); pupil.add(glint);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.178, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2), headMat);
      lid.rotation.z = -Math.PI / 2 + 0.2; lid.scale.y = 0.02;
      e.add(w, pupil, lid);
      this.head.add(e);
      this.eyes.push({ pupil, s: new Spring2(32, 0.6, 1.2), side: s, lid });
    });
    [-1, 1].forEach(s => {
      const h = sh(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 12), horn));
      h.position.set(0.0, 0.58, s * 0.24); h.rotation.x = s * -0.55; this.head.add(h);
      const ear = new THREE.Group();
      ear.position.set(-0.05, 0.35, s * 0.42);
      const em = sh(new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), s > 0 ? black : headMat));
      em.scale.set(0.55, 0.22, 1); em.position.z = s * 0.18;
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), pinkDark);
      inner.scale.set(0.45, 0.12, 0.85); inner.position.set(0.02, 0.03, s * 0.18);
      ear.add(em, inner); ear.userData.side = s;
      this.head.add(ear); this.ears.push(ear);
    });

    // cowbell
    this.bell.position.set(1.05, -0.2, 0);
    this.body.add(this.bell);
    const bm = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.24, 18, 1, true), gold));
    bm.position.y = -0.14; (bm.material as THREE.Material).side = THREE.DoubleSide;
    const clap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), gold); clap.position.y = -0.26;
    this.bell.add(bm, clap);

    // tail
    let parent: THREE.Object3D = this.body;
    const segGeo = new THREE.CapsuleGeometry(0.045, 0.24, 4, 8); segGeo.translate(0, -0.14, 0);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Group();
      s.position.set(i === 0 ? -1.22 : 0, i === 0 ? 0.3 : -0.28, 0);
      s.add(sh(new THREE.Mesh(segGeo, white)));
      if (i === 2) { const tuft = sh(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), black)); tuft.position.y = -0.32; tuft.scale.set(0.8, 1.3, 0.8); s.add(tuft); }
      parent.add(s); this.tail.push(s); parent = s;
    }
  }

  private all() {
    return [this.uY, this.uX, this.uZ, this.bY, this.bX, this.bZ, this.bP, this.hY, this.hP, this.bellS, this.tongueS, this.cheekS,
      ...this.earS, ...this.tailS, ...this.teatS.flatMap(s => [s.a, s.b]), ...this.legs.flatMap(l => [l.s1.a, l.s1.b, l.s2.a, l.s2.b]), ...this.eyes.flatMap(e => [e.s.a, e.s.b])];
  }
  reset() {
    this.all().forEach(s => s.reset());
    this.root.rotation.set(0, 0, 0);
    this.spin = 0; this.lastVy = 0; this.smoothAy = 0; this.motionReady = false; this.tongueOut = 0;
  }

  /** shove every spring in a random direction */
  shake(amount: number) {
    const a = amount * this.jiggle * 1.7;
    const r = () => (Math.random() * 2 - 1) * a;
    this.uX.kick(r() * 3); this.uZ.kick(r() * 3); this.uY.kick(-Math.abs(a) * 2);
    this.bX.kick(r() * 2); this.bZ.kick(r() * 2);
    this.hP.kick(r() * 4); this.bellS.kick(r() * 6); this.tongueS.kick(r() * 6);
    this.earS.forEach(s => s.kick(r() * 10));
    this.teatS.forEach(p => { p.a.kick(r() * 9); p.b.kick(r() * 9); });
    this.tailS.forEach(s => s.kick(r() * 8));
    this.legs.forEach(l => { l.s1.a.kick(r() * 8); l.s1.b.kick(r() * 8); l.s2.a.kick(r() * 10); l.s2.b.kick(r() * 10); });
    this.eyes.forEach(e => { e.s.a.kick(r() * 12); e.s.b.kick(r() * 12); });
  }
  /** pre-jump stretch: udder springs up, body sinks then follows */
  launch(power: number) {
    const J = this.jiggle;
    this.uY.kick(8 * power * J); this.bY.kick(-3.5 * power * J); this.hY.kick(-3 * power * J); this.cheekS.kick(6 * power * J);
    this.legs.forEach(l => { l.s1.a.kick(-l.side * 9 * power * J); l.s2.a.kick(l.side * 12 * power * J); });
    this.earS.forEach(e => e.kick(-12 * power * J));
    this.tongueOut = 1;
  }
  land(power: number) {
    const J = this.jiggle;
    this.cheekS.kick(-9 * power * J); this.bY.kick(-2.5 * power * J); this.hY.kick(-2.5 * power * J);
    this.legs.forEach(l => { l.s1.a.kick(l.side * 10 * power * J); l.s2.a.kick(-l.side * 14 * power * J); });
    this.shake(power);
  }

  update(dt: number, y: number, vy: number, speed: number, dead: boolean) {
    this.t += dt;
    const rawAy = this.motionReady ? THREE.MathUtils.clamp((vy - this.lastVy) / Math.max(dt, 1e-4), -150, 150) : 0;
    this.motionReady = true;
    this.lastVy = vy;
    // Low-pass the physics impulse before it reaches the visual rig. This keeps
    // hard landings juicy without a one-frame pose discontinuity.
    this.smoothAy += (rawAy - this.smoothAy) * (1 - Math.exp(-dt * 13));
    const ay = this.smoothAy;
    const J = 0.7 + this.jiggle * 0.65;
    const spinV = Math.sin(this.spin) * 30;

    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    const wob = Math.sin(this.t * 7.5);
    for (let i = 0; i < n; i++) {
      this.uY.step(h, -ay * 0.6 * J);
      this.uX.step(h, (wob * 5 - speed * 0.25 + spinV) * J);
      this.uZ.step(h, Math.cos(this.t * 4.1) * 4 * J);
      this.bY.step(h, -ay * 0.22 * J);
      this.bX.step(h, (-ay * 0.01 + this.uX.v * 6 - spinV * 0.5) * J);
      this.bZ.step(h, (this.uZ.v * 6 + Math.sin(this.t * 3.3) * 2) * J);
      this.bP.step(h, (ay * 0.012 + wob * 1.2) * J);
      this.hY.step(h, -ay * 0.3 * J);
      this.hP.step(h, (ay * 0.035 - spinV * 0.2) * J);
      this.cheekS.step(h, -ay * 0.08 * J);
      this.tongueS.step(h, (-ay * 0.06 + this.hY.v * 20 + speed * 0.5) * J);
      this.earS.forEach((s, k) => s.step(h, (-ay * 0.06 + this.hY.v * 28 + Math.sin(this.t * 9 + k) * 5) * J));
      this.tailS.forEach((s, k) => s.step(h, (-ay * 0.03 * (k + 1) + this.uX.v * 30 + speed * 0.9 + Math.sin(this.t * 7 - k) * 4) * J));
      this.bellS.step(h, (this.bY.v * 40 - this.uX.v * 25 + spinV) * J);
      this.teatS.forEach((p, k) => {
        p.a.step(h, (this.uX.v * 60 + this.uY.v * 22 * (k < 2 ? 1 : -1)) * J);
        p.b.step(h, (this.uZ.v * 60 + this.uY.v * 26 * (k % 2 ? 1 : -1)) * J);
      });
      this.legs.forEach((l, k) => {
        const f = -ay * 0.05 * J;
        l.s1.a.step(h, (f * l.side + this.bZ.v * 25 + Math.sin(this.t * 5 + k) * 2) * J);
        l.s1.b.step(h, (f * 0.6 * l.front + this.bX.v * 20 - speed * 0.12 + spinV * 0.4) * J);
        l.s2.a.step(h, (l.s1.a.v * 14) * J);
        l.s2.b.step(h, (l.s1.b.v * 14) * J);
      });
      this.eyes.forEach((e, k) => {
        e.s.a.step(h, (-ay * 0.05 + this.hY.v * 30 + spinV * 0.5) * J);
        e.s.b.step(h, (this.hP.v * 30 * (k ? 1 : -1) + Math.sin(this.t * 2 + k * 3) * 2) * J);
      });
    }

    // udder squash against the ground (volume preserving) + jelly lag
    const comp = THREE.MathUtils.clamp(-y, 0, 0.5);
    const stretch = this.uY.out() * 0.9;
    const sy = THREE.MathUtils.clamp(1 - comp * 1.1 + stretch, 0.68, 1.3);
    const sxz = 1 / Math.sqrt(sy);
    this.root.position.y = Math.max(0, y);
    this.udderMesh.scale.set(1.1 * sxz, sy, 1.05 * sxz);
    this.udder.position.set(this.uX.out() * 0.45, 0.72 * sy, this.uZ.out() * 0.45);
    this.uJ.off.set(this.uX.out() * 0.8, this.uY.out() * 0.45, this.uZ.out() * 0.8);
    this.uJ.ripple.value = (0.012 + Math.min(0.1, Math.abs(this.uY.v) * 0.012)) * this.jiggle;
    fxTime.value = this.t;
    const wobT = (0.02 + Math.min(0.05, Math.abs(this.uY.v) * 0.012 + Math.abs(this.bY.v) * 0.015)) * this.jiggle;
    fxWob.value += (wobT - fxWob.value) * (1 - Math.exp(-dt * 8));
    this.teats.forEach((t, k) => {
      const q = (t.userData.base as THREE.Quaternion).clone();
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.teatS[k].b.out(), 0, -this.teatS[k].a.out())));
      t.quaternion.copy(q);
      const tuck = THREE.MathUtils.lerp(1, 0.72, comp / 0.5);
      t.scale.set(tuck, tuck, tuck);
    });

    const bsq = THREE.MathUtils.clamp(1 - this.bY.out() * 1.15 + comp * 0.12, 0.84, 1.16);
    // Anchor the belly to the top of the udder. Previously the two scales used
    // unrelated formulas, so they crossed deeply or visibly separated.
    const bodyY = 1.44 * sy + 0.92 * bsq - 0.38 + this.bY.out() * 0.25;
    this.body.position.set(0, bodyY, 0);
    const bw = 1 / Math.sqrt(Math.max(0.45, bsq));
    this.body.scale.set(bw, bsq, bw);
    this.body.rotation.z = this.bP.out() + (dead ? 0 : THREE.MathUtils.clamp(vy * 0.01, -0.18, 0.18));
    this.body.rotation.x = this.uZ.out() * 0.3 + this.bZ.out() * 0.25;
    this.bJ.off.set(this.bX.out() * 0.85, this.bY.out() * 1.0, this.bZ.out() * 0.85);
    this.bJ.ripple.value = (0.01 + Math.min(0.08, Math.abs(this.bY.v) * 0.01 + Math.abs(this.bX.v) * 0.004)) * this.jiggle;

    this.head.position.y = 0.42 + this.hY.out();
    this.head.rotation.z = this.hP.out() * 0.7 + Math.sin(this.t * 3.7) * 0.04;
    this.hJ.off.set(this.hP.out() * 0.3, this.hY.out() * 1.0, this.bZ.out() * 0.3);
    this.hJ.ripple.value = Math.min(0.05, Math.abs(this.hY.v) * 0.008) * this.jiggle;
    const cs = 1 + THREE.MathUtils.clamp(this.cheekS.out(), -0.4, 0.7);
    this.cheeks.forEach(c => c.scale.set(cs, 1 / Math.sqrt(cs), cs));

    // tongue flops out when airborne
    const air = y > 0.25 || dead;
    this.tongueOut = THREE.MathUtils.lerp(this.tongueOut, air ? 1 : 0, 1 - Math.exp(-dt * (air ? 10 : 6)));
    this.tongue.scale.setScalar(Math.max(0.001, this.tongueOut));
    this.tongue.rotation.z = 0.9 + this.tongueS.out() * 0.9;
    this.tongue.rotation.x = Math.sin(this.t * 13) * 0.3 * this.tongueOut;
    this.jaw.rotation.z = -Math.max(0, this.hY.out() * 2) - this.tongueOut * 0.35 - (dead ? 0.3 : 0);

    this.ears.forEach((e, k) => {
      const s = e.userData.side as number;
      e.rotation.x = s * (0.35 + this.earS[k].out() * 1.1);
      e.rotation.y = s * this.earS[k].out() * 0.45;
    });
    this.tail[0].rotation.z = -0.4 - this.tailS[0].out() * 0.6;
    this.tail[1].rotation.z = -this.tailS[1].out() * 0.7;
    this.tail[2].rotation.z = -this.tailS[2].out() * 0.8;
    this.tail.forEach((s, k) => (s.rotation.x = Math.sin(this.t * 6 - k) * 0.25));
    this.bell.rotation.z = this.bellS.out() * 0.9;

    this.legs.forEach(l => {
      l.upper.rotation.x = l.side * 0.45 + l.s1.a.out() * 1.1;
      l.upper.rotation.z = l.front * 0.15 + l.s1.b.out() * 1.1;
      l.lower.rotation.x = l.s2.a.out() * 1.2;
      l.lower.rotation.z = l.s2.b.out() * 1.2;
    });

    // googly pupils roll around the eyeball
    this.blink -= dt;
    const closed = (this.blink < 0.1 && !dead) ? 1 : 0;
    this.eyes.forEach(e => {
      const dy = THREE.MathUtils.clamp(e.s.a.out() * 1.1, -1, 1), dz = THREE.MathUtils.clamp(e.s.b.out() * 1.1, -1, 1);
      const dir = new THREE.Vector3(1, dy * 1.2 - 0.15, e.side * 0.35 + dz * 1.2);
      if (dead) dir.set(1, Math.sin(this.t * 14 + e.side), Math.cos(this.t * 14 + e.side) * e.side);
      dir.normalize();
      e.pupil.position.copy(dir.multiplyScalar(0.12));
      e.lid.scale.y = closed ? 1 : 0.02;
    });
    if (this.blink < 0) this.blink = 1.5 + Math.random() * 3;

    this.pivot.rotation.z = this.spin;
  }
}
