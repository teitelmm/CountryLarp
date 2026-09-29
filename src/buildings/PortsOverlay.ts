import * as THREE from 'three';
import { PORT_COLORS, PORT_LABEL } from '../ui/InspectPanel';
import type { BuildingManager } from './BuildingManager';
import type { PortKind } from './types';

/**
 * Debug/preview overlay (toggle with P): draws each building's 3D supply ports as glowing glyphs. These
 * anchors are where a later supply-line phase will attach roads, rails, sea lanes, pipelines, air links
 * and power lines, so they can be checked in place before anything is built on them.
 */
export class PortsOverlay {
  private mesh: THREE.InstancedMesh | null = null;
  private visible = false;
  private lastVersion = -1;
  private readonly legend = document.createElement('div');
  private positions: THREE.Vector3[] = [];
  private readonly tmp = new THREE.Object3D();
  private readonly geometry = new THREE.OctahedronGeometry(0.5);
  private readonly material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false });

  constructor(private readonly scene: THREE.Object3D, private readonly buildings: BuildingManager) {
    this.legend.className = 'ports-legend';
    this.legend.style.display = 'none';
    this.legend.innerHTML = `<div class="pl-title">Supply ports (P)</div>` +
      (Object.keys(PORT_COLORS) as PortKind[]).map((k) => `<span><i style="background:${PORT_COLORS[k]}"></i>${PORT_LABEL[k]}</span>`).join('');
    document.body.appendChild(this.legend);
  }

  get isVisible() {
    return this.visible;
  }

  /** Number of port glyphs currently drawn. */
  get count() {
    return this.positions.length;
  }

  toggle(on = !this.visible) {
    this.visible = on;
    this.legend.style.display = on ? 'flex' : 'none'; // flex: the stylesheet lays the legend out as a column
    if (this.mesh) this.mesh.visible = on;
    this.lastVersion = -1; // rebuild on next update
  }

  private rebuild() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    const items: Array<{ p: THREE.Vector3; color: THREE.Color }> = [];
    for (const b of this.buildings.all) {
      b.root.updateMatrixWorld(true);
      for (const port of b.def.ports) {
        items.push({ p: new THREE.Vector3(...port.pos).applyMatrix4(b.root.matrixWorld), color: new THREE.Color(PORT_COLORS[port.kind]) });
      }
    }
    this.positions = items.map((i) => i.p);
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, items.length);
    items.forEach((it, i) => mesh.setColorAt(i, it.color));
    mesh.renderOrder = 16;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  update(cameraDistance: number) {
    if (!this.visible) return;
    if (this.buildings.version !== this.lastVersion) {
      this.lastVersion = this.buildings.version;
      this.rebuild();
    }
    if (!this.mesh) return;
    const s = THREE.MathUtils.clamp(cameraDistance * 0.024, 0.32, 7);
    const t = this.tmp;
    this.positions.forEach((p, i) => {
      t.position.copy(p);
      t.scale.setScalar(s);
      t.updateMatrix();
      this.mesh!.setMatrixAt(i, t.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.geometry.dispose();
    this.material.dispose();
    this.legend.remove();
  }
}
