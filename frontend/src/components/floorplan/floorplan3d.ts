/**
 * Kat planının 3D maketi — Kroki main.html'deki build() fonksiyonunun
 * npm `three` (0.169) portu. r128 CDN sürümünden farklar:
 *  - Işık yoğunlukları ×π (r155'te legacy lights kalktı; aynı görünüm için).
 *  - CanvasTexture.colorSpace = SRGBColorSpace (etiketler soluk kalmasın).
 *  - dispose() eklendi (listener/observer/GPU kaynakları — React unmount).
 *  - Durum küreleri CANLI müsaitlikten renklenir (statusColorOf callback).
 *  - Oda tıklama/tooltip DOM globalleri yerine callback'lerle dışarı verilir.
 */
import * as THREE from 'three';
import {
  KROKI_CAT,
  KROKI_ROOMS,
  type FloorFilter,
  type KrokiRoomDef,
  type KrokiShape,
} from './floorplanData';

export interface Floor3DOptions {
  /** krokiId → durum rengi (canlı müsaitlik); bilinmiyorsa gri döndürün. */
  statusColorOf: (krokiId: string) => string;
  /** Tooltip içeriği (yalın metin satırları). */
  tipTextOf: (krokiId: string) => string;
  onRoomClick: (krokiId: string) => void;
  /** krokiId → 3D'de odanın üzerinde süzülen ad etiketi (yoksa etiket çizilmez). */
  labels?: Record<string, string>;
}

export interface Floor3DHandle {
  start(): void;
  stop(): void;
  resize(): void;
  setPose(p: number): void;
  morphTo(to: number, dur?: number, done?: () => void): void;
  applyFilter(filter: FloorFilter | null, isBusy: (krokiId: string) => boolean | null): void;
  refreshStatus(): void;
  dispose(): void;
}

const CX = 1189;
const CZ = 821;
const HGT: Record<string, number> = { calisma: 150, toplanti: 150, sistem: 175, oturma: 150, deneyim: 135 };
const ZONE: Record<string, string> = { etkinlik: '#E0912C', bahce: '#4E9E5A', mutfak: '#C4894A', salon: '#A7845E' };
const FLOOR: Array<[number, number]> = [
  [57, 478], [57, 1242], [489, 1242], [491, 1614], [2326, 1613], [2321, 29], [533, 29], [532, 321], [272, 321], [271, 478],
];

function ptsOf(s: KrokiShape): Array<[number, number]> {
  if (s.t === 'rect') {
    return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
  }
  const a: Array<[number, number]> = [];
  for (let i = 0; i < s.pts.length; i += 2) a.push([s.pts[i], s.pts[i + 1]]);
  return a;
}

function centerOf(pts: Array<[number, number]>): [number, number] {
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (const p of pts) {
    mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]);
    mxx = Math.max(mxx, p[0]); mxy = Math.max(mxy, p[1]);
  }
  return [(mnx + mxx) / 2, (mny + mxy) / 2];
}

function planShape(pts: Array<[number, number]>): THREE.Shape {
  const sh = new THREE.Shape();
  pts.forEach((p, i) => {
    const X = p[0] - CX, Y = CZ - p[1];
    if (i === 0) sh.moveTo(X, Y); else sh.lineTo(X, Y);
  });
  return sh;
}

