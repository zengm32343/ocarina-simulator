import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Note } from './notes';
import { NOTE_ORDER, type OcarinaStyle } from './styles';

export interface OcarinaSceneOptions {
  /** Glaze colour of the procedural celadon ocarina. */
  color?: string;
  /** Glow colour for active holes and note particles. */
  glow?: string;
  /** Folder holding the scanned models, with trailing slash. */
  modelBase?: string;
}

export interface OcarinaScene {
  setActive(note: Note | null): void;
  /** Swap the displayed ocarina; resolves once it is on screen. */
  setStyle(style: OcarinaStyle): Promise<void>;
  dispose(): void;
}

/** How a hole is shown while a note sounds: lit ring (open, or the note's hole) or a finger dot (covered). */
type HoleState = 'open' | 'covered' | null;

/** A built ocarina: its object, hole anchors (+z = hole normal) and each note's hole states. */
interface Built {
  object: THREE.Object3D;
  holes: { anchor: THREE.Object3D; r: number }[];
  states: Record<Note, HoleState[]>;
}

/** One lit hole per note, holes listed in note order. */
const singleHoleStates = (count: number): Built['states'] =>
  Object.fromEntries(NOTE_ORDER.map((note, i) => [note, Array.from({ length: count }, (_, j) => (i === j ? 'open' : null))])) as Built['states'];

const LENGTH = 2.2;
const HEIGHT = 0.64;

/** How far the body curves back (away from the player) along its length. */
const bend = (x: number) => -0.32 * (x / LENGTH) ** 2;

/**
 * A 10-hole Italian ocarina: 8 finger holes on top, 2 thumb holes underneath.
 * x runs along the body, z across it (relative to the curved centre line).
 * Holes with a note light up while it sounds, rising in pitch from the round end to the tail.
 */
const HOLES: { note?: Note; x: number; z: number; r: number; under?: boolean }[] = [
  { note: 'A', x: -1.45, z: 0.08, r: 0.16 },
  { note: 'D', x: -0.95, z: -0.12, r: 0.15 },
  { x: -0.45, z: -0.2, r: 0.12 },
  { note: 'R', x: 0.05, z: -0.18, r: 0.15 },
  { x: 0.55, z: -0.1, r: 0.11 },
  { note: 'L', x: 1.0, z: 0.0, r: 0.14 },
  { x: 1.38, z: 0.04, r: 0.09 },
  { note: 'U', x: 1.72, z: 0.06, r: 0.1 },
  { x: -0.7, z: 0.15, r: 0.12, under: true },
  { x: 0.35, z: 0.1, r: 0.11, under: true },
];

function bodyGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 96, 64);
  geo.rotateZ(Math.PI / 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.x + 1) / 2; // 0 at the round end, 1 at the tail
    const taper = 1 - 0.62 * Math.pow(Math.max(0, t - 0.35) / 0.65, 1.4);
    const x = v.x * LENGTH;
    v.set(x, v.y * HEIGHT * taper, v.z * taper + bend(x));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Voronoi cell-edge distance at (px, py) in cell units, tiling horizontally. */
function cellEdge(px: number, py: number, cx: number, cy: number, seeds: readonly (readonly [number, number])[]): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let d1 = Infinity;
  let d2 = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    const gy = iy + dy;
    if (gy < 0 || gy >= cy) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const s = seeds[gy * cx + ((((ix + dx) % cx) + cx) % cx)];
      const d = Math.hypot(px - (ix + dx + s[0]), py - (gy + s[1]));
      if (d < d1) [d1, d2] = [d, d1];
      else if (d < d2) d2 = d;
    }
  }
  return d2 - d1;
}

