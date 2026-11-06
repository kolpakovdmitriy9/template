// Portfolio scene: a fixed top-down (orthographic) view of the map inside #map-rect.
//   idle  -> the rectangle shows a zoomed-in street, the car waits off-screen on the right
//   run   -> as soon as the rectangle is fully on screen: the car flies in from the right edge of the screen,
//            drives onto the road inside the rectangle, then the camera zooms out a little (the car stays clearly visible)
//            and keeps following it. The view never leaves the map, so there is never an empty area in the rectangle.
// The map is clipped to the rectangle (scissor); the car is drawn on top of the page, so it can leave the rectangle.
// The camera cannot be controlled by the user.
//
// Embed:  <div id="map-rect"></div> + <canvas id="map-overlay"></canvas>  (see portfolio.html) and load this module.
import * as THREE from 'three';
import {buildWorld, PAL} from './world.js';

const rectEl = document.getElementById('map-rect');
const canvas = document.getElementById('map-overlay');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- timeline settings
const T_ZOOM_START = 1.3;      // s after the trigger: start zooming out (the car has entered the rectangle by then)
const T_ZOOM_DUR   = 5.0;      // s: length of the zoom-out
const FLY_SPEED    = 14;       // m/s when the car enters
const START_SPEED  = 9;        // m/s cruising while zoomed in
const END_SPEED    = 14;       // m/s once zoomed out
const ROWS_W_M     = 5.6;      // metres of road visible across the rectangle width at the start (car ~ 3 m long)
const END_W_M      = 32;       // metres visible across the rectangle width at the end: the car (~3 m) is ~1/10 of the width
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
// car + its lights live on layer 1 (drawn unclipped); the map on layer 0 (drawn only inside the rectangle)
car.traverse(o => o.layers.set(1));
world.sun.layers.enable(1); world.hemi.layers.enable(1);
world.hemi.intensity = 2.4; world.sun.intensity = 1.0;      // top-down needs more fill light than the 3D view

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 50, 4000);
camera.up.set(0, 0, -1);                    // north (-z) is up on the screen; east (+x) is right
camera.layers.enable(0); camera.layers.enable(1);

// street point (on the route) that is centred in the rectangle at the start
const routeAtX = x => { const p = world.route.pts; for (let i = 1; i < p.length; i++){ const a = p[i-1], b = p[i];
  if ((a.x - x) * (b.x - x) <= 0){ const t = (x - a.x) / ((b.x - a.x) || 1); return new THREE.Vector3(x, a.y + (b.y-a.y)*t, a.z + (b.z-a.z)*t); } } return p[0].clone(); };
const S0 = routeAtX(START_X);

// ---------------------------------------------------------------- state
let state = 'idle', T = 0, follow = false, fx = S0.x, fz = S0.z, ppm = 60, cx = S0.x, cz = S0.z;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;      // easeInOutCubic
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
  state = 'idle'; T = 0; follow = false; fx = S0.x; fz = S0.z; cx = S0.x; cz = S0.z; ppm = ppm0;
}
function start(){
  if (reduceMotion){ state = 'run'; T = 99; follow = true; world.speed = END_SPEED; return; }
  state = 'run'; T = 0; follow = false; world.speed = FLY_SPEED;
}
placeIdle();

function step(dt){
  const r = rectBox(), {ppm0, ppm1} = viewParams(r);
  if (state === 'run'){
    T += dt;
    const e = ease(clamp((T - T_ZOOM_START) / T_ZOOM_DUR));
    world.update(dt, lerp(START_SPEED, END_SPEED, e));
    if (!follow && car.position.x <= S0.x) follow = true;                // the car has passed the centre: camera follows
    if (follow){ const k = 1 - Math.exp(-dt * 6); fx += (car.position.x - fx) * k; fz += (car.position.z - fz) * k; }
    ppm = Math.exp(lerp(Math.log(ppm0), Math.log(ppm1), e));
    cx = fx; cz = fz;
    // keep the whole rectangle inside the map: the view centre is clamped by half the visible size
    const hw = r.width / 2 / ppm, hh = r.height / 2 / ppm;
    cx = clamp(cx, bounds.minX + hw, bounds.maxX - hw); cz = clamp(cz, bounds.minZ + hh, bounds.maxZ - hh);
  } else { ppm = ppm0; cx = S0.x; cz = S0.z; }
}

// ---------------------------------------------------------------- render
function render(){
  const r = rectBox();
  // the point (cx, cz) is shown at the centre of the rectangle
  const cxs = r.left + r.width / 2, cys = r.top + r.height / 2;
  camera.left = -cxs / ppm; camera.right = (W - cxs) / ppm; camera.top = cys / ppm; camera.bottom = -(H - cys) / ppm;
  camera.updateProjectionMatrix();
  camera.position.set(cx, 2000, cz); camera.lookAt(cx, 0, cz);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  // pass A: map + car, only inside the rectangle
  camera.layers.enable(0); camera.layers.enable(1);
  renderer.setScissorTest(true); renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
  renderer.render(scene, camera);
  // pass B: the car alone, on the four areas around the rectangle (so nothing is drawn twice)
  camera.layers.set(1);
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
  return {full: visH >= needH - 1 && visW >= r.width - 1, any: visH > 0 && visW > 0};
}
let prev = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prev) / 1000, .1); prev = now;
  const f = fraction();
  if (state === 'idle' && f.full) start();
  if (state === 'run' && !f.any && T > 1){ placeIdle(); }                 // scrolled away: re-arm, plays again when it returns
  if (!f.any){ renderer.setScissorTest(false); renderer.clear(); return; }
  step(dt); render();
});

// test / debug hooks: seek(t) replays the timeline deterministically at 30 fps
window.__pf = {
  seek(t){ placeIdle(); start(); while (T < t) step(1 / 30); render(); },
  get state(){ return state; }, get T(){ return T; }, get ppm(){ return ppm; }, world,
};
