import * as THREE from 'three';
import { createBuildingGroup } from '../buildings/PieceFactory';
import { getMaterials } from '../buildings/materials';
import type { BuildingDef } from '../buildings/types';
import type { CountryColors } from '../world/CountryData';

/**
 * Renders finished buildings to small transparent PNGs (build-menu cards and strategic-zoom map
 * markers) using a private offscreen WebGL context, with a cache per building.
 */
export class IconRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 500);
  private readonly cache = new Map<string, string>();
  private readonly light = new THREE.DirectionalLight(0xfff1d6, 2.8);

  constructor(
    private readonly colors: CountryColors,
    private readonly width = 256,
    private readonly height = 192,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.scene.add(new THREE.HemisphereLight(0xdcebff, 0x6a6553, 1.3));
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.0005;
    this.scene.add(this.light, this.light.target);
  }

  /** PNG data URL for the building (cached). */
  icon(def: BuildingDef): string {
    const hit = this.cache.get(def.id);
    if (hit) return hit;
    const url = this.render(def);
    this.cache.set(def.id, url);
    return url;
  }

  private render(def: BuildingDef): string {
    const mats = getMaterials(this.colors);
    const group = createBuildingGroup(def, mats);
    // A slightly raised platform matching the footprint gives the icon a base and receives the shadow.
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(def.footprint.w + 0.7, 0.1, def.footprint.d + 0.7),
      new THREE.MeshStandardMaterial({ color: 0x5f7f4a, roughness: 1, flatShading: true }),
    );
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.scene.add(group, ground);

    const box = new THREE.Box3().setFromObject(group).union(new THREE.Box3().setFromObject(ground));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const az = THREE.MathUtils.degToRad(32);
    const el = THREE.MathUtils.degToRad(33);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    // Closest camera distance at which every corner of the bounding box fits with a little margin.
    const fits = (dist: number) => {
      this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
      this.camera.lookAt(sphere.center);
      this.camera.near = 0.05;
      this.camera.far = dist + sphere.radius * 3;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      return corners.every((c) => {
        // A corner behind the camera can project to a small NDC value and falsely "fit", which
        // would break the monotonic search, so require it to be in front first.
        if (c.clone().applyMatrix4(this.camera.matrixWorldInverse).z > -0.05) return false;
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) <= 0.9 && Math.abs(p.y) <= 0.86;
      });
    };
    let lo = sphere.radius * 0.5;
    let hi = sphere.radius * 12;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const dist = hi;
    fits(dist);
    this.camera.near = Math.max(0.05, dist - sphere.radius * 1.5);
    this.camera.updateProjectionMatrix();

    // Sun from the front-left, shadow frustum fitted to the building.
    this.light.position.copy(sphere.center).add(new THREE.Vector3(-0.6, 1.0, 0.7).normalize().multiplyScalar(sphere.radius * 4));
    this.light.target.position.copy(sphere.center);
    const s = sphere.radius * 1.3;
    const sc = this.light.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.near = 0.1; sc.far = sphere.radius * 10;
    sc.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');

    this.scene.remove(group, ground);
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    return url;
  }

  dispose() {
    this.renderer.dispose();
    this.cache.clear();
  }
}
