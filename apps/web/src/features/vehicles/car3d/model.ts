import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { VehicleBodyType } from '../api';

// ═══════════════════════════════════════════════════════════
// Mashina 3D modeli — tashqi fayl (GLB) siz, geometriyadan quriladi: ichki tarmoqda ham ishlaydi.
// Kuzov turi bo'yicha shakl: sedan, xetchbek, krossover, miniven (Damas), pikap (Labo), furgon, avtobus.
// O'qlar: X — uzunasi (old tomoni +X), Y — yuqori, Z — eni. O'lchov — metr.
// Jonli qismlar: g'ildiraklar (aylanadi), kapot (ochiladi), faralar, benzin qopqog'i.
// ═══════════════════════════════════════════════════════════

interface Spec {
  L: number;
  W: number;
  r: number;
  /** Old va orqa o'q (X) */
  xf: number;
  xr: number;
  /** Kuzov pastki chizig'i */
  y0: number;
  /** Pastki kuzov ustki chizig'i: orqadan oldinga [x, y] */
  top: [number, number][];
  /** Salon (oyna) */
  cabin: { rearBase: number; rearRoof: number; frontRoof: number; frontBase: number; roofY: number; beltY: number };
  /** Furgon yuk qutisi */
  cargo?: { from: number; to: number; top: number };
  /** Pikap kuzovi (ochiq) */
  bed?: { from: number; to: number };
  /** Yon oynalar oralig'idagi ustunlar */
  pillars?: number;
}

const SPECS: Record<VehicleBodyType, Spec> = {
  SEDAN: {
    L: 4.5, W: 1.78, r: 0.32, xf: 1.38, xr: -1.34, y0: 0.27,
    top: [[-2.25, 0.56], [-2.21, 0.9], [-1.95, 0.98], [-1.3, 1.0], [1.05, 1.0], [1.7, 0.92], [2.12, 0.84], [2.25, 0.62]],
    cabin: { rearBase: -1.32, rearRoof: -0.78, frontRoof: 0.32, frontBase: 1.06, roofY: 1.45, beltY: 0.99 },
    pillars: 1,
  },
  HATCH: {
    L: 3.64, W: 1.6, r: 0.29, xf: 1.15, xr: -1.17, y0: 0.26,
    top: [[-1.82, 0.6], [-1.8, 0.98], [0.72, 0.98], [1.35, 0.88], [1.72, 0.8], [1.82, 0.6]],
    cabin: { rearBase: -1.78, rearRoof: -1.55, frontRoof: 0.02, frontBase: 0.74, roofY: 1.5, beltY: 0.97 },
    pillars: 1,
  },
  SUV: {
    L: 4.62, W: 1.86, r: 0.38, xf: 1.42, xr: -1.36, y0: 0.36,
    top: [[-2.3, 0.72], [-2.28, 1.12], [1.05, 1.13], [1.75, 1.05], [2.2, 0.98], [2.31, 0.74]],
    cabin: { rearBase: -2.24, rearRoof: -2.08, frontRoof: 0.36, frontBase: 1.08, roofY: 1.74, beltY: 1.12 },
    pillars: 2,
  },
  MINIVAN: {
    L: 3.5, W: 1.4, r: 0.27, xf: 1.1, xr: -0.95, y0: 0.25,
    top: [[-1.75, 0.58], [-1.75, 1.0], [1.3, 1.0], [1.62, 0.92], [1.75, 0.58]],
    cabin: { rearBase: -1.74, rearRoof: -1.72, frontRoof: 0.95, frontBase: 1.32, roofY: 1.86, beltY: 0.99 },
    pillars: 2,
  },
  PICKUP: {
    L: 3.4, W: 1.4, r: 0.27, xf: 1.05, xr: -1.0, y0: 0.26,
    top: [[-1.7, 0.6], [-1.7, 0.98], [0.15, 0.98], [1.2, 0.98], [1.55, 0.9], [1.7, 0.6]],
    cabin: { rearBase: 0.15, rearRoof: 0.18, frontRoof: 0.95, frontBase: 1.22, roofY: 1.78, beltY: 0.98 },
    bed: { from: -1.62, to: 0.05 },
    pillars: 0,
  },
  VAN: {
    L: 5.4, W: 2.0, r: 0.36, xf: 1.75, xr: -1.6, y0: 0.4,
    top: [[-2.7, 0.66], [-2.7, 1.25], [1.6, 1.25], [2.35, 1.1], [2.62, 1.0], [2.7, 0.68]],
    cabin: { rearBase: 0.62, rearRoof: 0.64, frontRoof: 1.0, frontBase: 1.62, roofY: 2.2, beltY: 1.24 },
    cargo: { from: -2.7, to: 0.6, top: 2.38 },
    pillars: 0,
  },
  BUS: {
    L: 8.0, W: 2.4, r: 0.46, xf: 2.7, xr: -2.4, y0: 0.45,
    top: [[-4.0, 0.72], [-4.0, 1.32], [3.92, 1.32], [4.0, 0.75]],
    cabin: { rearBase: -3.95, rearRoof: -3.95, frontRoof: 3.82, frontBase: 3.97, roofY: 2.95, beltY: 1.31 },
    pillars: 6,
  },
};

