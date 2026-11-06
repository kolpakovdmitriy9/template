// Portfolio scene: the map inside #map-rect, seen through a camera that cannot be controlled by the user.
// The rectangle sits in a tall "track" (its parent) and is pinned with `position: sticky`.
//   1. When the rectangle has fully appeared the camera is in a low perspective view along the street (wide lens, 3D).
//      The car drives in from the BOTTOM of the screen straight into the map and goes off into the distance.
//   2. Then the user scrolls (the rectangle stays pinned): the camera flies to a straight top-down view (the lens narrows
//      to almost orthographic) and follows the car, which keeps driving the whole time.
// The map is clipped to the rectangle (scissor); the car is drawn on top of the page, so it can be outside the rectangle too
// (with its own soft shadow). The view never leaves the map once it is top-down, so there is never an empty area.
// The world is flat (data/scene-flat.json): no hills or bumps for the car or the camera.
//
// Embed:  <div class="map-track"><div id="map-rect"></div></div> + <canvas id="map-overlay"></canvas> (see portfolio.html) + this module.

import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildWorld} from './world.js';

const rectEl = document.getElementById('map-rect');
const canvas = document.getElementById('map-overlay');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- settings
const ELEV_IDLE    = 17;       // deg: camera elevation in the perspective view (90 = straight down)
const FOV_IDLE     = 58;       // deg: wide lens in the perspective view (strong perspective) ...
const FOV_END      = 6;        // ... narrowing to almost orthographic for the top-down view
const PERSP_W_M    = 26;       // metres across the rectangle at the look-at point in the perspective view
const TOP_W_M      = 16;       // metres across the rectangle in the final top-down view (the car ~ 1/5 of the width)
const LEAD_M       = 9;        // in the perspective view the car is this many metres nearer to the camera than the look-at point
const TAIL         = 0.22;     // share of the pinned scroll distance kept after the camera morph
const CRUISE       = 11;       // m/s
const START_X      = 380;      // scene x of the street point the camera looks at at the start
const ROUTE_X0     = 560;      // the route is extended east so the car can come from beyond the screen

const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();            // transparent: the page shows through
const data = await (await fetch(new URL('./data/scene-flat.json', import.meta.url))).json();
const world = await buildWorld({scene, data, routePre:[[ROUTE_X0, -340], [446, -339], [434, -338]]});
const {car, bounds} = world;
// layers: 0 = map (drawn only inside the rectangle), 1 = car, 2 = shadow catcher (drawn only outside the rectangle)
car.traverse(o => o.layers.set(1));
world.sun.layers.enable(1); world.sun.layers.enable(2); world.hemi.layers.enable(1); world.hemi.layers.enable(2);
world.hemi.intensity = 2.4; world.sun.intensity = 1.0;      // top-down needs more fill light than the 3D view

// glossy highlights: reflect a bright "studio" environment on the car only (the map keeps its flat look)
{
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  car.traverse(o => { if (!o.isMesh || !o.material || o.material.emissiveIntensity > 1) return;
    const m = o.material;
    m.envMap = env;
    if (/car_paint/i.test(o.name)){ m.envMapIntensity = 1.7; m.roughness = .16; m.metalness = .55; }
    else if (/glass/i.test(o.name)) m.envMapIntensity = 1.4;
    else if (/wheel/i.test(o.name)) m.envMapIntensity = .5;
    else m.envMapIntensity = .8;
    m.needsUpdate = true; });
}

// shadow under the car while it is over the white page (there is no ground outside the map): a soft blob that follows the
// car; layer 2 = drawn only outside the rectangle, where the real sun shadow cannot fall on anything
const blob = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 32, 4, 64, 32, 60); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(.55, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.save(); x.scale(1, .5); x.translate(0, 32); x.fillStyle = g; x.fillRect(0, -32, 128, 128); x.restore();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: .55}));
  m.layers.set(2); m.renderOrder = 1; scene.add(m); return m;
})();
const _f = new THREE.Vector3();
function updateBlob(){
  blob.visible = car.visible;
  _f.set(1, 0, 0).applyQuaternion(car.quaternion);
  blob.position.set(car.position.x - 0.25, car.position.y + .04, car.position.z + 0.2);   // a little away from the sun
  blob.rotation.set(0, Math.atan2(-_f.z, _f.x), 0);
}

const camera = new THREE.PerspectiveCamera(FOV_END, 1, 4, 12000);
camera.layers.enable(0); camera.layers.enable(1);

