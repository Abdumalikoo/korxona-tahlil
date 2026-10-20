'use client';

import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { bodyTypeOf, type VehicleItem, type VehicleRecordKind } from '../api';
import { buildCar, colorOf, type CarModel } from './model';
import { createStage, webglAvailable, type Stage } from './stage';

// ═══════════════════════════════════════════════════════════
// Bitta mashina 3D'da — aylanadigan podiumda. Sichqoncha / barmoq bilan buriladi.
// Xarajat turiga qarab jonlanadi:
//   Benzin — benzin qopqog'i yonadi, tomchilar; Moyka — ko'piklar; Ta'mir / Texnik xizmat — kapot ochiladi;
//   Boshqa — faralar miltillaydi.
// ═══════════════════════════════════════════════════════════

export function Car3DViewer({ vehicle, highlight, className }: { vehicle: Pick<VehicleItem, 'id' | 'model' | 'plateNumber' | 'color'> & { bodyType?: VehicleItem['bodyType'] }; highlight?: VehicleRecordKind | null; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const car = useRef<CarModel | null>(null);
  const fx = useRef<{ kind: VehicleRecordKind | null; since: number }>({ kind: null, since: 0 });
  const [failed, setFailed] = useState(false);
  const body = bodyTypeOf(vehicle);
  const color = colorOf(vehicle.color, vehicle.plateNumber);

  // Sahna — bir marta
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!webglAvailable()) {
      setFailed(true);
      return;
    }
    let st: Stage;
    try {
      st = createStage(el, { camera: [5.6, 2.4, 5.6], target: [0, 0.75, 0], fov: 30 });
    } catch {
      setFailed(true);
      return;
    }
    stage.current = st;

    // Podium
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.0, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.6, metalness: 0.1 }));
    disc.position.y = -0.04;
    st.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.92, 0.025, 8, 96), new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    st.scene.add(ring);

    // Effektlar: tomchilar / ko'piklar
    const N = 60;
    const pts = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      seed[i] = Math.random();
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = Math.random() * 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
    }
    pts.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ptsMat = new THREE.PointsMaterial({ size: 0.09, color: 0x8fd3ff, transparent: true, opacity: 0, depthWrite: false });
    const points = new THREE.Points(pts, ptsMat);
    st.scene.add(points);

    st.onFrame((dt, t) => {
      const c = car.current;
      if (!c) return;
      if (fx.current.since < 0) fx.current.since = t;
      const k = fx.current.kind;
      const age = t - fx.current.since;
      // G'ildiraklar sekin aylanadi, kuzov yengil tebranadi (dvigatel ishlayapti)
      for (const w of c.wheels) w.rotation.z -= dt * (st.reducedMotion ? 0 : 1.2);
      c.group.position.y = st.reducedMotion ? 0 : Math.sin(t * 9) * 0.004;
      // Kapot
      if (c.hood) {
        const base = c.hood.userData.base as number;
        const target = k === 'REPAIR' || k === 'SERVICE' ? base + 0.75 : base;
        c.hood.rotation.z += (target - c.hood.rotation.z) * Math.min(1, dt * 5);
      }
      // Benzin qopqog'i
      const fd = c.fuelDoor.material as THREE.MeshStandardMaterial;
      fd.emissive.setHex(k === 'FUEL' ? 0x22c55e : 0x000000);
      fd.emissiveIntensity = k === 'FUEL' ? 0.6 + Math.sin(t * 6) * 0.4 : 0;
      // Faralar
      c.headlights.emissiveIntensity = k === 'OTHER' ? (Math.sin(t * 10) > 0 ? 1.6 : 0.2) : age < 1.2 ? 1.6 - age : 0.6;
      // Zarrachalar
      const wantPts = k === 'WASH' || k === 'FUEL';
      ptsMat.opacity += ((wantPts ? 0.85 : 0) - ptsMat.opacity) * Math.min(1, dt * 4);
      if (ptsMat.opacity > 0.01) {
        ptsMat.color.setHex(k === 'FUEL' ? 0xfbbf24 : 0x8fd3ff);
        ptsMat.size = k === 'FUEL' ? 0.06 : 0.11;
        const a = pts.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < N; i++) {
          let y = a.getY(i) + dt * (k === 'FUEL' ? -1.4 : 0.5 + seed[i]! * 0.6);
          if (k === 'FUEL') {
            // Tomchilar benzin qopqog'iga tushadi
            if (y < 0.6) y = 2.2;
            a.setX(i, c.fuelDoor.position.x + Math.sin(i) * 0.08);
            a.setZ(i, c.fuelDoor.position.z - 0.25 + Math.cos(i) * 0.08);
          } else if (y > c.height + 0.6) {
            y = 0.1;
            a.setX(i, (seed[i]! - 0.5) * c.length * 1.1);
            a.setZ(i, (Math.sin(i * 7.3) * c.width) / 1.6);
          }
          a.setY(i, y);
        }
        a.needsUpdate = true;
      }
    });

    return () => {
      car.current?.dispose();
      car.current = null;
      ptsMat.dispose();
      st.dispose();
      stage.current = null;
    };
  }, []);

  // Mashina — tur, rang yoki raqam o'zgarsa qayta quriladi
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const c = buildCar({ body, color, plate: vehicle.plateNumber });
    const scale = Math.min(1, 4.8 / c.length);
    c.group.scale.setScalar(scale);
    st.scene.add(c.group);
    car.current = c;
    st.controls.target.set(0, (c.height * scale) / 2, 0);
    const d = 5.2 + Math.max(0, c.length * scale - 4) * 0.6;
    st.camera.position.setLength(d * 1.5);
    return () => {
      st.scene.remove(c.group);
      c.dispose();
      if (car.current === c) car.current = null;
    };
  }, [body, color, vehicle.plateNumber]);

  useEffect(() => {
    // Vaqt sahna soatidan keyingi kadrda olinadi
    fx.current = { kind: highlight ?? null, since: -1 };
  }, [highlight]);

  return (
    <div className={cn('relative overflow-hidden bg-gradient-to-b from-slate-50 to-slate-200/70', className)}>
      <div ref={box} className="absolute inset-0" aria-label={`${vehicle.model} ${vehicle.plateNumber} — 3D ko'rinish`} />
      {failed && <p className="absolute inset-0 flex items-center justify-center text-xs text-(--color-text-muted)">3D ko&apos;rinish bu brauzerda ishlamaydi</p>}
    </div>
  );
}