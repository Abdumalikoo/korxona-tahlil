'use client';

import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { bodyTypeOf, type VehicleItem } from '../api';
import { buildCar, colorOf, type CarModel } from './model';
import { createStage, webglAvailable, type Stage } from './stage';

// ═══════════════════════════════════════════════════════════
// 3D avtopark: hamma mashinalar to'xtash joyida — guruhlar bo'yicha qatorlarda.
// Har mashina ustida: davlat raqami va tanlangan oydagi xarajati. Shu oyda xarajati bo'lganlarning faralari yonadi.
// Bosilgan mashina ko'tariladi, g'ildiraklari aylanadi, kamera unga buriladi.
// ═══════════════════════════════════════════════════════════

interface Slot {
  id: string;
  car: CarModel;
  label: CSS2DObject;
  home: THREE.Vector3;
}

const MAX_PER_ROW = 4;

export function Garage3D({
  vehicles,
  groups,
  selectedId,
  onSelect,
  className,
}: {
  vehicles: VehicleItem[];
  groups: { value: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const slots = useRef<Slot[]>([]);
  const selected = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  // Eng so'nggi qiymat — render paytida emas, effektda
  useLayoutEffect(() => {
    onSelectRef.current = onSelect;
  });
  const [failed, setFailed] = useState(false);

  // Kamera faqat foydalanuvchi tanlaganda mashinaga buriladi (birinchi avtomatik tanlovda — butun avtopark)
  const follow = useRef(false);
  const firstSel = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (firstSel.current === undefined) {
      if (selectedId) firstSel.current = selectedId;
    } else if (selectedId !== firstSel.current) follow.current = true;
    selected.current = selectedId;
    for (const s of slots.current) s.label.element.classList.toggle('is-on', s.id === selectedId);
  }, [selectedId]);

  // Sahna
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!webglAvailable()) {
      setFailed(true);
      return;
    }
    let st: Stage;
    try {
      st = createStage(el, { camera: [22, 15, 22], target: [0, 0, 0], fov: 35, labels: true, zoom: true, minDistance: 6, maxDistance: 80, autoRotate: false });
    } catch {
      setFailed(true);
      return;
    }
    stage.current = st;
    st.scene.fog = new THREE.Fog(0xeef2f7, 60, 140);

    // Asfalt va chiziqlar
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    st.scene.add(ground);

    // Tanlov halqasi
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 64), new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    ring.visible = false;
    st.scene.add(ring);

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = (ev: PointerEvent): Slot | null => {
      const r = st.renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, st.camera);
      const hits = ray.intersectObjects(
        slots.current.map((s) => s.car.group),
        true,
      );
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.vehicleId) o = o.parent;
        if (o) return slots.current.find((s) => s.id === o!.userData.vehicleId) ?? null;
      }
      return null;
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const s = hit(e);
      if (s) onSelectRef.current(s.id);
    };
    const onMove = (e: PointerEvent) => {
      st.renderer.domElement.style.cursor = hit(e) ? 'pointer' : 'grab';
    };
    st.renderer.domElement.addEventListener('pointerdown', onDown);
    st.renderer.domElement.addEventListener('pointerup', onUp);
    st.renderer.domElement.addEventListener('pointermove', onMove);

    const focus = new THREE.Vector3();
    st.onFrame((dt, t) => {
      const sel = slots.current.find((s) => s.id === selected.current) ?? null;
      for (const s of slots.current) {
        const on = s === sel;
        const y = on ? 0.25 + (st.reducedMotion ? 0 : Math.sin(t * 2.4) * 0.06) : 0;
        s.car.group.position.y += (y - s.car.group.position.y) * Math.min(1, dt * 6);
        if (on && !st.reducedMotion) for (const w of s.car.wheels) w.rotation.z -= dt * 6;
      }
      if (sel) {
        ring.visible = true;
        ring.position.x = sel.home.x;
        ring.position.z = sel.home.z;
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 4) * 0.3;
        if (follow.current) {
          focus.set(sel.home.x, 0.8, sel.home.z);
          st.controls.target.lerp(focus, Math.min(1, dt * 2.5));
        }
      } else ring.visible = false;
    });

    return () => {
      st.renderer.domElement.removeEventListener('pointerdown', onDown);
      st.renderer.domElement.removeEventListener('pointerup', onUp);
      st.renderer.domElement.removeEventListener('pointermove', onMove);
      for (const s of slots.current) s.car.dispose();
      slots.current = [];
      st.dispose();
      stage.current = null;
    };
  }, []);

  // Mashinalar
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    for (const s of slots.current) {
      st.scene.remove(s.car.group);
      s.label.removeFromParent();
      s.car.dispose();
    }
    slots.current = [];
    const extra = st.scene.getObjectByName('rows');
    if (extra) {
      st.scene.remove(extra);
      extra.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const rows = new THREE.Group();
    rows.name = 'rows';
    st.scene.add(rows);

    // Guruhlar → qatorlar
    const order = [...groups.map((g) => g.value), ''];
    const byGroup = order
      .map((g) => ({ g, label: groups.find((x) => x.value === g)?.label ?? 'Guruhsiz', items: vehicles.filter((v) => (v.fleetGroup ?? '') === g) }))
      .filter((x) => x.items.length);
    const max = Math.max(1, ...vehicles.map((v) => Number(v.month.totalTiyin)));
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const SLOT = 3.7;
    const ROW = 8.5;
    const GAP = 3.4;
    // Guruhlar bloklari: yonma-yon (Z bo'ylab), sig'masa — keyingi «ko'cha» orqada; blok ichida 4 tadan qator
    const MAX_PER_ROW_ = MAX_PER_ROW;
    const blocks = byGroup.map((g) => ({ ...g, cols: Math.min(MAX_PER_ROW_, g.items.length), rows: Math.ceil(g.items.length / MAX_PER_ROW_) }));
    const lineMax = Math.max(24, ...blocks.map((b) => b.cols * SLOT));
    const lines: { blocks: typeof blocks; width: number; depth: number }[] = [];
    for (const b of blocks) {
      const w = b.cols * SLOT;
      const cur = lines[lines.length - 1];
      if (cur && cur.width + GAP + w <= lineMax) {
        cur.blocks.push(b);
        cur.width += GAP + w;
        cur.depth = Math.max(cur.depth, b.rows);
      } else lines.push({ blocks: [b], width: w, depth: b.rows });
    }
    let xLine = 0;
    let totalW = 0;
    for (const line of lines) {
      totalW = Math.max(totalW, line.width);
      let z0 = -line.width / 2;
      for (const g of line.blocks) {
        const bw = g.cols * SLOT;
        const tag = document.createElement('div');
        tag.className = 'garage-group';
        tag.textContent = `${g.label} · ${g.items.length}`;
        const lbl = new CSS2DObject(tag);
        lbl.position.set(xLine + 3.6, 0, z0 + bw / 2);
        rows.add(lbl);
        g.items.forEach((v, idx) => {
          const r = Math.floor(idx / MAX_PER_ROW_);
          const c = idx % MAX_PER_ROW_;
          const x = xLine - r * ROW;
          const z = z0 + SLOT / 2 + c * SLOT;
          const car = buildCar({ body: bodyTypeOf(v), color: colorOf(v.color, v.plateNumber), plate: v.plateNumber });
          const scale = car.length > 6 ? 0.62 : 1;
          car.group.scale.setScalar(scale);
          car.group.position.set(x, 0, z);
          car.group.userData.vehicleId = v.id;
          const active = Number(v.month.totalTiyin) > 0;
          car.headlights.emissiveIntensity = active ? 1.4 : 0.05;
          if (!v.isActive) car.paint.color.lerp(new THREE.Color(0x9aa1ab), 0.6);
          st.scene.add(car.group);
          // Joy chiziqlari
          for (const dz of [-SLOT / 2, SLOT / 2]) {
            const line = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.08), lineMat);
            line.rotation.x = -Math.PI / 2;
            line.position.set(x - 0.3, 0.005, z + dz);
            rows.add(line);
          }
          // Yorliq
          const el = document.createElement('button');
          el.type = 'button';
          el.className = cn('garage-tag', selected.current === v.id && 'is-on');
          const share = Number(v.month.totalTiyin) / max;
          // Matn DOM orqali (innerHTML emas): davlat raqami foydalanuvchi kiritadi — HTML sifatida o'qilmasin
          const plate = document.createElement('b');
          plate.textContent = v.plateNumber;
          const sum = document.createElement('span');
          sum.textContent = active ? formatTiyin(v.month.totalTiyin) : '—';
          const bar = document.createElement('i');
          bar.style.width = `${Math.max(0, Math.min(100, Math.round((Number.isFinite(share) ? share : 0) * 100)))}%`;
          el.append(plate, sum, bar);
          el.title = `${v.model}${v.driverName ? ` · ${v.driverName}` : ''}`;
          el.addEventListener('click', () => onSelectRef.current(v.id));
          const label = new CSS2DObject(el);
          label.position.set(0, car.height * scale + 0.5, 0);
          car.group.add(label);
          slots.current.push({ id: v.id, car, label, home: new THREE.Vector3(x, 0, z) });
        });
        z0 += bw + GAP;
      }
      xLine -= line.depth * ROW + 2.5;
    }
    const depth = Math.max(0, -xLine - 2.5 - ROW);
    // Kamera — butun avtoparkni ko'radigan qilib (oldidan, biroz yuqoridan)
    const cx = -depth / 2;
    st.controls.target.set(cx, 0.6, 0);
    const vfov = (st.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.6, st.camera.aspect));
    const dist = Math.max(12, ((totalW + 4) / 2 / Math.tan(hfov / 2)) * 1.05, depth * 1.7 + 10);
    st.camera.position.set(cx + dist * 0.8, dist * 0.6, dist * 0.14);
    st.controls.update();
  }, [vehicles, groups]);

  return (
    <div className={cn('garage3d relative overflow-hidden bg-gradient-to-b from-sky-50 to-slate-200', className)}>
      <div ref={box} className="absolute inset-0" />
      {failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-(--color-text-muted)">3D ko&apos;rinish bu brauzerda ishlamaydi (WebGL o&apos;chirilgan)</p>}
      <style>{`
        .garage3d .garage-tag{pointer-events:auto;position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;padding:3px 8px 5px;border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(15,23,42,.18);font:600 11px/1.2 ui-sans-serif,system-ui;color:#0f172a;white-space:nowrap;cursor:pointer;overflow:hidden;border:2px solid transparent;transform:translateY(-4px)}
        .garage3d .garage-tag b{font-family:ui-monospace,Consolas,monospace;letter-spacing:.04em}
        .garage3d .garage-tag span{font-weight:500;color:#475569;font-size:10px}
        .garage3d .garage-tag i{position:absolute;left:0;bottom:0;height:3px;background:#2563eb}
        .garage3d .garage-tag.is-on{border-color:#2563eb;background:#eff6ff}
        .garage3d .garage-group{font:700 12px ui-sans-serif,system-ui;color:#334155;background:rgba(255,255,255,.75);padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.06em}
      `}</style>
    </div>
  );
}