import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// ═══════════════════════════════════════════════════════════
// 3D sahna: renderer, yorug'lik, aks (RoomEnvironment — tashqi fayl yo'q), aylantirish (OrbitControls),
// o'lcham kuzatuvi, ko'rinmayotganda to'xtash, «harakatni kamaytirish» sozlamasini hurmat qilish.
// ═══════════════════════════════════════════════════════════

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer | null;
  controls: OrbitControls;
  reducedMotion: boolean;
  onFrame: (cb: (dt: number, t: number) => void) => void;
  dispose: () => void;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createStage(
  container: HTMLElement,
  opts: { fov?: number; camera: [number, number, number]; target?: [number, number, number]; labels?: boolean; zoom?: boolean; minDistance?: number; maxDistance?: number; autoRotate?: boolean },
): Stage {
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  let labels: CSS2DRenderer | null = null;
  if (opts.labels) {
    labels = new CSS2DRenderer();
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    container.appendChild(labels.domElement);
  }

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 10, 4);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 32, 1, 0.1, 400);
  camera.position.set(...opts.camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...(opts.target ?? [0, 0.6, 0]));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = opts.zoom ?? false;
  controls.minDistance = opts.minDistance ?? 3;
  controls.maxDistance = opts.maxDistance ?? 60;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.autoRotate = (opts.autoRotate ?? true) && !reducedMotion;
  controls.autoRotateSpeed = 1.1;
  controls.update();

  const frames: ((dt: number, t: number) => void)[] = [];
  const clock = new THREE.Clock();
  let visible = true;
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    labels?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)));
  io.observe(container);

  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) {
      clock.getDelta();
      return;
    }
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    for (const f of frames) f(dt, t);
    controls.update();
    renderer.render(scene, camera);
    labels?.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    labels,
    controls,
    reducedMotion,
    onFrame: (cb) => frames.push(cb),
    dispose: () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      env.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry && !(m.geometry.userData as { shared?: boolean }).shared) m.geometry.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels?.domElement.remove();
    },
  };
}