import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

class Spring {
  x = 0; v = 0;
  constructor(public k: number, public c: number, public lim = 1) {}
  step(dt: number, force: number) {
    this.v += (-this.k * this.x - this.c * this.v + force) * dt;
    this.x += this.v * dt;
    if (this.x > this.lim) { this.x = this.lim; if (this.v > 0) this.v *= -0.3; }
    if (this.x < -this.lim) { this.x = -this.lim; if (this.v < 0) this.v *= -0.3; }
  }
  kick(v: number) { this.v += v; }
  reset() { this.x = 0; this.v = 0; }
}

function spotsTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf6ee'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#1b1416';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const cx = rnd() * 512, cy = rnd() * 256, r = 26 + rnd() * 42;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.3) {
      const rr = r * (0.7 + 0.45 * Math.sin(a * 3 + i) * Math.cos(a * 2 - i) + rnd() * 0.12);
      const px = cx + Math.cos(a) * rr * 1.3, py = cy + Math.sin(a) * rr;
      a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Cow {
  root = new THREE.Group();
  private rig = new THREE.Group();
  private udder = new THREE.Group();
  private udderMesh: THREE.Mesh;
  private body = new THREE.Group();
  private bodyMesh: THREE.Mesh;
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private ears: THREE.Group[] = [];
  private teats: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private bell = new THREE.Group();
  private eyeL: THREE.Mesh; private eyeR: THREE.Mesh;

  // jiggle springs
  private uY = new Spring(150, 5.5, 0.3);
  private uX = new Spring(120, 4.5, 0.25);
  private uZ = new Spring(120, 4.5, 0.2);
  private bY = new Spring(220, 9, 0.12);
  private bP = new Spring(160, 7, 0.25);
  private hY = new Spring(200, 7, 0.18);
  private hP = new Spring(140, 5, 0.4);
  private earS = [new Spring(90, 3, 1.1), new Spring(95, 3.2, 1.1)];
  private teatS = [0, 1, 2, 3].map(i => [new Spring(110 + i * 9, 3, 0.9), new Spring(110 + i * 7, 3, 0.9)]);
  private tailS = [new Spring(80, 3, 0.9), new Spring(70, 2.5, 1.0), new Spring(60, 2, 1.1)];
  private bellS = new Spring(70, 2, 1.2);
  private lastVy = 0;
  private t = 0;
  private blink = 2;
  jiggle = 1;
  teatTips: THREE.Object3D[] = [];

  constructor() {
    const white = new THREE.MeshStandardMaterial({ color: 0xfbf6ee, roughness: 0.75 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1b1416, roughness: 0.6 });
    const spots = new THREE.MeshStandardMaterial({ map: spotsTexture(), roughness: 0.75 });
    const pink = new THREE.MeshPhysicalMaterial({ color: 0xff9fb2, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.35, sheen: 0.6, sheenColor: new THREE.Color(0xffd0da) });
    const pinkDark = new THREE.MeshStandardMaterial({ color: 0xf07c96, roughness: 0.45 });
    const horn = new THREE.MeshStandardMaterial({ color: 0xf2e2c2, roughness: 0.5 });
    const hoof = new THREE.MeshStandardMaterial({ color: 0x3a2a26, roughness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 0.85, roughness: 0.28 });
    const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const shadowy = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; return m; };

    this.root.add(this.rig);

    // udder
    this.udderMesh = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 28), pink));
    this.udder.add(this.udderMesh);
    this.rig.add(this.udder);
    const teatGeo = new THREE.CapsuleGeometry(0.085, 0.24, 6, 12);
    teatGeo.translate(0, -0.17, 0);
    const pos: [number, number][] = [[0.2, 0.2], [0.2, -0.2], [-0.2, 0.2], [-0.2, -0.2]];
    pos.forEach(([x, z]) => {
      const tg = new THREE.Group();
      const dir = new THREE.Vector3(x, -0.55, z).normalize();
      tg.position.copy(dir.clone().multiplyScalar(0.59));
      tg.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(x * 2.6, -0.4, z * 2.6).normalize());
      const m = shadowy(new THREE.Mesh(teatGeo, pinkDark));
      tg.add(m);
      const tip = new THREE.Object3D(); tip.position.y = -0.33; tg.add(tip);
      this.teatTips.push(tip);
      tg.userData.base = tg.quaternion.clone();
      this.udderMesh.add(tg);
      this.teats.push(tg);
    });

    // body
    this.bodyMesh = shadowy(new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.95, 1.0, 6, 0.38), spots));
    this.body.add(this.bodyMesh);
    this.rig.add(this.body);

    // legs: stubby, flailing
    const legGeo = new THREE.CapsuleGeometry(0.13, 0.28, 6, 12); legGeo.translate(0, -0.2, 0);
    const hoofGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.12, 14);
    [[0.62, 0.36], [0.62, -0.36], [-0.62, 0.36], [-0.62, -0.36]].forEach(([x, z], i) => {
      const lg = new THREE.Group();
      lg.position.set(x, -0.32, z);
      const leg = shadowy(new THREE.Mesh(legGeo, i % 2 ? white : spots));
      const h = shadowy(new THREE.Mesh(hoofGeo, hoof)); h.position.y = -0.45;
      lg.add(leg, h);
      lg.userData.side = Math.sign(z); lg.userData.front = Math.sign(x); lg.userData.phase = i * 1.7;
      this.body.add(lg); this.legs.push(lg);
    });

    // head
    this.head.position.set(1.0, 0.38, 0);
    this.body.add(this.head);
    const skull = shadowy(new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.66, 0.66, 5, 0.24), white));
    skull.position.set(0.18, 0.08, 0);
    this.head.add(skull);
    const patch = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), black));
    patch.scale.set(1, 0.9, 0.45); patch.position.set(0.3, 0.2, 0.25); this.head.add(patch);
    const snout = shadowy(new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.38, 0.6, 5, 0.16), pink));
    snout.position.set(0.56, -0.08, 0); this.head.add(snout);
    this.jaw.position.set(0.5, -0.24, 0); this.head.add(this.jaw);
    const jawM = shadowy(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.12, 0.5, 3, 0.05), pink));
    jawM.position.set(0.04, -0.02, 0); this.jaw.add(jawM);
    [-0.13, 0.13].forEach(z => {
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), black);
      n.position.set(0.745, -0.04, z); n.scale.set(0.5, 1, 1); this.head.add(n);
    });
    const mkEye = (z: number) => {
      const e = new THREE.Group();
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), eyeW);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), black);
      p.position.set(0.06, 0.01, Math.sign(z) * 0.04);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeW);
      glint.position.set(0.11, 0.04, Math.sign(z) * 0.06);
      e.add(w, p, glint);
      e.position.set(0.42, 0.18, z);
      this.head.add(e);
      return e as unknown as THREE.Mesh;
    };
    this.eyeL = mkEye(0.26); this.eyeR = mkEye(-0.26);
    [-1, 1].forEach(s => {
      const h = shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 10), horn));
      h.position.set(0.12, 0.47, s * 0.2); h.rotation.x = s * -0.5; this.head.add(h);
      const ear = new THREE.Group();
      ear.position.set(0.05, 0.3, s * 0.34);
      const em = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), s > 0 ? black : white));
      em.scale.set(0.55, 0.25, 1); em.position.z = s * 0.15;
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), pinkDark);
      inner.scale.set(0.45, 0.12, 0.85); inner.position.set(0.02, 0.025, s * 0.15);
      ear.add(em, inner);
      ear.userData.side = s;
      this.head.add(ear); this.ears.push(ear);
    });

    // bell collar
    this.bell.position.set(0.85, -0.05, 0);
    this.body.add(this.bell);
    const bm = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.14, 0.2, 16, 1, true), gold));
    bm.position.y = -0.12; (bm.material as THREE.Material).side = THREE.DoubleSide;
    const clap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), gold); clap.position.y = -0.22;
    this.bell.add(bm, clap);

    // tail chain
    let parent: THREE.Object3D = this.body;
    const segGeo = new THREE.CapsuleGeometry(0.04, 0.22, 4, 8); segGeo.translate(0, -0.13, 0);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Group();
      s.position.set(i === 0 ? -0.95 : 0, i === 0 ? 0.3 : -0.26, 0);
      s.add(shadowy(new THREE.Mesh(segGeo, white)));
      if (i === 2) {
        const tuft = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), black));
        tuft.position.y = -0.3; tuft.scale.set(0.8, 1.3, 0.8); s.add(tuft);
      }
      parent.add(s); this.tail.push(s); parent = s;
    }
  }

  reset() {
    [this.uY, this.uX, this.uZ, this.bY, this.bP, this.hY, this.hP, this.bellS, ...this.earS, ...this.tailS, ...this.teatS.flat()].forEach(s => s.reset());
    this.root.rotation.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.lastVy = 0;
  }

  /** big random shove of every spring (landings / crashes) */
  shake(amount: number) {
    const a = amount * this.jiggle;
    const r = () => (Math.random() * 2 - 1) * a;
    this.uX.kick(r() * 3); this.uZ.kick(r() * 3); this.uY.kick(-Math.abs(a) * 2);
    this.hP.kick(r() * 4); this.bellS.kick(r() * 6);
    this.earS.forEach(s => s.kick(r() * 10));
    this.teatS.forEach(p => { p[0].kick(r() * 9); p[1].kick(r() * 9); });
    this.tailS.forEach(s => s.kick(r() * 8));
  }

  /**
   * y: physics height of the udder bottom (negative = compressing into ground)
   * vy: vertical velocity, speed: run speed, dead: tumbling
   */
  update(dt: number, y: number, vy: number, speed: number, dead: boolean) {
    this.t += dt;
    const ay = (vy - this.lastVy) / Math.max(dt, 1e-4);
    this.lastVy = vy;
    const J = this.jiggle;
    const aIn = THREE.MathUtils.clamp(ay, -900, 900);

    // fixed substeps so stiff springs stay stable
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    const wob = Math.sin(this.t * speed * 0.9);
    for (let i = 0; i < n; i++) {
      this.uY.step(h, -aIn * 0.55 * J);
      this.uX.step(h, (wob * 6 - speed * 0.3) * J);
      this.uZ.step(h, Math.cos(this.t * speed * 0.45) * 4 * J);
      this.bY.step(h, -aIn * 0.18 * J);
      this.bP.step(h, (aIn * 0.012 + wob * 1.5) * J);
      this.hY.step(h, -aIn * 0.25 * J);
      this.hP.step(h, aIn * 0.03 * J);
      this.earS.forEach((s, k) => s.step(h, (-aIn * 0.05 + this.hY.v * 25 + Math.sin(this.t * 9 + k) * 6) * J));
      this.tailS.forEach((s, k) => s.step(h, (-aIn * 0.03 * (k + 1) + this.uX.v * 30 + speed * 0.9 + Math.sin(this.t * 7 - k) * 4) * J));
      this.bellS.step(h, (this.bY.v * 40 - this.uX.v * 25) * J);
      this.teatS.forEach((p, k) => {
        p[0].step(h, (this.uX.v * 60 + this.uY.v * 20 * (k < 2 ? 1 : -1)) * J);
        p[1].step(h, (this.uZ.v * 60 + this.uY.v * 25 * (k % 2 ? 1 : -1)) * J);
      });
    }

    // ground squash: udder volume-preserving compression
    const comp = THREE.MathUtils.clamp(-y, 0, 0.42);
    const stretch = THREE.MathUtils.clamp(this.uY.x * 1.4, -0.25, 0.3);
    const sy = THREE.MathUtils.clamp(1 - comp * 1.35 + stretch, 0.45, 1.35);
    const sxz = 1 / Math.sqrt(sy);
    this.root.position.y = Math.max(0, y);
    this.udderMesh.scale.set(1.12 * sxz, sy, 1.05 * sxz);
    this.udder.position.set(this.uX.x * 0.6, 0.62 * sy, this.uZ.x * 0.6);
    this.udder.rotation.set(this.uZ.x * 0.6, 0, -this.uX.x * 0.8);

    const bodyY = 1.24 * sy * 0.9 + 0.36 + this.bY.x;
    this.body.position.set(0, bodyY, 0);
    const bsq = 1 - this.bY.x * 1.2;
    this.body.scale.set(1 / Math.sqrt(bsq), bsq, 1 / Math.sqrt(bsq));
    this.body.rotation.z = this.bP.x + (dead ? 0 : THREE.MathUtils.clamp(vy * 0.012, -0.2, 0.2));
    this.body.rotation.x = this.uZ.x * 0.25;

    this.head.position.y = 0.38 + this.hY.x;
    this.head.rotation.z = this.hP.x * 0.8 + Math.sin(this.t * speed * 0.45) * 0.05;
    this.jaw.rotation.z = -Math.max(0, this.hY.x * 2.5) - (dead ? 0.5 : 0);

    this.ears.forEach((e, k) => {
      const s = e.userData.side as number;
      e.rotation.x = s * (0.25 + this.earS[k].x * 0.9);
      e.rotation.y = s * this.earS[k].x * 0.3;
    });
    this.teats.forEach((t, k) => {
      const q = (t.userData.base as THREE.Quaternion).clone();
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.teatS[k][1].x, 0, -this.teatS[k][0].x)));
      t.quaternion.copy(q);
      t.scale.y = 1 + comp * 0.8;
    });
    this.tail[0].rotation.z = -0.4 - this.tailS[0].x * 0.6;
    this.tail[1].rotation.z = -this.tailS[1].x * 0.7;
    this.tail[2].rotation.z = -this.tailS[2].x * 0.8;
    this.tail.forEach((s, k) => (s.rotation.x = Math.sin(this.t * 6 - k) * 0.25));
    this.bell.rotation.z = this.bellS.x * 0.9;

    // legs paddle like a cartoon running in the air
    const f = 4 + speed * 0.75;
    this.legs.forEach(l => {
      const ph = l.userData.phase as number, side = l.userData.side as number, front = l.userData.front as number;
      const air = y > 0.15 ? 1 : 0;
      l.rotation.z = Math.sin(this.t * f + ph) * (0.9 + air * 0.3) + front * 0.35;
      l.rotation.x = side * (0.5 + air * 0.4 + Math.cos(this.t * f + ph) * 0.15);
      if (dead) { l.rotation.z = Math.sin(this.t * 30 + ph) * 1.4; l.rotation.x = side * 1.2; }
    });

    // blinking
    this.blink -= dt;
    const closed = this.blink < 0.12 || dead;
    const ey = closed ? 0.12 : 1;
    this.eyeL.scale.y = ey; this.eyeR.scale.y = ey;
    if (this.blink < 0) this.blink = 1.5 + Math.random() * 3;
  }
}
