// Portfolio scene: the map inside #map-rect, seen through a camera that cannot be controlled by the user.
// The rectangle sits in a tall "track" (its parent) and is pinned with `position: sticky`; page scroll while it is pinned drives:
//   1. the camera flies from a low perspective view along the street (wide lens, 3D) to a straight top-down view
//      (the lens narrows to almost orthographic) - nothing else happens, the car is not on the map yet;
//   2. when that is complete the car flies in from the right edge of the screen; the map starts moving with it right away
//      (the car glides from the edge to the centre of the rectangle while the camera runs with it, so it never drives on
//      towards the edge), and a couple of seconds later the camera eases out a little so the car can be admired.
// The map is clipped to the rectangle (scissor); the car is drawn on top of the page, so it can leave the rectangle (with its
// own soft shadow). The view never leaves the map, so there is never an empty area inside the rectangle.
// The world is flat (data/scene-flat.json): no hills or bumps for the car or the camera.
//
// Embed:  <div class="map-track"><div id="map-rect"></div></div> + <canvas id="map-overlay"></canvas> (see portfolio.html) + this module.
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildWorld} from './world.js';

const rectEl = document.getElementById('map-rect');
const canvas = document.getElementById('map-overlay');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- timeline settings
const ELEV_IDLE    = 17;       // deg: camera elevation when the rectangle just starts to appear (90 = top-down)
const FOV_IDLE     = 58;       // deg: wide lens at that moment (strong perspective) ...
const FOV_END      = 6;        // ... narrowing to almost orthographic for the top-down view
const ZOOM_IDLE    = 0.2;      // zoom at that moment relative to the start zoom
const ZOOM_DELAY   = 2.0;      // s the camera moves with the car at full zoom (after it has arrived) before it starts to ease out
const TAIL         = 0.22;     // share of the pinned scroll distance kept after the camera morph (the car starts when it is reached)
const ZOOM_DUR     = 3.5;      // s: length of the ease-out
const FLY_SPEED    = 14;       // m/s when the car enters
const START_SPEED  = 10;       // m/s cruising while zoomed in
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
let state = 'idle', T = 0, Tc = null, entryOff = 12, entryDur = 2, ppm = 60, cx = S0.x, cz = S0.z, elev = 90, azim = 90, fov = FOV_END;   // azim: 0 = looking west, 90 = looking north
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
  entryOff = (W - cxs) / ppm0 + 4;                                       // metres from the rectangle centre to just beyond the right screen edge
  entryDur = Math.max(2.0, 2 * entryOff / (FLY_SPEED * .9));            // the camera never has to move against the car
  world.goto(0, Math.max(ROUTE_X0 - (S0.x + entryOff), 0), 1);
  world.speed = 0; world.update(1, 0);                                   // dt=1 settles heading/lights instantly
  state = 'idle'; T = 0; Tc = null; cx = S0.x; cz = S0.z; ppm = ppm0; elev = 90; azim = 90; fov = FOV_END;
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
    elev = 90; azim = 90; fov = FOV_END;
    const u = clamp(T / entryDur);
    Tc = entryDur;                                                       // the car has arrived at the centre
    const e = ease(clamp((T - Tc - ZOOM_DELAY) / ZOOM_DUR));
    world.update(dt, T < entryDur ? FLY_SPEED : lerp(START_SPEED, END_SPEED, e));
    // the camera runs with the car from the very first moment; the car glides from beyond the right edge to the centre
    // of the rectangle (ease-out), so it is never ahead of the centre and never drives on towards the edge
    const off = entryOff * (1 - u) * (1 - u);
    cx = car.position.x - off;
    cz = lerp(S0.z, car.position.z, smooth(u));
    ppm = Math.exp(lerp(Math.log(ppm0), Math.log(ppm1), e));
    // keep the whole rectangle inside the map: the view centre is clamped by half the visible size
    const hw = r.width / 2 / ppm, hh = r.height / 2 / ppm;
    cx = clamp(cx, bounds.minX + hw, bounds.maxX - hw); cz = clamp(cz, bounds.minZ + hh, bounds.maxZ - hh);
  } else {
    // scroll-driven: from a low perspective view along the street to the top-down view
    const p = ease(prog);
    elev = lerp(ELEV_IDLE, 90, p); azim = lerp(0, 90, p); fov = Math.exp(lerp(Math.log(FOV_IDLE), Math.log(FOV_END), p));
    ppm = Math.exp(lerp(Math.log(ppm0 * ZOOM_IDLE), Math.log(ppm0), p)); cx = S0.x; cz = S0.z;
  }
}

// ---------------------------------------------------------------- render
function render(){
  updateBlob();
  const r = rectBox();
  // the point (cx, cz) is shown at the centre of the rectangle: shift the principal point of the lens there
  const cxs = r.left + r.width / 2, cys = r.top + r.height / 2;
  camera.aspect = W / H; camera.fov = fov;
  camera.setViewOffset(W, H, W / 2 - cxs, H / 2 - cys, W, H);
  // orbit around the ground point: elevation 90 = straight down with north up; lower = tilted, looking along `azim`
  // distance chosen so that `ppm` pixels cover one metre at the target (the lens narrows -> the camera backs away)
  const e = elev * Math.PI / 180, a = azim * Math.PI / 180, D = H / (2 * ppm * Math.tan(fov * Math.PI / 360));
  const hx = -Math.cos(a), hz = -Math.sin(a);                            // horizontal look direction (west -> north)
  camera.up.set(hx * Math.sin(e), Math.cos(e), hz * Math.sin(e));
  camera.position.set(cx - hx * D * Math.cos(e), D * Math.sin(e), cz - hz * D * Math.cos(e));
  camera.lookAt(cx, 0, cz);
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
  return {prog, any};
}
let prev = performance.now(), progS = null;
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prev) / 1000, .1); prev = now;
  if (window.__pf && window.__pf.hold) return;                            // test hook: freeze the loop
  const f = pinState();
  // the camera follows the scroll with inertia: the mouse wheel jumps in steps, the view eases to it (soft start and stop)
  if (progS === null || state === 'run') progS = f.prog;
  progS += (f.prog - progS) * (1 - Math.exp(-dt * 9));
  if (Math.abs(f.prog - progS) < .0005) progS = f.prog;
  if (state === 'idle' && progS >= .999) start();
  if (state === 'run' && (f.prog < .6 || !f.any) && T > .5){ placeIdle(); progS = f.prog; } // scrolled back up / away: re-arm, plays again later
  if (!f.any){ renderer.setScissorTest(false); renderer.clear(); return; }
  step(dt, progS); render();
});

// test / debug hooks: seek(t) replays the timeline deterministically at 30 fps; idleAt(p) shows the scroll-driven pre-phase
window.__pf = {
  hold: false,
  seek(t){ placeIdle(); start(); while (T < t) step(1 / 30, 1); render(); },
  idleAt(p){ placeIdle(); step(0, p); render(); },
  get state(){ return state; }, get T(){ return T; }, get ppm(){ return ppm; }, get elev(){ return elev; }, get fov(){ return fov; }, get cam(){ return {cx, cz, ppm}; }, step: (dt) => step(dt, 1), world,
};
