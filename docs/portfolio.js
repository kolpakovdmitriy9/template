// Portfolio scene: the map inside #map-rect, seen through an orthographic camera that cannot be controlled by the user.
//   idle  -> while the rectangle scrolls into view the camera tilts from a 3D angle (looking along the street) to a top-down
//            view; the car waits off-screen on the right
//   run   -> as soon as the rectangle is fully on screen (top-down) the car flies in from the right edge of the screen;
//            when it reaches the centre the camera joins it smoothly (no jolt) and moves with it; a couple of seconds later
//            the camera eases out a little so the car can be admired, and keeps following it along the route.
// The map is clipped to the rectangle (scissor); the car is drawn on top of the page, so it can leave the rectangle
// (with its own shadow, via a shadow-catcher plane that is only drawn outside the rectangle).
// The view never leaves the map, so there is never an empty area inside the rectangle.
//
// Embed:  <div id="map-rect"></div> + <canvas id="map-overlay"></canvas>  (see portfolio.html) and load this module.
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildWorld} from './world.js';

const rectEl = document.getElementById('map-rect');
const canvas = document.getElementById('map-overlay');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- timeline settings
const ELEV_IDLE    = 32;       // deg: camera elevation when the rectangle just starts to appear (90 = top-down)
const ZOOM_IDLE    = 0.13;     // zoom at that moment relative to the start zoom: wide enough to see houses and trees (3D look)
const ZOOM_DELAY   = 2.0;      // s the camera moves with the car at full zoom before it starts to ease out
const ZOOM_DUR     = 3.5;      // s: length of the ease-out
const FLY_SPEED    = 14;       // m/s when the car enters
const START_SPEED  = 9;        // m/s cruising while zoomed in
const END_SPEED    = 14;       // m/s once zoomed out
const ROWS_W_M     = 5.6;      // metres of road visible across the rectangle width at the start (car ~ 3 m long)
const END_W_M      = 26;       // metres visible across the rectangle width at the end: the car (~3 m) is ~1/9 of the width
const START_X      = 380;      // scene x of the street point shown in the middle of the rectangle at the start
const ROUTE_X0     = 560;      // route is extended east so the car can come from beyond the screen edge

const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();            // transparent: the page shows through
const data = await (await fetch(new URL('./data/scene.json', import.meta.url))).json();
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

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 6000);
camera.layers.enable(0); camera.layers.enable(1);

// street point (on the route) that is centred in the rectangle at the start
const routeAtX = x => { const p = world.route.pts; for (let i = 1; i < p.length; i++){ const a = p[i-1], b = p[i];
  if ((a.x - x) * (b.x - x) <= 0){ const t = (x - a.x) / ((b.x - a.x) || 1); return new THREE.Vector3(x, a.y + (b.y-a.y)*t, a.z + (b.z-a.z)*t); } } return p[0].clone(); };
const S0 = routeAtX(START_X);

// ---------------------------------------------------------------- state
let state = 'idle', T = 0, Tc = null, ppm = 60, cx = S0.x, cz = S0.z, elev = 90, azim = 90;   // azim: 0 = looking west, 90 = looking north
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;      // easeInOutCubic
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
let W = innerWidth, H = innerHeight;
const rectBox = () => rectEl.getBoundingClientRect();

function viewParams(r){
  const ppm0 = r.width / ROWS_W_M;                                       // px per metre at the start
  const ppm1 = r.width / END_W_M;                                        // px per metre at the end (car clearly visible)
  return {ppm0, ppm1};
}
function placeIdle(){
  const r = rectBox(), {ppm0} = viewParams(r), cxs = r.left + r.width / 2;
  const xOff = S0.x + (W - cxs) / ppm0 + 4;                              // just beyond the right edge of the screen
  world.goto(0, Math.max(ROUTE_X0 - xOff, 0), 1);
  world.speed = 0; world.update(1, 0);                                   // dt=1 settles heading/lights instantly
  state = 'idle'; T = 0; Tc = null; cx = S0.x; cz = S0.z; ppm = ppm0; elev = 90; azim = 90;
  car.visible = false;                                                   // not on the map yet
}
function start(){
  car.visible = true;
  if (reduceMotion){ state = 'run'; T = 99; Tc = 0; world.speed = END_SPEED; return; }
  state = 'run'; T = 0; Tc = null; world.speed = FLY_SPEED;
}
placeIdle();