// street point (on the route) that is centred in the rectangle at the start
const routeAtX = x => { const p = world.route.pts; for (let i = 1; i < p.length; i++){ const a = p[i-1], b = p[i];
  if ((a.x - x) * (b.x - x) <= 0){ const t = (x - a.x) / ((b.x - a.x) || 1); return new THREE.Vector3(x, a.y + (b.y-a.y)*t, a.z + (b.z-a.z)*t); } } return p[0].clone(); };
const S0 = routeAtX(START_X);

// ---------------------------------------------------------------- state
let state = 'idle', T = 0, ppm = 17, cx = S0.x, cz = S0.z, elev = ELEV_IDLE, azim = 0, fov = FOV_IDLE;   // azim: 0 = looking west, 90 = looking north
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;      // easeInOutCubic
const lerp = (a, b, t) => a + (b - a) * t;
let W = innerWidth, H = innerHeight;
const rectBox = () => rectEl.getBoundingClientRect();

// camera: orbit around the ground point (cx, cz); the point is shown at the centre of the rectangle
function applyCamera(r){
  const cxs = r.left + r.width / 2, cys = r.top + r.height / 2;
  camera.aspect = W / H; camera.fov = fov;
  camera.setViewOffset(W, H, W / 2 - cxs, H / 2 - cys, W, H);              // shifts the principal point to the rectangle centre
  // distance chosen so that `ppm` pixels cover one metre at the look-at point (the lens narrows -> the camera backs away)
  const e = elev * Math.PI / 180, a = azim * Math.PI / 180, D = H / (2 * ppm * Math.tan(fov * Math.PI / 360));
  const hx = -Math.cos(a), hz = -Math.sin(a);                            // horizontal look direction (west -> north)
  camera.up.set(hx * Math.sin(e), Math.cos(e), hz * Math.sin(e));
  camera.position.set(cx - hx * D * Math.cos(e), D * Math.sin(e), cz - hz * D * Math.cos(e));
  camera.lookAt(cx, 0, cz);
  camera.updateMatrixWorld(true);
}
const _p = new THREE.Vector3();
function screenY(x, y, z){ _p.set(x, y, z).applyMatrix4(camera.matrixWorldInverse); if (_p.z >= -.5) return null;   // behind the camera
  _p.set(x, y, z).project(camera); return (1 - _p.y) / 2 * H; }

function view(prog){                                                     // camera parameters for the scroll progress 0..1
  const r = rectBox(), p = ease(prog);
  elev = lerp(ELEV_IDLE, 90, p); azim = lerp(0, 90, p);
  fov = Math.exp(lerp(Math.log(FOV_IDLE), Math.log(FOV_END), p));
  ppm = Math.exp(lerp(Math.log(r.width / PERSP_W_M), Math.log(r.width / TOP_W_M), p));
  return {r, p};
}
function placeIdle(){
  state = 'idle'; T = 0; car.visible = false;
  const {r} = view(0); cx = S0.x; cz = S0.z; applyCamera(r);
  // spawn point: the nearest spot on the street where the whole car is below the bottom edge of the screen
  let dx = 4;
  for (; dx < 200; dx += .5){
    const q = routeAtX(S0.x + dx), yt = screenY(q.x, 1.4, q.z);
    if (yt === null){ dx -= 4; break; }                                  // reached the camera: take the last valid spot
    if (yt >= Math.max(r.bottom, H) + 14) break;
  }
  world.goto(0, Math.max(ROUTE_X0 - (S0.x + dx), 0), 1);
  world.speed = 0; world.update(1, 0);                                   // dt=1 settles heading / lights instantly
}
function start(){ car.visible = true; state = 'run'; T = 0; world.speed = CRUISE; }
placeIdle();

function step(dt, prog){
  const {r, p} = view(prog);
  if (state === 'run'){
    T += dt;
    world.update(dt, CRUISE);
    // the look-at point follows the car (with a lag at first, so it drives off into the distance, then ever more tightly);
    // in the perspective view the car is LEAD_M nearer to the camera than the look-at point, in the top-down view it is in the middle
    const a = azim * Math.PI / 180, A = lerp(LEAD_M, 0, p);
    let tx = car.position.x - Math.cos(a) * A, tz = car.position.z - Math.sin(a) * A;
    tx = lerp(Math.min(tx, S0.x), tx, p);                                // until the car has come up to the street's start the camera stays put
    const k = lerp(1.5, 11, p), f = 1 - Math.exp(-dt * k);
    cx += (tx - cx) * f; cz += (tz - cz) * f;
    if (elev > 80){                                                      // top-down: keep the whole rectangle inside the map
      const hw = r.width / 2 / ppm, hh = r.height / 2 / ppm;
      cx = clamp(cx, bounds.minX + hw, bounds.maxX - hw); cz = clamp(cz, bounds.minZ + hh, bounds.maxZ - hh);
    }
  } else { cx = S0.x; cz = S0.z; }
}