/** Celadon crackle glaze: large and fine crack networks over the base colour, tileable around the body. */
function crackleTexture(base: string): THREE.CanvasTexture {
  const W = 1536;
  const H = 768;
  const layers = [
    { cx: 26, cy: 32, width: 0.03, strength: 0.5 },
    { cx: 62, cy: 76, width: 0.035, strength: 0.2 },
  ].map((l) => ({ ...l, seeds: Array.from({ length: l.cx * l.cy }, () => [Math.random(), Math.random()] as const) }));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const hex = new THREE.Color(base).getHex();
  const rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let shade = 1;
      for (const l of layers) {
        const edge = cellEdge((x / W) * l.cx, (y / H) * l.cy, l.cx, l.cy, l.seeds);
        shade -= Math.max(0, 1 - edge / l.width) * l.strength;
      }
      const i = (y * W + x) * 4;
      img.data[i] = rgb[0] * shade;
      img.data[i + 1] = rgb[1] * shade;
      img.data[i + 2] = rgb[2] * shade;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noteTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = '96px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♪', 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCeladon(color: string): Built {
  const object = new THREE.Group();
  const crackle = crackleTexture(color);
  const glaze = new THREE.MeshPhysicalMaterial({
    map: crackle,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const body = new THREE.Mesh(bodyGeometry(), glaze);
  object.add(body);

  const mouthGeometry = new THREE.CylinderGeometry(0.15, 0.3, 1.0, 40);
  mouthGeometry.scale(1.35, 1, 0.6);
  mouthGeometry.rotateX(Math.PI / 2);
  const mouthpiece = new THREE.Mesh(mouthGeometry, glaze);
  mouthpiece.rotation.y = -0.4;
  mouthpiece.position.set(-1.5, -0.12, 0.85 + bend(-1.5));
  object.add(mouthpiece);

  const dark = new THREE.MeshStandardMaterial({ color: '#16110c', roughness: 0.9 });
  const clay = new THREE.MeshStandardMaterial({ color: '#a08a70', roughness: 0.85 });
  const windway = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.05), dark);
  windway.position.set(0, 0, 0.501);
  mouthpiece.add(windway);

  const raycaster = new THREE.Raycaster();
  const surface = (x: number, z: number, under = false) => {
    const zc = z + bend(x);
    raycaster.set(new THREE.Vector3(x, under ? -5 : 5, zc), new THREE.Vector3(0, under ? 1 : -1, 0));
    const hit = raycaster.intersectObject(body)[0];
    if (!hit?.face) return null;
    const group = new THREE.Group();
    group.position.copy(hit.point);
    group.lookAt(hit.point.clone().add(hit.face.normal));
    object.add(group);
    return group;
  };

  const soundWindow = surface(-1.55, 0.36);
  if (soundWindow) {
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.09), dark);
    opening.position.z = 0.004;
    opening.rotation.z = 0.4;
    soundWindow.add(opening);
  }

  const holes: Built['holes'] = [];
  for (const h of HOLES) {
    const group = surface(h.x, h.z, h.under);
    if (!group) continue;
    const wall = new THREE.Mesh(new THREE.RingGeometry(h.r * 0.8, h.r, 32), clay);
    wall.position.z = 0.004;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(h.r * 0.8, 32), dark);
    hole.position.z = 0.005;
    group.add(wall, hole);
    if (h.note) holes[NOTE_ORDER.indexOf(h.note)] = { anchor: group, r: h.r };
  }
  return { object, holes, states: singleHoleStates(holes.length) };
}

function buildModel(gltf: GLTF, style: OcarinaStyle): Built {
  const object = gltf.scene.clone(true);
  object.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material = (obj.material as THREE.MeshStandardMaterial).clone();
    material.metalness = 0;
    if (style.roughness !== undefined) material.roughness = style.roughness;
    obj.material = material;
  });
  const holes: Built['holes'] = [];
  style.holes?.forEach((h) => {
    const normal = new THREE.Vector3(...h.n).normalize();
    const anchor = new THREE.Object3D();
    anchor.position.set(...h.p).addScaledVector(normal, 0.015);
    anchor.lookAt(anchor.position.clone().add(normal));
    object.add(anchor);
    holes.push({ anchor, r: h.r });
  });
  const fingerings = style.fingerings;
  const states = fingerings
    ? (Object.fromEntries(
        NOTE_ORDER.map((note) => [note, holes.map((_, i) => (fingerings[note].includes(i) ? 'open' : 'covered'))]),
      ) as Built['states'])
    : singleHoleStates(holes.length);
  return { object, holes, states };
}

