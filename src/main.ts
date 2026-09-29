import * as THREE from 'three';
import '@fontsource/big-shoulders-display/latin-700';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/barlow/latin-400';
import '@fontsource/barlow/latin-500';
import '@fontsource/barlow/latin-600';
import '@fontsource/ibm-plex-mono/latin-400';
import '@fontsource/ibm-plex-mono/latin-500';
import './ui/styles.css';
import { Game } from './Game';
import { RTSCamera } from './camera/RTSCamera';
import { Input } from './core/Input';
import { showCountryPicker, showLoading } from './ui/CountryPicker';
import { loadCountry, loadCountryIndex } from './world/CountryData';
import { HORIZON_COLOR } from './world/Sky';

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(HORIZON_COLOR);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

renderer.domElement.tabIndex = 0;
const input = new Input(renderer.domElement);
const rig = new RTSCamera(innerWidth / innerHeight);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  rig.resize(innerWidth / innerHeight);
});

const timer = new THREE.Timer();
let frames = 0;
let game: Game | null = null;

renderer.setAnimationLoop((now) => {
  timer.update(now);
  if (!game) return;
  game.update(timer.getDelta(), timer.getElapsed());
  game.render();
  frames++;
});

async function startCountry(iso: string) {
  const done = showLoading(`Loading ${iso}…`);
  try {
    const data = await loadCountry(iso);
    game?.dispose();
    game = await Game.create(data, renderer, rig, input, { fresh: new URLSearchParams(location.search).has('fresh') });
    rig.attach(game.world.hf);
    rig.setPose({ focus: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: THREE.MathUtils.degToRad(55), distance: game.world.extent * 0.85 });
    rig.setHome();
    // Debug / test hook (used by the Playwright scripts).
    const g = game;
    (window as unknown as { __game: unknown }).__game = {
      game: g, renderer, rig, input, THREE,
      get world() { return g.world; },
      get placement() { return g.placement; },
      get buildings() { return g.buildings; },
      get treasury() { return g.treasury; },
      get territory() { return g.territory; },
      get frames() { return frames; },
      get clock() { return g.clock; },
      advance: (seconds: number) => g.advance(seconds),
    };
  } finally {
    done();
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('sheet')) {
    // Dev-only contact sheet of every building.
    const { showSheet } = await import('./dev/sheet');
    const only = params.get('sheet')?.split(',').filter(Boolean);
    showSheet({ primary: '#dc143c', secondary: '#f2f2f2' }, only?.length ? only : undefined);
    return;
  }
  const requested = params.get('country');
  if (requested) return startCountry(requested.toUpperCase());
  const countries = await loadCountryIndex();
  const close = showCountryPicker(countries, (iso) => {
    close();
    void startCountry(iso);
  });
}

void boot();
