import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------- settings
const YELLOW    = 0xffc800;   // car paint
const CAR_SCALE = 0.5;        // Cybertruck is ~6 m long; 0.5 -> ~3 m so it can turn / U-turn inside the road
const MIN_W     = 6;          // drive only on roads >= this width (m): 7+ m avenues, bridges. 3 = also side lanes
const STEER_MAX = 0.85;       // rad (~49 deg)
const PAL = {                 // light "paper-model" palette
  bg: 0xf4f7f9, ground: 0xeeeeec, road: 0xd3d5d8, building: 0xf3f2f0, edge: 0xcfcfcc,
  water: 0xd6e9f3, green: 0xdcefd3, crown: 0xa9e37c, trunk: 0x8a5a3c,
};

const status = document.getElementById('status');
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.bg);
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3e6, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, {left:-90, right:90, top:90, bottom:-90, near:10, far:700});
scene.add(sun, sun.target);       // the shadow box follows the car (see loop)

// ---------------------------------------------------------------- map
function geom(m){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setIndex(m.idx); g.computeVertexNormals(); return g;
}
function addMesh(m, mat, opts = {}){
  if (!m.idx.length) return null;
  const mesh = new THREE.Mesh(geom(m), mat);
  mesh.receiveShadow = true; mesh.castShadow = !!opts.cast;
  if (opts.y) mesh.position.y = opts.y;
  scene.add(mesh); return mesh;
}
const DS = THREE.DoubleSide;
const data = await (await fetch('./data/scene.json')).json();
const b = data.bounds, cxm = (b.min[0]+b.max[0])/2, czm = (b.min[2]+b.max[2])/2;
const SIZE = Math.max(b.max[0]-b.min[0], b.max[2]-b.min[2]);
scene.fog = new THREE.Fog(PAL.bg, SIZE * 1.4, SIZE * 4);

const terrainMesh = addMesh(data.terrain, new THREE.MeshStandardMaterial({color:PAL.ground, side:DS, roughness:1,
  polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:2}));
addMesh(data.green, new THREE.MeshStandardMaterial({color:PAL.green, side:DS, roughness:1}), {y:.1});
// one material for every water piece, drawn on top of the (sunk) terrain: no seams / stripes
addMesh(data.water, new THREE.MeshStandardMaterial({color:PAL.water, side:DS, roughness:1, metalness:0,
  polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}), {y:.05});
addMesh(data.roads, new THREE.MeshStandardMaterial({color:PAL.road, side:DS, roughness:1,
  polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1}), {y:.2});
const bld = addMesh(data.buildings, new THREE.MeshStandardMaterial({color:PAL.building, side:DS, roughness:1, flatShading:true}), {cast:true});
if (bld) scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(bld.geometry, 25),
  new THREE.LineBasicMaterial({color:PAL.edge})));

// trees (instanced, smooth light-green crowns)
{
  const T = data.trees, n = T.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,7).translate(0,.5,0), new THREE.MeshStandardMaterial({color:PAL.trunk, roughness:1}), n);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,2), new THREE.MeshStandardMaterial({color:PAL.crown, roughness:1}), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  T.forEach(([x,y,z,cr,c0,c1,tr,t0,t1], i) => {
    p.set(x, y + t0, z); s.set(Math.max(tr,.15), t1 - t0, Math.max(tr,.15)); trunk.setMatrixAt(i, m.compose(p,q,s));
    const h = c1 - c0; p.set(x, y + c0 + h/2, z); s.set(cr, h/2, cr); crown.setMatrixAt(i, m.compose(p,q,s));
  });
  trunk.castShadow = crown.castShadow = true; scene.add(trunk, crown);
}