export function buildFloor3D(container: HTMLElement, opts: Floor3DOptions): Floor3DHandle {
  const W = container.clientWidth || 800;
  const Hc = container.clientHeight || 600;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x061a12, 3400, 8800);
  const camera = new THREE.PerspectiveCamera(46, W / Hc, 10, 15000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, Hc, false);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // r128 legacy-lights görünümünü modern pipeline'da yakalamak için ×π.
  scene.add(new THREE.HemisphereLight(0xc6ecd8, 0x0a2017, 0.95 * Math.PI));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.62 * Math.PI);
  d1.position.set(-950, 2500, 1500);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x92dcb4, 0.26 * Math.PI);
  d2.position.set(1700, 900, -1300);
  scene.add(d2);
  scene.add(new THREE.AmbientLight(0x224638, 0.55 * Math.PI));

  const pickable: THREE.Mesh[] = [];
  const primary: Record<string, THREE.Mesh> = {};
  const roomGroups: THREE.Group[] = [];
  const heightScaleObjs: THREE.Object3D[] = [];
  const yAnimObjs: Array<{ obj: THREE.Object3D; y0: number; y1: number }> = [];
  const statusSpheres: Array<{ id: string; solid: THREE.MeshBasicMaterial; halo: THREE.MeshBasicMaterial }> = [];
  const grp = new THREE.Group();
  scene.add(grp);

  // taban plakası (bahçe avlusu boşluklu) — her zaman düz
  {
    const sh = planShape(FLOOR);
    const hp = new THREE.Path();
    ([[1226, 497], [1916, 497], [1916, 1205], [1226, 1205]] as Array<[number, number]>).forEach((p, i) => {
      const X = p[0] - CX, Y = CZ - p[1];
      if (i === 0) hp.moveTo(X, Y); else hp.lineTo(X, Y);
    });
    sh.holes.push(hp);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 44, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -44, 0);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf3eee1, roughness: 0.95, metalness: 0, side: THREE.DoubleSide })));
    grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x2a2a24, transparent: true, opacity: 0.5 })));
  }

  // dış cephe + bahçe çevresi duvarları (yükseklik animasyonlu)
  {
    const WALLS: Array<Array<[number, number]>> = [
      [[57, 478], [57, 725]],
      [[57, 992], [57, 1242], [489, 1242], [491, 1614], [2326, 1613], [2321, 29], [1141, 29]],
      [[1015, 29], [533, 29], [532, 321], [272, 321], [271, 478], [57, 478]],
      [[1207, 478], [1935, 478], [1935, 1224], [1207, 1224], [1207, 478]],
    ];
    const HW = 156, T = 18;
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xe6e1d5, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    const strip = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, e = T / 2;
      const A0 = ax - ux * e, A1 = ay - uy * e, B0 = bx + ux * e, B1 = by + uy * e;
      const g = new THREE.ExtrudeGeometry(
        planShape([[A0 + nx * e, A1 + ny * e], [B0 + nx * e, B1 + ny * e], [B0 - nx * e, B1 - ny * e], [A0 - nx * e, A1 - ny * e]]),
        { depth: HW, bevelEnabled: false, steps: 1 },
      );
      g.rotateX(-Math.PI / 2);
      return g;
    };
    for (const poly of WALLS) {
      for (let i = 0; i < poly.length - 1; i++) {
        const m = new THREE.Mesh(strip(poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]), faceMat);
        m.position.y = 0.5;
        grp.add(m);
        heightScaleObjs.push(m);
      }
      const vpts = poly.map((p) => new THREE.Vector3(p[0] - CX, 0, p[1] - CZ));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vpts), new THREE.LineBasicMaterial({ color: 0x3ad681, transparent: true, opacity: 0.75 }));
      grp.add(line);
      yAnimObjs.push({ obj: line, y0: 0, y1: HW });
    }
  }

  const tileMesh = (pts: Array<[number, number]>, y: number, colHex: string, op: number) => {
    const g = new THREE.ShapeGeometry(planShape(pts));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(colHex), roughness: 0.72, metalness: 0, side: THREE.DoubleSide, transparent: op < 1, opacity: op }));
  };
  const wallMesh = (pts: Array<[number, number]>, h: number, colHex: string) => {
    const g = new THREE.ExtrudeGeometry(planShape(pts), { depth: h, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(colHex), roughness: 0.55, metalness: 0.06, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    return { mesh: new THREE.Mesh(g, m), geo: g };
  };
  const makeLabel = (text: string, fs = 54, sc = 1.12) => {
    const pad = 20;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d')!;
    const font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`;
    ctx.font = font;
    const tw = Math.ceil(ctx.measureText(text).width);
    cv.width = tw + pad * 2;
    cv.height = fs + pad * 2;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(3,12,8,0.9)';
    ctx.strokeText(text, cv.width / 2, cv.height / 2);
    ctx.fillStyle = '#EAF4EE';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(cv.width * sc, cv.height * sc, 1);
    sp.renderOrder = 6;
    return sp;
  };

  // BAHÇE avlusu: orijinal krokide taban plakasında delik olarak kalıyordu
  // (koyu zemin "eksik" görünüyordu) — çim zemini + ağaçlar + etiketle doldur.
  {
    const g = new THREE.ShapeGeometry(
      planShape([[1226, 497], [1916, 497], [1916, 1205], [1226, 1205]]),
    );
    g.rotateX(-Math.PI / 2);
    g.translate(0, 1.5, 0);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x7fb35f, roughness: 0.95, metalness: 0, side: THREE.DoubleSide })));
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3e7d3a, roughness: 0.85 });
    const TREES: Array<[number, number, number]> = [
      [1330, 620, 1.0], [1810, 590, 1.2], [1560, 850, 1.4], [1310, 1090, 1.1], [1830, 1110, 1.0], [1650, 640, 0.85],
    ];
    for (const [tx, tz, s] of TREES) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(6 * s, 8 * s, 46 * s, 8), trunkMat);
      trunk.position.y = 23 * s;
      tree.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(34 * s, 12, 10), leafMat);
      crown.position.y = 62 * s;
      crown.scale.y = 1.15;
      tree.add(crown);
      tree.position.set(tx - CX, 0, tz - CZ);
      grp.add(tree);
      heightScaleObjs.push(tree);
    }
  }

  for (const r of KROKI_ROOMS) {
    if (r.cat === 'bahce') continue;
    const pts = ptsOf(r.s);
    const ctr = centerOf(pts);
    const isZone = r.cat === 'etkinlik' || r.cat === 'mutfak' || r.cat === 'salon';
    const walled = !isZone;
    const col = isZone ? ZONE[r.cat] : KROKI_CAT[r.cat].color;
    const tileOp = isZone ? 0.34 : 0.96;
    const rg = new THREE.Group();
    rg.userData.krokiId = r.id;
    rg.userData.roomDef = r;
    const tile = tileMesh(pts, 3, col, tileOp);
    tile.userData.krokiId = r.id;
    rg.add(tile);
    pickable.push(tile);
    primary[r.id] = tile;
    const topY = walled ? 4 + (HGT[r.cat] || 150) : 3;
    if (walled) {
      const h = HGT[r.cat] || 150;
      const wm = wallMesh(pts, h, col);
      wm.mesh.position.y = 4;
      wm.mesh.userData.krokiId = r.id;
      wm.mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(wm.geo), new THREE.LineBasicMaterial({ color: 0x0c2419, transparent: true, opacity: 0.5 })));
      rg.add(wm.mesh);
      pickable.push(wm.mesh);
      primary[r.id] = wm.mesh;
      heightScaleObjs.push(wm.mesh);
    }
    const X = ctr[0] - CX, Z = ctr[1] - CZ;
    // Canlı durum küresi: rezervasyona bağlı tüm alanlarda (pod + Deneyim +
    // Tribün/Etkinlik) — yalnız pod'larda olsaydı DN/ET müsaitliği 3D'de
    // görünmezdi. Duvarsız bölgelerde sabit yükseklik kullanılır.
    if (r.cat === 'calisma' || r.cat === 'deneyim' || r.cat === 'etkinlik') {
      const sphereY = walled ? topY + 46 : 150;
      const scol = new THREE.Color(opts.statusColorOf(r.id));
      const m1 = new THREE.MeshBasicMaterial({ color: scol });
      const s1 = new THREE.Mesh(new THREE.SphereGeometry(26, 20, 16), m1);
      s1.position.set(X, sphereY, Z);
      rg.add(s1);
      yAnimObjs.push({ obj: s1, y0: 8, y1: sphereY });
      const m2 = new THREE.MeshBasicMaterial({ color: scol.clone(), transparent: true, opacity: 0.22 });
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(46, 16, 12), m2);
      s2.position.set(X, sphereY, Z);
      rg.add(s2);
      yAnimObjs.push({ obj: s2, y0: 8, y1: sphereY });
      statusSpheres.push({ id: r.id, solid: m1, halo: m2 });
    }
    rg.traverse((o: THREE.Object3D) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.userData.baseOp = (mat as THREE.MeshStandardMaterial).opacity;
    });
    grp.add(rg);
    roomGroups.push(rg);
  }

  // giriş etiketleri
  for (const e of [{ t: 'Giriş 1', x: 57, y: 858 }, { t: 'Giriş 2', x: 1078, y: 29 }]) {
    const sp = makeLabel(e.t);
    sp.position.set(e.x - CX, 178, e.y - CZ);
    grp.add(sp);
    yAnimObjs.push({ obj: sp, y0: 12, y1: 178 });
  }

  // Oda/alan ad etiketleri: 2D'de görünen adlar 3D'de de süzülsün ("eksik
  // görsel" bırakma). Küçük odalar küçük font, alanlar büyük.
  if (opts.labels) {
    for (const r of KROKI_ROOMS) {
      const text = opts.labels[r.id];
      if (!text) continue;
      const pts = ptsOf(r.s);
      const ctr = centerOf(pts);
      const small = r.cat === 'calisma' || r.cat === 'sistem' || r.cat === 'toplanti';
      const sp = makeLabel(text, small ? 38 : 50, small ? 0.82 : 1.0);
      const walled = !(r.cat === 'etkinlik' || r.cat === 'bahce' || r.cat === 'mutfak' || r.cat === 'salon');
      const y1 = walled ? 4 + (HGT[r.cat] || 150) + (r.cat === 'calisma' ? 118 : 56) : 118;
      sp.position.set(ctr[0] - CX, y1, ctr[1] - CZ);
      grp.add(sp);
      yAnimObjs.push({ obj: sp, y0: 10, y1 });
    }
  }

  // ETKİNLİK ALANI: anfi + kürsü (kroki ile birebir)
  {
    const FE: Array<[number, number]> = [[1372, 268], [1470, 260], [1568, 258], [1662, 262], [1740, 276], [1792, 306]];
    const Px = 1584, Pz = 414;
    const nRows = 5, depth = 38, rise = 22, seatH = 24;
    const amp = new THREE.Group();
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xeae2d2, roughness: 0.92, metalness: 0 });
    const stageMat = new THREE.MeshStandardMaterial({ color: 0xdcd3c0, roughness: 0.92, metalness: 0 });
    const gray = 0xb7bdc1, orange = 0xe86a32;
    let si = 0;
    const fpts = FE.map((p) => new THREE.Vector3(p[0] - CX, 0, p[1] - CZ));
    const curve = new THREE.CatmullRomCurve3(fpts, false, 'catmullrom', 0.5);
    const CL = curve.getSpacedPoints(32);
    const Pw = { x: Px - CX, z: Pz - CZ };
    const nrm = (x: number, z: number) => {
      const l = Math.hypot(x, z) || 1;
      return { x: x / l, z: z / l };
    };
    const FC = CL.map((p: THREE.Vector3) => nrm(Pw.x - p.x, Pw.z - p.z));
    for (let i = 0; i < nRows; i++) {
      const off = i * depth, hgt = (i + 1) * rise;
      for (let j = 0; j < CL.length - 1; j++) {
        const ax = CL[j].x - FC[j].x * off, az = CL[j].z - FC[j].z * off;
        const bx = CL[j + 1].x - FC[j + 1].x * off, bz = CL[j + 1].z - FC[j + 1].z * off;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
        const ang = -Math.atan2(dz, dx);
        const box = new THREE.Mesh(new THREE.BoxGeometry(len + 2.5, hgt, depth), stepMat);
        box.position.set(mx, hgt / 2, mz);
        box.rotation.y = ang;
        amp.add(box);
        if (j % 2 === 0) {
          const fx = FC[j].x, fz = FC[j].z;
          const col = (i + si) % 4 === 1 ? orange : gray;
          si++;
          const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.8 });
          const seat = new THREE.Mesh(new THREE.BoxGeometry(24, seatH, 24), mat);
          seat.position.set(mx + fx * 7, hgt + seatH / 2, mz + fz * 7);
          seat.rotation.y = ang;
          amp.add(seat);
          const back = new THREE.Mesh(new THREE.BoxGeometry(24, seatH + 5, 7), mat);
          back.position.set(mx - fx * 9, hgt + seatH / 2 + 3, mz - fz * 9);
          back.rotation.y = ang;
          amp.add(back);
        }
      }
    }
    const stg = new THREE.Mesh(new THREE.CylinderGeometry(52, 52, 9, 40), stageMat);
    stg.position.set(Px - CX, 4.5, Pz - CZ);
    amp.add(stg);
    const pod = new THREE.Group();
    pod.position.set(Px - CX, 9, Pz - CZ);
    const podBase = new THREE.Mesh(new THREE.BoxGeometry(30, 54, 24), new THREE.MeshStandardMaterial({ color: 0xe6e1d5, roughness: 0.85 }));
    podBase.position.y = 27;
    pod.add(podBase);
    const podTop = new THREE.Mesh(new THREE.BoxGeometry(42, 10, 28), new THREE.MeshStandardMaterial({ color: 0xcf7a45, roughness: 0.7 }));
    podTop.position.y = 56;
    podTop.rotation.x = -0.18;
    pod.add(podTop);
    amp.add(pod);
    grp.add(amp);
    heightScaleObjs.push(amp);
  }

  // ---------- kamera + morph (düz <-> 3D) ----------
  const target = new THREE.Vector3(0, 150, 0);
  let theta = -0.72, phi = 0.93, radius = 2780;
  let cT = theta, cP = phi, cR = radius;
  let morphP = 1, morphing = false, mFromH = 1, mToH = 1, mStart = 0, mDur = 1;
  let mDone: (() => void) | null = null;
  let camS = { th: cT, ph: cP, r: cR, ty: target.y };
  let camE = { th: cT, ph: cP, r: cR, ty: target.y };

  const poseFlat = () => ({ th: 0, ph: 0.06, r: 2600, ty: 8 });
  const pose3D = () => ({ th: -0.72, ph: 0.93, r: 2780, ty: 150 });
  const applyHeights = (p: number) => {
    const s = Math.max(0.0001, p);
    for (const o of heightScaleObjs) o.scale.y = s;
    for (const e of yAnimObjs) e.obj.position.y = e.y0 + (e.y1 - e.y0) * p;
  };
  const setCamPos = () => {
    camera.position.set(
      target.x + cR * Math.sin(cP) * Math.sin(cT),
      target.y + cR * Math.cos(cP),
      target.z + cR * Math.sin(cP) * Math.cos(cT),
    );
    camera.lookAt(target);
  };
  const setPose = (p: number) => {
    morphing = false;
    morphP = p;
    const po = p >= 0.5 ? pose3D() : poseFlat();
    cT = po.th; cP = po.ph; cR = po.r;
    target.set(0, po.ty, 0);
    theta = cT; phi = cP; radius = cR;
    applyHeights(p);
    setCamPos();
  };
  const morphTo = (to: number, dur?: number, done?: () => void) => {
    mFromH = morphP;
    mToH = to;
    target.x = 0;
    target.z = 0;
    camS = { th: cT, ph: cP, r: cR, ty: target.y };
    camE = to >= 0.5 ? pose3D() : poseFlat();
    mStart = performance.now();
    mDur = dur || 880;
    morphing = true;
    mDone = done || null;
  };

  // ---------- etkileşim ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: THREE.Mesh | null = null;

  const tip = document.createElement('div');
  tip.className = 'fp3-tip';
  container.appendChild(tip);

  const setNdc = (e: PointerEvent) => {
    const rc = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rc.left) / rc.width) * 2 - 1;
    ndc.y = -((e.clientY - rc.top) / rc.height) * 2 + 1;
  };
  const hitTest = (e: PointerEvent): THREE.Mesh | null => {
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    const is = ray.intersectObjects(pickable, false);
    return is.length ? (is[0].object as THREE.Mesh) : null;
  };
  const showTip = (e: PointerEvent, krokiId: string) => {
    tip.textContent = opts.tipTextOf(krokiId);
    tip.classList.add('on');
    const rc = container.getBoundingClientRect();
    let x = e.clientX - rc.left + 14;
    let y = e.clientY - rc.top + 16;
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    if (x + w > rc.width - 8) x = e.clientX - rc.left - w - 14;
    if (y + hh > rc.height - 8) y = e.clientY - rc.top - hh - 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hideTip = () => tip.classList.remove('on');
  const setHover = (mesh: THREE.Mesh | null) => {
    const pm = mesh ? primary[mesh.userData.krokiId as string] || mesh : null;
    if (hovered === pm) return;
    const hm = hovered?.material as THREE.MeshStandardMaterial | undefined;
    if (hm?.emissive) hm.emissive.setHex(0x000000);
    hovered = pm;
    const nm = pm?.material as THREE.MeshStandardMaterial | undefined;
    if (nm?.emissive) {
      nm.emissive.setHex(0xf2921c);
      nm.emissiveIntensity = 0.5;
    }
  };

  const dom = renderer.domElement;
  let dragging = false, panning = false, moved = 0, lx = 0, ly = 0;
  const doPan = (dx: number, dy: number) => {
    const wpp = (2 * cR * Math.tan((camera.fov * Math.PI) / 360)) / (dom.clientHeight || 1);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, -dx * wpp);
    target.addScaledVector(up, dy * wpp);
  };
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent) => {
    if (morphing) return;
    if (e.button === 1) {
      panning = true;
      e.preventDefault();
    } else {
      dragging = true;
    }
    moved = 0;
    lx = e.clientX;
    ly = e.clientY;
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {
      /* boş */
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (morphing) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (panning) {
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      doPan(dx, dy);
      dom.style.cursor = 'move';
      hideTip();
    } else if (dragging) {
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      theta -= dx * 0.005;
      phi -= dy * 0.005;
      phi = Math.max(0.18, Math.min(1.46, phi));
      hideTip();
    } else {
      const m = hitTest(e);
      if (m) {
        setHover(m);
        dom.style.cursor = 'pointer';
        showTip(e, m.userData.krokiId as string);
      } else {
        setHover(null);
        dom.style.cursor = 'grab';
        hideTip();
      }
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (morphing) {
      dragging = false;
      panning = false;
      return;
    }
    const wasPan = panning;
    dragging = false;
    panning = false;
    if (!wasPan && moved < 7) {
      const m = hitTest(e);
      if (m) opts.onRoomClick(m.userData.krokiId as string);
    }
  };
  const onPointerLeave = () => {
    dragging = false;
    panning = false;
    setHover(null);
    hideTip();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (morphing) return;
    radius *= 1 + (e.deltaY > 0 ? 1 : -1) * 0.09;
    radius = Math.max(950, Math.min(6400, radius));
  };
  dom.addEventListener('mousedown', onMouseDown);
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointerleave', onPointerLeave);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.style.cursor = 'grab';

  const hint = document.createElement('div');
  hint.className = 'fp3-hint';
  hint.innerHTML =
    '<span><b>Sürükle</b> döndür</span><span><b>Orta tuş</b> kaydır</span><span><b>Tekerlek</b> yakınlaştır</span><span><b>Tıkla</b> oda bilgisi</span>';
  container.appendChild(hint);

  // ---------- API ----------
  const applyFilter = (filter: FloorFilter | null, isBusy: (id: string) => boolean | null) => {
    let pred: ((r: KrokiRoomDef) => boolean) | null = null;
    if (filter?.cats?.length) {
      const set = filter.cats;
      pred = (r) => set.includes(r.cat);
    } else if (filter?.status) {
      const wantBusy = filter.status === 'busy';
      pred = (r) => {
        const b = isBusy(r.id);
        return b !== null && b === wantBusy;
      };
    }
    for (const rg of roomGroups) {
      const match = pred ? pred(rg.userData.roomDef as KrokiRoomDef) : true;
      rg.traverse((o: THREE.Object3D) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!mat) return;
        let b = mat.userData.baseOp as number | undefined;
        if (b == null) {
          b = (mat as THREE.MeshStandardMaterial).opacity;
          mat.userData.baseOp = b;
        }
        const base = b;
        mat.transparent = true;
        if (!pred) (mat as THREE.MeshStandardMaterial).opacity = base;
        else if (match) (mat as THREE.MeshStandardMaterial).opacity = Math.min(1, base + 0.42);
        else (mat as THREE.MeshStandardMaterial).opacity = base * 0.1;
      });
    }
  };

  const refreshStatus = () => {
    for (const s of statusSpheres) {
      const c = new THREE.Color(opts.statusColorOf(s.id));
      s.solid.color.copy(c);
      s.halo.color.copy(c);
    }
  };

  let raf: number | null = null;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (morphing) {
      let t = (performance.now() - mStart) / mDur;
      let end = false;
      if (t >= 1) {
        t = 1;
        end = true;
      }
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const p = mFromH + (mToH - mFromH) * e;
      morphP = p;
      applyHeights(p);
      cT = camS.th + (camE.th - camS.th) * e;
      cP = camS.ph + (camE.ph - camS.ph) * e;
      cR = camS.r + (camE.r - camS.r) * e;
      target.y = camS.ty + (camE.ty - camS.ty) * e;
      theta = cT;
      phi = cP;
      radius = cR;
      setCamPos();
      if (end) {
        morphing = false;
        if (mDone) {
          const d = mDone;
          mDone = null;
          d();
        }
      }
    } else {
      cT += (theta - cT) * 0.16;
      cP += (phi - cP) * 0.16;
      cR += (radius - cR) * 0.16;
      setCamPos();
    }
    renderer.render(scene, camera);
  };
  const start = () => {
    if (raf == null) loop();
  };
  const stop = () => {
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  window.addEventListener('resize', resize);
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize);
    observer.observe(container);
  }

  const dispose = () => {
    stop();
    window.removeEventListener('resize', resize);
    observer?.disconnect();
    dom.removeEventListener('mousedown', onMouseDown);
    dom.removeEventListener('pointerdown', onPointerDown);
    dom.removeEventListener('pointermove', onPointerMove);
    dom.removeEventListener('pointerup', onPointerUp);
    dom.removeEventListener('pointerleave', onPointerLeave);
    dom.removeEventListener('wheel', onWheel);
    scene.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => disposeMat(m));
      else if (mat) disposeMat(mat);
    });
    renderer.dispose();
    // WebGL bağlamını hemen bırak: tarayıcının ~16 bağlam sınırına, tekrar
    // eden mount/unmount döngülerinde GC beklemeden takılmayalım.
    renderer.forceContextLoss();
    tip.remove();
    hint.remove();
    renderer.domElement.remove();
  };
  const disposeMat = (m: THREE.Material) => {
    const anyM = m as THREE.MeshStandardMaterial & { map?: THREE.Texture };
    anyM.map?.dispose();
    m.dispose();
  };

  setPose(1);
  return { start, stop, resize, setPose, morphTo, applyFilter, refreshStatus, dispose };
}