// ---------------------------------------------------------------- render
function render(){
  updateBlob();
  const r = rectBox();
  applyCamera(r);
  // more contrast (side light) while the view is tilted, flatter fill light when looking straight down
  const kk = clamp((elev - ELEV_IDLE) / (90 - ELEV_IDLE));
  world.hemi.intensity = lerp(1.3, 2.4, kk); world.sun.intensity = lerp(2.0, 1.0, kk);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  // scissor in whole device pixels (fractional browser zoom would otherwise leave a 1px seam between the passes)
  const dpr = renderer.getPixelRatio(), Hd = Math.floor(H * dpr);
  const scissor = (x0, y0, x1, y1) => {
    const A = Math.round(x0 * dpr), B = Math.round(x1 * dpr), C = Math.round(y0 * dpr), Dd = Math.round(y1 * dpr);
    if (B <= A || Dd <= C) return false;
    renderer.setScissor((A + .01) / dpr, (Hd - Dd + .01) / dpr, (B - A + .01) / dpr, (Dd - C + .01) / dpr); return true; };
  // pass A: map + car, only inside the rectangle
  camera.layers.enable(0); camera.layers.enable(1); camera.layers.disable(2);
  renderer.setScissorTest(true);
  if (scissor(r.left, r.top, r.right, r.bottom)) renderer.render(scene, camera);
  // pass B: the car + its shadow on the four areas around the rectangle; they overlap the rectangle by one device pixel
  // so no seam is left between the passes
  camera.layers.set(1); camera.layers.enable(2);
  renderer.shadowMap.autoUpdate = false;
  const o = 1 / dpr;
  const areas = [[0, 0, W, r.top + o], [0, r.bottom - o, W, H], [0, r.top, r.left + o, r.bottom], [r.right - o, r.top, W, r.bottom]];
  for (const [x0, y0, x1, y1] of areas) if (scissor(x0, y0, x1, y1)) renderer.render(scene, camera);
  renderer.shadowMap.autoUpdate = true;
  renderer.setScissorTest(false);
}

function resize(){ W = innerWidth; H = innerHeight; renderer.setSize(W, H); }
addEventListener('resize', () => { resize(); if (state === 'idle') placeIdle(); });
resize();

// ---------------------------------------------------------------- scroll: progress through the pinned track
const track = rectEl.parentElement;
function pinState(){
  const tr = track.getBoundingClientRect(), r = rectBox();
  const stickyTop = parseFloat(getComputedStyle(rectEl).top) || 0;      // where the rectangle gets pinned (px from the viewport top)
  const travel = Math.max(1, tr.height - r.height);                      // how far the pinned rectangle can travel inside the track
  const scrolled = stickyTop - tr.top;                                   // 0 at the moment it gets pinned
  const prog = clamp(scrolled / (travel * (1 - TAIL)));                  // 0 -> 1 over the camera morph
  const any = r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
  const needH = Math.min(r.height, H * .92), visH = Math.min(r.bottom, H) - Math.max(r.top, 0);
  const full = any && visH >= needH - 1 && r.left >= -1 && r.right <= W + 1;   // the rectangle has fully appeared
  return {prog, any, full};
}
let prev = performance.now(), progS = null;
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prev) / 1000, .1); prev = now;
  if (window.__pf && window.__pf.hold) return;                            // test hook: freeze the loop
  const f = pinState();
  // the camera follows the scroll with inertia: the mouse wheel jumps in steps, the view eases to it (soft start and stop)
  if (progS === null) progS = f.prog;
  progS += (f.prog - progS) * (1 - Math.exp(-dt * 9));
  if (Math.abs(f.prog - progS) < .0005) progS = f.prog;
  if (state === 'idle' && f.full) start();                                // fully appeared -> the car drives in from the bottom
  if (state === 'run' && !f.any){ placeIdle(); }                          // scrolled away: re-arm, plays again when it comes back
  if (!f.any){ renderer.setScissorTest(false); renderer.clear(); return; }
  step(dt, progS); render();
});

// test / debug hooks: seek(t, prog) replays the timeline deterministically at 30 fps
window.__pf = {
  hold: false,
  seek(t, prog = 0){ placeIdle(); start(); while (T < t) step(1 / 30, prog); render(); },
  idleAt(p){ placeIdle(); step(0, p); render(); },
  get state(){ return state; }, get T(){ return T; }, get ppm(){ return ppm; }, get elev(){ return elev; }, get fov(){ return fov; }, get cam(){ return {cx, cz, ppm}; }, step: (dt, p = 0) => step(dt, p), world,
};