// ---------------------------------------------------------------- car
const RED_GLOW = new THREE.MeshStandardMaterial({color:0x3a0000, emissive:0xff1010, emissiveIntensity:3, roughness:.3});
const RED_GLASS = new THREE.MeshStandardMaterial({color:0x550000, emissive:0xff0a0a, emissiveIntensity:2.2, roughness:.2, transparent:true, opacity:.92});
const PAINT_GLB = [   // the .blend had only grey placeholders: paint by mesh name
  [/car_paint/i,     new THREE.MeshStandardMaterial({color:YELLOW, roughness:.3, metalness:.35})],
  [/glass_windows/i, new THREE.MeshStandardMaterial({color:0x10181f, roughness:.05, metalness:.8, transparent:true, opacity:.88})],
  [/glass_light/i,   new THREE.MeshStandardMaterial({color:0xdfe9f2, roughness:.1, metalness:.2, transparent:true, opacity:.55})],
  [/^light/i,        new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xdfeaff, emissiveIntensity:.9})],
  [/wheel/i,         new THREE.MeshStandardMaterial({color:0x141414, roughness:.8, metalness:.2})],
  [/interior/i,      new THREE.MeshStandardMaterial({color:0x1b1b1d, roughness:.8})],
  [/trunk/i,         new THREE.MeshStandardMaterial({color:0x2a2c2f, roughness:.6, metalness:.3})],
  [/body/i,          new THREE.MeshStandardMaterial({color:0xb9bec5, roughness:.35, metalness:.85})],
];
function glowTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,40,30,.95)'); g.addColorStop(.35,'rgba(255,20,20,.35)'); g.addColorStop(1,'rgba(255,0,0,0)');
  x.fillStyle = g; x.fillRect(0,0,64,64); return new THREE.CanvasTexture(c);
}
// The light meshes are shared by front and rear: split them by triangle position. Rear -> red glow + sprites.
function makeRearLightsRed(m, fwd, centre){
  const tex = glowTexture(), rear = [], jobs = [], sprites = [];
  let plight = null;
  m.traverse(o => { if (o.isMesh && /^(light|glass_light)/i.test(o.name) && o.geometry.index) jobs.push(o); });
  for (const o of jobs){
    const g = o.geometry, pos = g.attributes.position, idx = g.index.array;
    const V = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], C = new THREE.Vector3(), front = [], back = [];
    for (let i = 0; i < idx.length; i += 3){
      C.set(0,0,0); for (let k = 0; k < 3; k++){ V[k].fromBufferAttribute(pos, idx[i+k]).applyMatrix4(o.matrixWorld); C.add(V[k]); }
      C.multiplyScalar(1/3);
      const isRear = C.clone().sub(centre).dot(fwd) < 0;
      (isRear ? back : front).push(idx[i], idx[i+1], idx[i+2]);
      if (isRear) rear.push(C.clone());
    }
    const mk = ix => { const ng = new THREE.BufferGeometry(); for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]); ng.setIndex(ix); return ng; };
    o.geometry = mk(front);
    if (back.length){
      const r = new THREE.Mesh(mk(back), /glass/i.test(o.name) ? RED_GLASS : RED_GLOW);
      r.position.copy(o.position); r.quaternion.copy(o.quaternion); r.scale.copy(o.scale); o.parent.add(r);
    }
  }
  if (!rear.length) return {sprites, light:null};
  const ys = rear.map(p => p.y), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const lat = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
  const groups = {strip:[], left:[], right:[]};
  rear.forEach(p => { if (p.y > mid) groups.strip.push(p); else (p.clone().sub(centre).dot(lat) < 0 ? groups.left : groups.right).push(p); });
  const add = (pts, size) => {
    if (!pts.length) return;
    const c = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:.9, fog:false}));
    sp.position.copy(m.worldToLocal(c)); sp.scale.setScalar(size); m.add(sp); sprites.push(sp);
  };
  if (groups.strip.length){
    const bb = new THREE.Box3().setFromPoints(groups.strip), w = bb.getSize(new THREE.Vector3()).length();
    for (let i = 0; i < 5; i++) add([bb.getCenter(new THREE.Vector3()).addScaledVector(lat, ((i + .5) / 5 - .5) * w * .95)], .8);
  }
  add(groups.left, .9); add(groups.right, .9);
  const pl = new THREE.PointLight(0xff1a1a, 1.2, 4, 2);
  pl.position.copy(m.worldToLocal(new THREE.Box3().setFromPoints(rear).getCenter(new THREE.Vector3()))); m.add(pl);
  return {sprites, light:pl};
}
// Each wheel gets its own pivot: steer (Y) -> spin (axle). The meshes are baked at the origin, so pivot = bbox centre.
function rigWheels(m){
  const wheels = {front:[], all:[]};
  m.updateMatrixWorld(true);
  for (const n of ['wheel_FL','wheel_FR','wheel_BL','wheel_BR']){
    const mesh = m.getObjectByName(n); if (!mesh) continue;
    const bb = new THREE.Box3().setFromObject(mesh), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.copy(c); steer.add(spin); m.add(steer);     // m is still unrotated: axes = model axes (axle = X, up = Y)
    steer.updateMatrixWorld(true); spin.attach(mesh);          // attach() keeps the mesh where it was
    wheels.all.push(spin); if (/F[LR]$/.test(n)) wheels.front.push(steer);
    wheels.radius = Math.max(sz.y, sz.z) / 2;
  }
  return wheels;
}
async function loadCar(){
  const gltf = await new GLTFLoader().loadAsync('./models/car.glb');
  const m = gltf.scene; m.updateMatrixWorld(true);
  m.traverse(o => { if (!o.isMesh) return;
    const hit = PAINT_GLB.find(([re]) => re.test(o.name));
    if (hit) o.material = hit[1]; o.castShadow = true; });
  const wp = n => { const o = m.getObjectByName(n); return o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) : null; };
  const fl = wp('wheel_FL'), bl = wp('wheel_BL'), fr = wp('wheel_FR'), br = wp('wheel_BR');
  const wheels = rigWheels(m);
  if (fl && bl && fr && br){                       // make the car face +X
    const f = fl.clone().add(fr).sub(bl).sub(br); f.y = 0;
    m.rotation.y = Math.atan2(f.z, f.x); m.updateMatrixWorld(true);
  }
  const box = new THREE.Box3().setFromObject(m), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const rearLights = makeRearLightsRed(m, new THREE.Vector3(1,0,0), c);
  m.position.set(-c.x, -box.min.y, -c.z); m.updateMatrixWorld(true);
  const out = new THREE.Group(); out.add(m);
  out.userData = {width: s.z, wheels, rearLights, half: (fl && bl && fr) ? [fl.distanceTo(bl) / 2, fl.distanceTo(fr) / 2] : [1.9, .95]};
  return out;
}

