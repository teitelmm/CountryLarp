import * as THREE from 'three';
import './ui/styles.css';
import { RTSCamera } from './camera/RTSCamera';
import { showCountryPicker, showLoading } from './ui/CountryPicker';
import { loadCountry, loadCountryIndex } from './world/CountryData';
import { HORIZON_COLOR } from './world/Sky';
import { World } from './world/World';

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(HORIZON_COLOR);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const rig = new RTSCamera(innerWidth / innerHeight);
let world: World | null = null;

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  rig.resize(innerWidth / innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  if (!world) return;
  world.update(timer.getElapsed(), rig, renderer);
  renderer.render(world.scene, rig.camera);
});

async function startCountry(iso: string) {
  const done = showLoading(`Loading ${iso}…`);
  try {
    const data = await loadCountry(iso);
    world?.dispose();
    world = new World(data);
    rig.maxDistance = world.extent * 1.15;
    rig.setPose({ focus: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: THREE.MathUtils.degToRad(55), distance: world.extent * 0.85 });
    (window as unknown as { __game: unknown }).__game = { renderer, rig, get world() { return world; }, THREE };
  } finally {
    done();
  }
}

async function boot() {
  const requested = new URLSearchParams(location.search).get('country');
  if (requested) return startCountry(requested.toUpperCase());
  const countries = await loadCountryIndex();
  const close = showCountryPicker(countries, (iso) => {
    close();
    void startCountry(iso);
  });
}

void boot();