export function createOcarinaScene(container: HTMLElement, options: OcarinaSceneOptions): OcarinaScene {
  const glowColor = new THREE.Color(options.glow ?? '#e6c25a');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.cursor = 'grab';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0.3, 4.2, 3.1);

  const key = new THREE.DirectionalLight('#fff1dc', 1.3);
  key.position.set(3, 6, 4);
  scene.add(key, new THREE.HemisphereLight('#fff8ee', '#2a1a10', 0.35));

  const ocarina = new THREE.Group();
  ocarina.rotation.y = -0.12;
  scene.add(ocarina);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.62;

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltfCache = new Map<string, Promise<GLTF>>();
  const builtCache = new Map<string, Built>();
  const glows: { ring: THREE.Mesh; dot: THREE.Mesh; anchor: THREE.Object3D }[] = [];
  let current: Built | null = null;
  const size = new THREE.Vector3(4.4, 1.3, 1.8);
  let radius = 2.4;
  let styleToken = 0;

  /** Distance at which the ocarina fills the view, whichever way it is turned around its vertical axis. */
  const fitCamera = () => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * camera.aspect;
    const halfWidth = Math.max(size.x, size.z) / 2;
    const halfHeight = (size.y * 0.6 + size.z * 0.8) / 2;
    const distance = Math.max(halfWidth / tanH, halfHeight / tanV) * 1.08;
    camera.position.setLength(distance);
    controls.minDistance = distance * 0.6;
    controls.maxDistance = distance * 1.8;
  };

  const show = (built: Built) => {
    if (current) ocarina.remove(current.object);
    for (const { ring, dot } of glows) {
      ring.removeFromParent();
      dot.removeFromParent();
    }
    glows.length = 0;
    current = built;
    ocarina.add(built.object);
    for (const { anchor, r } of built.holes) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.12, Math.max(r * 0.18, 0.012), 12, 40), glowMaterial.clone());
      ring.position.z = 0.01;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 32), glowMaterial.clone());
      dot.position.z = 0.014;
      anchor.add(ring, dot);
      glows.push({ ring, dot, anchor });
    }
    built.object.position.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(built.object);
    built.object.position.sub(box.getCenter(new THREE.Vector3()));
    box.getSize(size);
    radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    fitCamera();
  };

  const particleTexture = noteTexture(`#${glowColor.getHexString()}`);
  const particles: { sprite: THREE.Sprite; born: number; drift: number }[] = [];
  const spawnParticle = (note: Note) => {
    const states = current?.states[note];
    const lit = glows.filter((_, i) => states?.[i] === 'open');
    const hole = lit[0] ?? glows[0];
    if (!hole) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: particleTexture, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(radius * 0.13);
    hole.anchor.getWorldPosition(sprite.position);
    scene.add(sprite);
    particles.push({ sprite, born: performance.now(), drift: (Math.random() - 0.5) * 0.6 });
  };

  let active: Note | null = null;
  let pulse = 0;

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitCamera();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const clock = new THREE.Clock();
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!reduceMotion) {
      ocarina.position.y = Math.sin(t * 1.3) * 0.05;
      ocarina.rotation.x = Math.sin(t * 0.9) * 0.03;
    }
    pulse = Math.max(0, pulse - dt * 4);
    ocarina.scale.setScalar(1 + pulse * 0.025);
    const states = active ? current?.states[active] : undefined;
    glows.forEach((h, i) => {
      const ring = h.ring.material as THREE.MeshBasicMaterial;
      const dot = h.dot.material as THREE.MeshBasicMaterial;
      ring.opacity += ((states?.[i] === 'open' ? 1 : 0) - ring.opacity) * 0.25;
      dot.opacity += ((states?.[i] === 'covered' ? 0.85 : 0) - dot.opacity) * 0.25;
    });
    const now = performance.now();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = (now - p.born) / 1400;
      if (age >= 1) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        particles.splice(i, 1);
        continue;
      }
      p.sprite.position.y += radius * 0.0075;
      p.sprite.position.x += p.drift * radius * 0.005;
      p.sprite.material.opacity = 1 - age;
    }
    controls.update();
    renderer.render(scene, camera);
  };

  const visibility = new IntersectionObserver(([entry]) => {
    renderer.setAnimationLoop(entry?.isIntersecting ? tick : null);
  });
  visibility.observe(container);

  return {
    setActive(note) {
      if (note && note !== active) {
        pulse = 1;
        spawnParticle(note);
      }
      active = note;
    },
    async setStyle(style) {
      const token = ++styleToken;
      let built = builtCache.get(style.id);
      if (!built) {
        if (style.kind === 'procedural') {
          built = buildCeladon(options.color ?? '#0e8a94');
        } else {
          const url = `${options.modelBase ?? '/models/ocarina/'}${style.id}.glb`;
          if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url));
          const gltf = await gltfCache.get(url)!;
          built = buildModel(gltf, style);
        }
        builtCache.set(style.id, built);
      }
      if (token === styleToken) show(built);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      visibility.disconnect();
      resizeObserver.disconnect();
      controls.dispose();
      envTexture.dispose();
      pmrem.dispose();
      particleTexture.dispose();
      for (const built of builtCache.values()) {
        built.object.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          obj.geometry.dispose();
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
            for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
            m.dispose();
          }
        });
      }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