// brake-light level: 0 = dark red lenses, 1 = full red glow
function setBrake(k){
  RED_GLOW.emissiveIntensity = .08 + 2.9 * k; RED_GLOW.color.setRGB(.10 + .13*k, 0, 0);
  RED_GLASS.emissiveIntensity = .05 + 2.15 * k; RED_GLASS.opacity = .55 + .37 * k;
  const r = car.userData.rearLights; if (!r) return;
  r.sprites.forEach(s => { s.material.opacity = .9 * k; s.visible = k > .02; });
  if (r.light) r.light.intensity = 1.2 * k;
}

// ---------------------------------------------------------------- road network
const wide = data.roadGraph.edges.filter(e => e.w >= MIN_W);
const edges = wide.map(e => {
  const pts = e.pts.map(p => new THREE.Vector3(p[0], p[1] + .2, p[2]));
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i-1] + pts[i].distanceTo(pts[i-1]));
  return {a:e.a, b:e.b, w:e.w, br:e.br || 0, bp:e.bp, pts, cum, len:cum[cum.length-1]};
});
const LINK = 14;      // m: road ends closer than this are joined by a short straight link
edges.forEach(e => { e.ends = [e.pts[0], e.pts[e.pts.length-1]]; });
function neighbours(e, endIdx){        // endIdx 1 = leaving through the far end (dir +1), 0 = through the start (dir -1)
  const p = e.ends[endIdx], out = [];
  edges.forEach(o => { if (o === e) return;
    [0,1].forEach(k => { const g = Math.hypot(o.ends[k].x - p.x, o.ends[k].z - p.z); if (g < LINK) out.push({edge:o, dir:k === 0 ? 1 : -1, gap:g}); }); });
  return out;
}
// largest connected component with these links
{ const id = new Map(edges.map((e, i) => [e, i])), pr = edges.map((_, i) => i);
  const fnd = x => { while (pr[x] !== x) x = pr[x]; return x; };
  edges.forEach(e => [0,1].forEach(k => neighbours(e, k).forEach(n => { pr[fnd(id.get(e))] = fnd(id.get(n.edge)); })));
  const tot = new Map(); edges.forEach((e, i) => tot.set(fnd(i), (tot.get(fnd(i)) || 0) + e.len));
  const best = [...tot.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (let i = edges.length - 1; i >= 0; i--) if (fnd(i) !== best) edges.splice(i, 1);
}
console.log(`drive network: ${edges.length} roads, ${edges.reduce((t, e) => t + e.len, 0).toFixed(0)} m`);
const at = (E, d, out, tan) => {
  d = Math.min(Math.max(d, 0), E.len);
  let i = 1; while (i < E.cum.length-1 && E.cum[i] < d) i++;
  const t = (d - E.cum[i-1]) / Math.max(E.cum[i] - E.cum[i-1], 1e-6);
  out.lerpVectors(E.pts[i-1], E.pts[i], t);
  tan.subVectors(E.pts[i], E.pts[i-1]).normalize();
};
// invisible ray-cast surface = the drivable road hatches (bridges included), terrain as fallback
const driveMesh = new THREE.Mesh(geom(data.roadsDrive.idx.length ? data.roadsDrive : data.roads));
driveMesh.position.y = .2; driveMesh.updateMatrixWorld(true);
terrainMesh.updateMatrixWorld(true);

const car = await loadCar();
car.scale.setScalar(CAR_SCALE);
scene.add(car);
const beacon = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 12).rotateX(Math.PI),
  new THREE.MeshBasicMaterial({color:0xff2d55, fog:false, depthTest:false, transparent:true, opacity:.9}));