// ─────────── Ranglar ───────────

const COLOR_WORDS: [RegExp, string][] = [
  [/oq|white|бел|ок\b/i, '#f4f6f8'],
  [/qora|black|чер|кора/i, '#15181d'],
  [/kumush|silver|сереб|кумуш|metall/i, '#b9c0c8'],
  [/kulrang|grey|gray|сер|кулранг|asfalt/i, '#6f7782'],
  [/to'q ko'k|dark ?blue|тёмно-син|navy/i, '#1f3b73'],
  [/ko'k|blue|син|кук|голуб/i, '#2f6fd6'],
  [/qizil|red|крас|кизил|bordo|бордо|vishn/i, '#b3202a'],
  [/yashil|green|зел|яшил/i, '#2f7d4f'],
  [/sariq|yellow|жёлт|желт|сарик/i, '#e8b613'],
  [/jigar|brown|корич|bej|беж|beige|qum/i, '#a4825c'],
  [/to'q sariq|orange|оранж/i, '#e2701c'],
];

export function colorOf(name: string | null | undefined, seed: string): string {
  const n = (name ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(n)) return n;
  for (const [re, hex] of COLOR_WORDS) if (re.test(n)) return hex;
  // Rang yozilmagan — raqamga qarab xotirjam rang
  const palette = ['#f4f6f8', '#b9c0c8', '#2f6fd6', '#15181d', '#6f7782', '#b3202a', '#1f3b73'];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

// ─────────── Materiallar (bir marta) ───────────

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  return {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1b2632, metalness: 0.2, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.86, clearcoat: 1, clearcoatRoughness: 0.03 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.85, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc7ccd3, roughness: 0.25, metalness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.6, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.12, metalness: 1 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff1c4, emissiveIntensity: 0.6, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a0d12, emissive: 0xff1a1a, emissiveIntensity: 0.35, roughness: 0.2 }),
    bedFloor: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.9 }),
  };
}
export function materials() {
  return (shared ??= makeShared());
}

function plateTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 112);
  g.strokeStyle = '#111';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 104);
  g.fillStyle = '#111';
  g.font = 'bold 64px "DejaVu Sans Mono", Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 12), 256, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let shadowTex: THREE.CanvasTexture | null = null;
function shadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// ─────────── Geometriya ───────────

/** Pastki kuzov ustki chizig'i balandligi (chiziqli) */
function topY(s: Spec, x: number): number {
  const t = s.top;
  for (let i = 1; i < t.length; i++) {
    const [x0, y0] = t[i - 1]!;
    const [x1, y1] = t[i]!;
    if (x >= x0 && x <= x1) return x1 === x0 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return s.cabin.beltY;
}

function lowerShape(s: Spec): THREE.Shape {
  const sh = new THREE.Shape();
  const back = s.top[0]!;
  const front = s.top[s.top.length - 1]!;
  const ar = s.r + 0.07;
  sh.moveTo(front[0], s.y0);
  // Old g'ildirak arkasi
  sh.lineTo(s.xf + ar, s.y0);
  sh.absarc(s.xf, s.y0 + 0.02, ar, 0, Math.PI, false);
  sh.lineTo(s.xr + ar, s.y0);
  sh.absarc(s.xr, s.y0 + 0.02, ar, 0, Math.PI, false);
  sh.lineTo(back[0], s.y0);
  // Orqa yuz va ustki chiziq (silliq)
  const pts = s.top.map(([x, y]) => new THREE.Vector2(x, y));
  sh.lineTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1]!;
    const mid = new THREE.Vector2((prev.x + p.x) / 2, (prev.y + p.y) / 2);
    sh.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
  }
  sh.lineTo(front[0], front[1]);
  sh.lineTo(front[0], s.y0);
  return sh;
}

function extrude(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 18 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  g.computeVertexNormals();
  return g;
}

function segmentBox(a: THREE.Vector3, b: THREE.Vector3, thick: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, thick, thick), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  hood: THREE.Object3D | null;
  fuelDoor: THREE.Mesh;
  headlights: THREE.MeshStandardMaterial;
  paint: THREE.MeshPhysicalMaterial;
  length: number;
  width: number;
  height: number;
  dispose: () => void;
}

