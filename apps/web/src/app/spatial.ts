import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Layer, StudioDocument } from '../../../../packages/domain/src/document';
import { CanvasRenderer } from '../../../../packages/renderer/src/canvas-renderer';

/** A spatial preview the shell can drive after it is built. */
export interface SpatialPreview {
  /** Faces the planes head on and lets the pointer drift the camera, or returns to orbiting. */
  parallax(enabled: boolean): void;
  dispose(): void;
}

/** The depth between one plane and the next, in scene units. */
const PLANE_GAP = 0.15;
/** How far the camera drifts from the centre in parallax, as a share of the page. */
const DRIFT = 0.12;

/**
 * The planes of a document, one for every group. Every element of a group is painted on
 * the same plane, and a layer outside a group takes a plane of its own, so the depth of
 * the preview follows how the drawing is organised rather than how many pieces it has.
 */
export function spatialPlanes(layers: Layer[]): Layer[][] {
  const planes: Layer[][] = [];
  const byGroup = new Map<string, Layer[]>();
  for (const layer of layers) {
    const group = layer.groupPath?.[0];
    if (!group) {
      planes.push([layer]);
      continue;
    }
    const existing = byGroup.get(group);
    if (existing) {
      existing.push(layer);
      continue;
    }
    const plane = [layer];
    byGroup.set(group, plane);
    planes.push(plane);
  }
  return planes;
}

export async function createSpatialPreview(
  host: HTMLElement,
  document: StudioDocument,
  canvasRenderer: CanvasRenderer,
): Promise<SpatialPreview> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor('#121720');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.1, 100);
  camera.position.set(3, 2, 5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const width = document.width / 400;
  const height = document.height / 400;
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: document.background, side: THREE.DoubleSide }),
  );
  scene.add(background);
  geometries.push(background.geometry);
  materials.push(background.material);
  const planes = spatialPlanes(document.layers.filter((layer) => layer.visible && !layer.guide));
  let index = 0;
  for (const plane of planes) {
    const single = {
      ...document,
      background: '#ffffff',
      layers: plane.map((layer) => ({ ...layer, blend: 'source-over' as const })),
    };
    const canvas = await canvasRenderer.export(single, true);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = ++index * PLANE_GAP;
    scene.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: '#3979ff' });
    const outline = new THREE.LineSegments(edges, lineMaterial);
    outline.position.copy(mesh.position);
    scene.add(outline);
    geometries.push(edges);
    materials.push(lineMaterial);
  }
  const axes = new THREE.AxesHelper(1);
  axes.position.set(-width / 2 - 0.3, -height / 2 - 0.3, 0);
  scene.add(axes);
  const resize = new ResizeObserver(() => {
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);

  // In parallax the camera looks at the middle of the stack from the front, and follows
  // the pointer only a little, so the near planes travel further across than the far ones.
  const middle = new THREE.Vector3(0, 0, (index + 1) * PLANE_GAP * 0.5);
  const distance = Math.max(width, height) * 1.8 + index * PLANE_GAP;
  const pointer = { x: 0, y: 0 };
  let parallax = false;
  const follow = (event: PointerEvent) => {
    const box = renderer.domElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    pointer.y = ((event.clientY - box.top) / box.height) * 2 - 1;
  };
  renderer.domElement.addEventListener('pointermove', follow);
  const setParallax = (enabled: boolean) => {
    parallax = enabled;
    controls.enabled = !enabled;
    if (!enabled) return;
    pointer.x = 0;
    pointer.y = 0;
    camera.position.set(middle.x, middle.y, middle.z + distance);
    camera.lookAt(middle);
  };

  renderer.setAnimationLoop(() => {
    if (parallax) {
      const target = new THREE.Vector3(
        middle.x + pointer.x * width * DRIFT,
        middle.y - pointer.y * height * DRIFT,
        middle.z + distance,
      );
      camera.position.lerp(target, 0.08);
      camera.lookAt(middle);
    } else controls.update();
    renderer.render(scene, camera);
  });
  return {
    parallax: setParallax,
    dispose: () => {
      resize.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointermove', follow);
      controls.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      axes.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