beacon.renderOrder = 10; scene.add(beacon);
const WB = car.userData.half[0] * 2 * CAR_SCALE;                       // wheelbase in world metres
const wheelR = (car.userData.wheels.radius || .46) * CAR_SCALE;
console.log(`car ${(car.userData.width*CAR_SCALE).toFixed(2)} m wide, wheelbase ${WB.toFixed(2)} m, wheel r ${wheelR.toFixed(2)} m`);

// ---------------------------------------------------------------- driving
const UP = new THREE.Vector3(0,1,0);
let cur = edges.reduce((a, e) => e.len > a.len ? e : a), dir = 1, dist = 0, uturn = null;
let offS = 1.5;                              // lateral lane offset (right-hand traffic), smoothed
const P = new THREE.Vector3(), Tn = new THREE.Vector3();
const fwd = new THREE.Vector3(1,0,0), lat = new THREE.Vector3(0,0,1), upS = new THREE.Vector3(0,1,0), _m = new THREE.Matrix4();
const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0,-1,0), _o = new THREE.Vector3();
const wheelPt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
let steerS = 0, spinA = 0;

function groundY(x, z, fallback){
  ray.set(_o.set(x, fallback + 6, z), DOWN);
  const h = ray.intersectObject(driveMesh, false)[0] || ray.intersectObject(terrainMesh, false)[0];
  return h ? h.point.y : fallback;
}
function advance(ds){
  if (uturn){                                           // semicircle across the road at a dead end
    uturn.phi += ds / uturn.r;
    if (uturn.phi >= Math.PI){ dir = -dir; dist = 0; uturn = null; }
    return;
  }
  dist += ds;
  while (!uturn && dist > cur.len){
    dist -= cur.len;
    if (cur.next){ dir = cur.next.dir; cur = cur.next.edge; continue; }          // finished a link -> real road
    const endIdx = dir > 0 ? 1 : 0;
    const opts = neighbours(cur, endIdx);
    if (!opts.length){                                  // dead end -> U-turn
      const d = dir > 0 ? cur.len : 0; at(cur, d, P, Tn); if (dir < 0) Tn.negate();
      uturn = {phi:0, r:Math.max(offS, 1), c:P.clone(), td:Tn.clone().setY(0).normalize()};
      uturn.right = new THREE.Vector3(uturn.td.z * -1, 0, uturn.td.x).normalize();
      uturn.right.crossVectors(uturn.td, UP).normalize();
      dist = 0; return;
    }
    const n = opts[Math.floor(Math.random() * opts.length)];
    if (n.gap < .5){ cur = n.edge; dir = n.dir; }
    else {                                              // virtual straight link from this end to the neighbour's end
      const from = cur.ends[endIdx], to = n.edge.ends[n.dir > 0 ? 0 : 1];
      cur = {pts:[from, to], cum:[0, n.gap], len:n.gap, w:Math.min(cur.w, n.edge.w), ends:[from, to], next:{edge:n.edge, dir:n.dir}};
      dir = 1;
    }
  }
}
function place(dt, ds){
  const target = new THREE.Vector3();
  if (uturn){
    const {phi, r, c, td, right} = uturn;
    P.copy(c).addScaledVector(right, r * Math.cos(phi)).addScaledVector(td, r * Math.sin(phi));
    target.copy(td).multiplyScalar(Math.cos(phi)).addScaledVector(right, -Math.sin(phi));
  } else {
    const d = dir > 0 ? dist : cur.len - dist;
    at(cur, d, P, Tn); if (dir < 0) Tn.negate();
    target.set(Tn.x, 0, Tn.z);
  }
  const prev = fwd.clone();
  const k = 1 - Math.exp(-dt * (uturn ? 14 : 9));
  fwd.lerp(target.normalize(), k).setY(0).normalize();
  lat.crossVectors(fwd, UP).normalize();
  if (!uturn){                                          // keep to the right lane
    offS += (Math.min(Math.max(cur.w * .25, 1), 2.2) - offS) * (1 - Math.exp(-dt * 3));
    P.addScaledVector(lat, offS);
  }
  // steering from the heading change per metre driven
  if (ds > 1e-4){
    const ang = Math.atan2(prev.clone().cross(fwd).dot(UP), prev.dot(fwd));
    const want = Math.max(-STEER_MAX, Math.min(STEER_MAX, Math.atan(WB * (ang / ds))));
    steerS += (want - steerS) * (1 - Math.exp(-dt * 10));
  }
  const W = car.userData.wheels;
  W.front.forEach(s => s.rotation.y = steerS);
  spinA += ds / wheelR; W.all.forEach(s => s.rotation.x = spinA);
  // ride the surface: sample under the four wheels, fit a plane -> pitch AND roll
  const L = car.userData.half[0] * CAR_SCALE, Wd = car.userData.half[1] * CAR_SCALE;
  [[L,-Wd],[L,Wd],[-L,-Wd],[-L,Wd]].forEach(([l, w], i) => {
    const x = P.x + fwd.x*l + lat.x*w, z = P.z + fwd.z*l + lat.z*w;
    wheelPt[i].set(x, groundY(x, z, P.y), z);
  });
  const f = wheelPt[0].clone().add(wheelPt[1]).sub(wheelPt[2]).sub(wheelPt[3]);
  const r = wheelPt[1].clone().add(wheelPt[3]).sub(wheelPt[0]).sub(wheelPt[2]);
  upS.lerp(r.clone().cross(f).normalize(), 1 - Math.exp(-dt * 12)).normalize();
  const fw = f.normalize().sub(upS.clone().multiplyScalar(f.dot(upS))).normalize();
  car.quaternion.setFromRotationMatrix(_m.makeBasis(fw, upS, fw.clone().cross(upS).normalize()));
  car.position.set(P.x, (wheelPt[0].y + wheelPt[1].y + wheelPt[2].y + wheelPt[3].y) / 4, P.z);
}