export function buildCar(opts: { body: VehicleBodyType; color: string; plate: string }): CarModel {
  const s = SPECS[opts.body];
  const M = materials();
  const group = new THREE.Group();
  const own: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (own.push(x), x);

  const paint = keep(new THREE.MeshPhysicalMaterial({ color: opts.color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const headlights = keep(M.head.clone());

  // Pastki kuzov
  const lower = new THREE.Mesh(keep(extrude(lowerShape(s), s.W, 0.07)), paint);
  lower.castShadow = true;
  group.add(lower);

  // Yuk qutisi (furgon)
  if (s.cargo) {
    const len = s.cargo.to - s.cargo.from;
    const h = s.cargo.top - s.top[1]![1] + 0.04;
    const box = new THREE.Mesh(keep(new RoundedBoxGeometry(len, h, s.W, 4, 0.08)), paint);
    box.position.set(s.cargo.from + len / 2, s.top[1]![1] - 0.04 + h / 2, 0);
    group.add(box);
  }

  // Pikap kuzovi — ichi to'q
  if (s.bed) {
    const len = s.bed.to - s.bed.from;
    const floor = new THREE.Mesh(keep(new THREE.BoxGeometry(len, 0.03, s.W - 0.16)), M.bedFloor);
    floor.position.set(s.bed.from + len / 2, s.top[1]![1] + 0.012, 0);
    group.add(floor);
  }

  // Salon: oyna va tom
  const c = s.cabin;
  const cab = new THREE.Shape();
  cab.moveTo(c.rearBase, c.beltY);
  cab.lineTo(c.rearRoof, c.roofY - 0.04);
  cab.quadraticCurveTo(c.rearRoof + 0.05, c.roofY, c.rearRoof + 0.18, c.roofY);
  cab.lineTo(c.frontRoof - 0.18, c.roofY);
  cab.quadraticCurveTo(c.frontRoof - 0.05, c.roofY, c.frontRoof, c.roofY - 0.04);
  cab.lineTo(c.frontBase, c.beltY);
  cab.lineTo(c.rearBase, c.beltY);
  const glassW = s.W * (opts.body === 'BUS' || opts.body === 'VAN' ? 0.97 : 0.88);
  const glass = new THREE.Mesh(keep(extrude(cab, glassW, 0.03)), M.glass);
  group.add(glass);

  const roofLen = c.frontRoof - c.rearRoof - 0.1;
  const roof = new THREE.Mesh(keep(new RoundedBoxGeometry(roofLen, 0.07, glassW + 0.04, 3, 0.03)), paint);
  roof.position.set((c.frontRoof + c.rearRoof) / 2, c.roofY + 0.01, 0);
  group.add(roof);

  // Ustunlar (A, C va oradagilar)
  for (const z of [glassW / 2 + 0.005, -glassW / 2 - 0.005]) {
    group.add(segmentBox(new THREE.Vector3(c.frontBase, c.beltY, z), new THREE.Vector3(c.frontRoof, c.roofY - 0.02, z), 0.06, paint));
    group.add(segmentBox(new THREE.Vector3(c.rearBase, c.beltY, z), new THREE.Vector3(c.rearRoof, c.roofY - 0.02, z), 0.07, paint));
    const n = s.pillars ?? 0;
    for (let i = 1; i <= n; i++) {
      const x = c.rearRoof + ((c.frontRoof - c.rearRoof) * i) / (n + 1);
      group.add(segmentBox(new THREE.Vector3(x, c.beltY, z), new THREE.Vector3(x, c.roofY - 0.02, z), 0.06, opts.body === 'BUS' ? M.trim : paint));
    }
  }

  // Kapot (ochiladigan): oyna tagidan old tomonga
  let hood: THREE.Object3D | null = null;
  if (opts.body !== 'BUS') {
    const front = s.top[s.top.length - 2]!;
    const start = new THREE.Vector2(c.frontBase + 0.02, topY(s, c.frontBase + 0.02));
    const end = new THREE.Vector2(front[0], front[1]);
    const len = start.distanceTo(end);
    if (len > 0.35) {
      const pivot = new THREE.Group();
      pivot.position.set(start.x, start.y + 0.012, 0);
      const plate = new THREE.Mesh(keep(new RoundedBoxGeometry(len, 0.04, s.W - 0.12, 3, 0.02)), paint);
      plate.position.set(len / 2, 0, 0);
      pivot.rotation.z = Math.atan2(end.y - start.y, end.x - start.x);
      pivot.add(plate);
      pivot.userData.base = pivot.rotation.z;
      group.add(pivot);
      hood = pivot;
      // Dvigatel (kapot ochilganda ko'rinadi)
      const eng = new THREE.Mesh(keep(new THREE.BoxGeometry(len * 0.6, 0.18, s.W * 0.5)), M.trim);
      eng.position.set(start.x + len * 0.45, start.y - 0.08, 0);
      group.add(eng);
    }
  }

  // G'ildiraklar
  const wheels: THREE.Object3D[] = [];
  const tireW = s.r * 0.72;
  const tireGeo = keep(new THREE.CylinderGeometry(s.r, s.r, tireW, 32));
  const rimGeo = keep(new THREE.CylinderGeometry(s.r * 0.62, s.r * 0.62, tireW + 0.02, 24));
  const spokeGeo = keep(new THREE.BoxGeometry(s.r * 1.1, 0.035, 0.05));
  for (const x of [s.xf, s.xr]) {
    for (const side of [1, -1]) {
      const w = new THREE.Group();
      w.position.set(x, s.r, side * (s.W / 2 - tireW / 2 + 0.03));
      const inner = new THREE.Group();
      inner.rotation.x = Math.PI / 2;
      inner.add(new THREE.Mesh(tireGeo, M.rubber));
      inner.add(new THREE.Mesh(rimGeo, M.rim));
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(spokeGeo, M.chrome);
        sp.rotation.y = (k * Math.PI * 2) / 5;
        sp.position.y = side * (tireW / 2 + 0.012);
        inner.add(sp);
      }
      w.add(inner);
      group.add(w);
      wheels.push(w);
    }
  }
  // Bus — orqa qo'shaloq emas, oddiy

  // Bamperlar
  const back = s.top[0]!;
  const front = s.top[s.top.length - 1]!;
  const bumperH = 0.16;
  for (const [x, dir] of [
    [front[0], 1],
    [back[0], -1],
  ] as const) {
    const b = new THREE.Mesh(keep(new RoundedBoxGeometry(0.16, bumperH, s.W * 0.98, 3, 0.05)), M.trim);
    b.position.set(x - dir * 0.03, s.y0 + bumperH / 2 + 0.02, 0);
    group.add(b);
  }

  // Faralar va stop-chiroqlar
  const lightY = Math.min(front[1], c.beltY) - 0.14;
  const tailY = Math.min(back[1], c.beltY) - 0.16;
  for (const z of [s.W * 0.34, -s.W * 0.34]) {
    const h = new THREE.Mesh(keep(new RoundedBoxGeometry(0.08, 0.12, s.W * 0.22, 2, 0.03)), headlights);
    h.position.set(front[0] + 0.02, lightY, z);
    group.add(h);
    const t = new THREE.Mesh(keep(new RoundedBoxGeometry(0.06, 0.12, s.W * 0.2, 2, 0.03)), M.tail);
    t.position.set(back[0] - 0.02, tailY, z);
    group.add(t);
  }
  // Panjara
  const grill = new THREE.Mesh(keep(new THREE.BoxGeometry(0.04, 0.14, s.W * 0.36)), M.trim);
  grill.position.set(front[0] + 0.025, lightY - 0.02, 0);
  group.add(grill);

  // Davlat raqamlari
  const tex = keep(plateTexture(opts.plate));
  const plateMat = keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
  const plateGeo = keep(new THREE.PlaneGeometry(0.52, 0.114));
  const pf = new THREE.Mesh(plateGeo, plateMat);
  pf.position.set(front[0] + 0.12, s.y0 + bumperH / 2 + 0.02, 0);
  pf.rotation.y = Math.PI / 2;
  group.add(pf);
  const pb = new THREE.Mesh(plateGeo, plateMat);
  pb.position.set(back[0] - 0.12, s.y0 + bumperH / 2 + 0.02, 0);
  pb.rotation.y = -Math.PI / 2;
  group.add(pb);

  // Ko'zgular
  for (const z of [glassW / 2 + 0.1, -glassW / 2 - 0.1]) {
    const m = new THREE.Mesh(keep(new RoundedBoxGeometry(0.1, 0.1, 0.16, 2, 0.03)), paint);
    m.position.set(c.frontBase - 0.08, c.beltY + 0.06, z);
    group.add(m);
  }

  // Benzin qopqog'i (o'ng orqa)
  const fuelDoor = new THREE.Mesh(keep(new THREE.CircleGeometry(0.075, 24)), keep(new THREE.MeshStandardMaterial({ color: opts.color, emissive: 0x000000, metalness: 0.5, roughness: 0.35 })));
  fuelDoor.position.set(s.cargo ? s.xr + 0.6 : s.xr - 0.38, Math.min(c.beltY, back[1]) - 0.2, -(s.W / 2 + 0.002));
  fuelDoor.rotation.y = Math.PI;
  group.add(fuelDoor);

  // Soya
  const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(s.L * 1.25, s.W * 1.6)), keep(new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  group.add(shadow);

  const height = Math.max(c.roofY, s.cargo?.top ?? 0) + 0.05;
  return {
    group,
    wheels,
    hood,
    fuelDoor,
    headlights,
    paint,
    length: s.L,
    width: s.W,
    height,
    dispose: () => own.forEach((x) => x.dispose()),
  };
}