function step(dt, prog){
  const r = rectBox(), {ppm0, ppm1} = viewParams(r);
  if (state === 'run'){
    T += dt;
    elev = 90; azim = 90;
    const e = Tc === null ? 0 : ease(clamp((T - Tc - ZOOM_DELAY) / ZOOM_DUR));
    world.update(dt, lerp(START_SPEED, END_SPEED, e));
    // the camera waits until the car reaches the centre, then its speed ramps smoothly from 0 to the car's speed over the
    // next LEAD metres (no jolt, never faster than the car); the ~1 m the car has gained meanwhile is absorbed over 1.2 s
    const LEAD = 2.2, d = car.position.x - S0.x, X = car.position.x;
    if (d >= 0){ cx = S0.x; cz = S0.z; }
    else {
      const w = -d / LEAD;
      if (w < 1){ cx = X + LEAD * (w - (w*w*w - w*w*w*w / 2)); cz = S0.z + (car.position.z - S0.z) * smooth(w); }
      else {
        if (Tc === null) Tc = T;
        const q = 1 - smooth(clamp((T - Tc) / 1.2));
        cx = X + LEAD * .5 * q; cz = car.position.z;
      }
    }
    ppm = Math.exp(lerp(Math.log(ppm0), Math.log(ppm1), e));
    // keep the whole rectangle inside the map: the view centre is clamped by half the visible size
    const hw = r.width / 2 / ppm, hh = r.height / 2 / ppm;
    cx = clamp(cx, bounds.minX + hw, bounds.maxX - hw); cz = clamp(cz, bounds.minZ + hh, bounds.maxZ - hh);
  } else {
    // scroll-driven: from a wide 3D view along the street to the top-down view the moment the rectangle is fully on screen
    const p = ease(prog);
    elev = lerp(ELEV_IDLE, 90, p); azim = lerp(0, 90, p);
    ppm = Math.exp(lerp(Math.log(ppm0 * ZOOM_IDLE), Math.log(ppm0), p)); cx = S0.x; cz = S0.z;
  }
}

// ---------------------------------------------------------------- render
function render(){
  updateBlob();
  const r = rectBox();
  // the point (cx, cz) is shown at the centre of the rectangle
  const cxs = r.left + r.width / 2, cys = r.top + r.height / 2;
  camera.left = -cxs / ppm; camera.right = (W - cxs) / ppm; camera.top = cys / ppm; camera.bottom = -(H - cys) / ppm;
  camera.updateProjectionMatrix();
  // orbit around the ground point: elevation 90 = straight down with north up; lower = tilted, looking along `azim`
  const e = elev * Math.PI / 180, a = azim * Math.PI / 180, D = 3000;
  const hx = -Math.cos(a), hz = -Math.sin(a);                            // horizontal look direction (west -> north)
  camera.up.set(hx * Math.sin(e), Math.cos(e), hz * Math.sin(e));
  camera.position.set(cx - hx * D * Math.cos(e), D * Math.sin(e), cz - hz * D * Math.cos(e));
  camera.lookAt(cx, 0, cz);
  // more contrast (side light) while the view is tilted, flatter fill light when looking straight down
  const kk = clamp((elev - ELEV_IDLE) / (90 - ELEV_IDLE));
  world.hemi.intensity = lerp(1.3, 2.4, kk); world.sun.intensity = lerp(2.0, 1.0, kk);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  // pass A: map + car, only inside the rectangle
  camera.layers.enable(0); camera.layers.enable(1); camera.layers.disable(2);
  renderer.setScissorTest(true); renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
  renderer.render(scene, camera);
  // pass B: the car + its shadow on the four areas around the rectangle (so nothing is drawn twice)
  camera.layers.set(1); camera.layers.enable(2);
  renderer.shadowMap.autoUpdate = false;
  const areas = [[0, 0, W, r.top], [0, r.bottom, W, H - r.bottom], [0, r.top, r.left, r.height], [r.right, r.top, W - r.right, r.height]];
  for (const [x, y, w, h] of areas){
    if (w < 1 || h < 1) continue;
    renderer.setScissor(x, H - (y + h), w, h); renderer.render(scene, camera);
  }
  renderer.shadowMap.autoUpdate = true;
  renderer.setScissorTest(false);
}

function resize(){ W = innerWidth; H = innerHeight; renderer.setSize(W, H); }
addEventListener('resize', () => { resize(); if (state === 'idle') placeIdle(); });
resize();

// ---------------------------------------------------------------- trigger: the rectangle is fully on screen
function fraction(){
  const r = rectBox(), needH = Math.min(r.height, H * .92);
  const visH = Math.min(r.bottom, H) - Math.max(r.top, 0), visW = Math.min(r.right, W) - Math.max(r.left, 0);
  return {full: visH >= needH - 1 && visW >= r.width - 1, any: visH > 0 && visW > 0,
          prog: clamp(visH / needH) * clamp(visW / r.width)};            // 0 = just entering, 1 = fully visible
}
let prev = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prev) / 1000, .1); prev = now;
  if (window.__pf && window.__pf.hold) return;                            // test hook: freeze the loop
  const f = fraction();
  if (state === 'idle' && f.full) start();
  if (state === 'run' && !f.any && T > 1){ placeIdle(); }                 // scrolled away: re-arm, plays again when it returns
  if (!f.any){ renderer.setScissorTest(false); renderer.clear(); return; }
  step(dt, f.prog); render();
});

// test / debug hooks: seek(t) replays the timeline deterministically at 30 fps; idleAt(p) shows the scroll-driven pre-phase
window.__pf = {
  hold: false,
  seek(t){ placeIdle(); start(); while (T < t) step(1 / 30, 1); render(); },
  idleAt(p){ placeIdle(); step(0, p); render(); },
  get state(){ return state; }, get T(){ return T; }, get ppm(){ return ppm; }, get elev(){ return elev; }, get cam(){ return {cx, cz, ppm}; }, step: (dt) => step(dt, 1), world,
};