// ---------------------------------------------------------------- camera / UI
const home = {pos:new THREE.Vector3(cxm + SIZE*.3, SIZE*.55, czm + SIZE*.75), target:new THREE.Vector3(cxm, 0, czm)};
let follow = false;
const btnF = document.getElementById('follow');
function resetView(){ camera.position.copy(home.pos); controls.target.copy(home.target); follow = false; btnF.setAttribute('aria-pressed','false'); }
btnF.onclick = () => { follow = !follow; btnF.setAttribute('aria-pressed', follow);
  if (follow){ controls.target.copy(car.position); camera.position.copy(car.position).add(new THREE.Vector3(-10, 12, 10)); } };
document.getElementById('reset').onclick = resetView;
const speedEl = document.getElementById('speed');
resetView();
function resize(){ renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
status.textContent = 'Тяните мышью — вращение, колесо — масштаб, правая кнопка — сдвиг';
setTimeout(() => status.style.display = 'none', 6000);

// debug / test hooks
window.__cam = {camera, controls}; window.__car = car; window.__edges = edges; window.__bridges = data.roadGraph.edges.map((e, i) => e.br > 3 && e.w >= MIN_W ? e.pts[Math.floor(e.pts.length/2)] : null).filter(Boolean);
window.__neighbours = neighbours; window.__speed = () => v; window.__setSpeed = x => { v = x; }; window.__steer = () => steerS; window.__goto = (i, d, dr = 1) => { cur = edges[i]; dir = dr; dist = d; uturn = null; };

let prevT = performance.now(), v = 0, brakeHold = 0, brakeK = 0;
window.__brake = () => brakeK;
setBrake(0);
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prevT)/1000, .1); prevT = now;
  // speed: slow down for turns (look at the steering angle), brake lights glow only while braking
  const base = +speedEl.value, target = base * (1 - .65 * Math.min(Math.abs(steerS) / .45, 1));
  const prevV = v;
  v += Math.max(-14 * dt, Math.min(6 * dt, target - v));
  const decel = (prevV - v) / Math.max(dt, 1e-3);
  if (decel > 1.2 || (v - target) > .6 && v > 1) brakeHold = .35; else brakeHold = Math.max(0, brakeHold - dt);
  brakeK += ((brakeHold > 0 ? 1 : 0) - brakeK) * (1 - Math.exp(-dt * (brakeHold > 0 ? 25 : 8)));
  setBrake(brakeK);
  const ds = v * dt;
  advance(ds); place(dt, ds);
  sun.target.position.copy(car.position);
  sun.position.copy(car.position).add(new THREE.Vector3(-80, 140, 60));
  if (follow){ const off = camera.position.clone().sub(controls.target); controls.target.lerp(car.position, .15); camera.position.copy(controls.target).add(off); }
  beacon.position.copy(car.position).y += 9 + Math.sin(now/300);
  beacon.scale.setScalar(Math.max(.3, Math.min(6, camera.position.distanceTo(car.position) / 150)));
  controls.update(); renderer.render(scene, camera);
});
