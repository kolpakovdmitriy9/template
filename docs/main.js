import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';

const status = document.getElementById('status');
const host = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = new THREE.Color(0xcfe0ee);
scene.background = sky; scene.fog = new THREE.Fog(sky, 700, 1800);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7b6a, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-250, 400, 200); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left:-400, right:400, top:400, bottom:-400, near:10, far:1200});
scene.add(sun);

function geom(m, colorFn){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  g.setIndex(m.idx);
  g.computeVertexNormals();
  if (colorFn){
    const c = []; for (let i = 0; i < m.pos.length; i += 3) c.push(...colorFn(m.pos[i+1]));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  return g;
}
function addMesh(m, mat, opts = {}){
  if (!m.idx.length) return;
  const mesh = new THREE.Mesh(geom(m, opts.colorFn), mat);
  mesh.receiveShadow = true; mesh.castShadow = !!opts.cast;
  if (opts.y) mesh.position.y = opts.y;
  scene.add(mesh); return mesh;
}
const side = THREE.DoubleSide;

// ---------- car ----------
function procCar(){
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({color:0xd7263d, roughness:.4, metalness:.3});
  const glass = new THREE.MeshStandardMaterial({color:0x223344, roughness:.1, metalness:.6});
  const tire = new THREE.MeshStandardMaterial({color:0x111111});
  const b = new THREE.Mesh(new THREE.BoxGeometry(4.5, .7, 1.85), body); b.position.y = .65; g.add(b);
  const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, .65, 1.6), glass); c.position.set(-.2, 1.3, 0); g.add(c);
  for (const x of [-1.4, 1.4]) for (const z of [-.95, .95]){
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .3, 16), tire);
    w.rotation.x = Math.PI/2; w.position.set(x, .35, z); g.add(w);
  }
  g.traverse(o => o.castShadow = true);
  return g;          // forward = +X, length 4.5, width 1.85
}
// parametric-model.stl: Z-up, length along X, 184 x 90 x 62 units. CAR_FLIP turns it 180deg if it drives backwards.
const CAR_FLIP = true;
async function loadStlCar(){
  const g = await new STLLoader().loadAsync('./models/car.stl');
  g.rotateX(-Math.PI/2);                       // Z-up -> Y-up
  g.computeBoundingBox(); const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  g.translate(-c.x, -bb.min.y, -c.z);
  if (CAR_FLIP) g.rotateY(Math.PI);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color:0xd7263d, roughness:.4, metalness:.3, side:THREE.DoubleSide}));
  mesh.castShadow = true;
  const wrap = new THREE.Group(); wrap.add(mesh);
  wrap.scale.setScalar(4.5 / s.x);              // real-world length; fitted to the road later
  const out = new THREE.Group(); out.add(wrap); out.userData.width = s.z * 4.5 / s.x; return out;
}
// toycar1.obj: Y-up, forward = +X, ~4.77 x 2.54 x 2.63. Parts are painted by name (the .mtl was not provided).
const YELLOW = 0xffc800;
const PAINT = [   // [name regex, material]
  [/glass/i,        new THREE.MeshStandardMaterial({color:0x1b2733, roughness:.05, metalness:.7, transparent:true, opacity:.85, side:THREE.DoubleSide})],
  [/tyre/i,         new THREE.MeshStandardMaterial({color:0x151515, roughness:.9})],
  [/rim/i,          new THREE.MeshStandardMaterial({color:0xc9ced4, roughness:.3, metalness:.9})],
  [/chrome/i,       new THREE.MeshStandardMaterial({color:0xb8bcc2, roughness:.2, metalness:1})],
  [/signal_light/i, new THREE.MeshStandardMaterial({color:0xff9d00, emissive:0xff6a00, emissiveIntensity:.5})],
  [/brake_light/i,  new THREE.MeshStandardMaterial({color:0xd01020, emissive:0xaa0010, emissiveIntensity:.6})],
  [/riverce_light/i,new THREE.MeshStandardMaterial({color:0xf2f2f2})],
  [/Sphere.*Light/i,new THREE.MeshStandardMaterial({color:0xfff6d0, emissive:0xfff0b0, emissiveIntensity:.8})],
  [/num_plate/i,    new THREE.MeshStandardMaterial({color:0xf5f5f5})],
  [/bumper|Body_/i, new THREE.MeshStandardMaterial({color:YELLOW, roughness:.35, metalness:.25, side:THREE.DoubleSide})],
  [/./,             new THREE.MeshStandardMaterial({color:0x2a2d31, roughness:.7})],   // light housings etc.
];
async function loadObjCar(){
  const obj = await new OBJLoader().loadAsync('./models/car.obj');
  obj.traverse(o => { if (!o.isMesh) return;
    const name = `${o.name} ${o.material?.name || ''}`;
    o.material = PAINT.find(([re]) => re.test(name))[1];
    o.castShadow = true; });
  let box = new THREE.Box3().setFromObject(obj), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new THREE.Group(); wrap.add(obj);
  wrap.scale.setScalar(4.5 / s.x);             // real-world length; fitted to the road later
  const out = new THREE.Group(); out.add(wrap); out.userData.width = s.z * 4.5 / s.x; return out;
}
// Tesla_Cybertruck.blend -> car.glb. Parts are painted by mesh name (the .blend only had grey placeholders).
const PAINT_GLB = [
  [/car_paint/i,     new THREE.MeshStandardMaterial({color:YELLOW, roughness:.3, metalness:.35})],
  [/glass_windows/i, new THREE.MeshStandardMaterial({color:0x10181f, roughness:.05, metalness:.8, transparent:true, opacity:.88})],
  [/glass_light/i,   new THREE.MeshStandardMaterial({color:0xdfe9f2, roughness:.1, metalness:.2, transparent:true, opacity:.55})],
  [/^light/i,        new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xdfeaff, emissiveIntensity:.9})],
  [/wheel/i,         new THREE.MeshStandardMaterial({color:0x141414, roughness:.8, metalness:.2})],
  [/interior/i,      new THREE.MeshStandardMaterial({color:0x1b1b1d, roughness:.8})],
  [/trunk/i,         new THREE.MeshStandardMaterial({color:0x2a2c2f, roughness:.6, metalness:.3})],
  [/body/i,          new THREE.MeshStandardMaterial({color:0xb9bec5, roughness:.35, metalness:.85})],   // steel frame
];
async function loadGlbCar(){
  const gltf = await new GLTFLoader().loadAsync('./models/car.glb');
  const m = gltf.scene; m.updateMatrixWorld(true);
  m.traverse(o => { if (!o.isMesh) return;
    const hit = PAINT_GLB.find(([re]) => re.test(o.name));
    if (hit) o.material = hit[1]; o.castShadow = true; });
  // heading: back wheels -> front wheels becomes +X
  const wp = n => { const o = m.getObjectByName(n); return o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) : null; };
  const fl = wp('wheel_FL'), bl = wp('wheel_BL'), fr = wp('wheel_FR'), br = wp('wheel_BR');
  if (fl && bl && fr && br){
    const f = fl.clone().add(fr).sub(bl).sub(br); f.y = 0;
    m.rotation.y = Math.atan2(f.z, f.x);          // rotate about Y so f points to +X
    m.updateMatrixWorld(true);
  }
  const box = new THREE.Box3().setFromObject(m), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const root = new THREE.Group(); root.add(m);
  m.position.set(-c.x, -box.min.y, -c.z);       // m.position applied after rotation: recentre in world axes
  m.updateMatrixWorld(true);
  const wrap = new THREE.Group(); wrap.add(root);
  const out = new THREE.Group(); out.add(wrap); out.userData.width = s.z;   // native metres (~6 m long)
  if (fl && bl && fr && br) out.userData.half = [fl.distanceTo(bl) / 2, fl.distanceTo(fr) / 2];   // half wheelbase, half track
  console.log('cybertruck size', s.toArray().map(v => +v.toFixed(2)));
  return out;
}
async function loadCar(){
  try{ return await loadGlbCar(); }catch(e){ console.warn('car.glb not loaded', e); }
  try{ return await loadObjCar(); }catch(e){ console.warn('car.obj not loaded', e); }
  try{ return await loadStlCar(); }catch(e){ console.warn('car.stl not loaded', e); }
  for (const url of ['./models/car.glb', './models/car.gltf']){
    try{
      const gltf = await new GLTFLoader().loadAsync(url);
      const m = gltf.scene; m.traverse(o => o.castShadow = true);
      // normalise: longest horizontal side -> X (forward), centred on the ground
      let box = new THREE.Box3().setFromObject(m), s = box.getSize(new THREE.Vector3());
      const wrap = new THREE.Group(); wrap.add(m);
      if (s.z > s.x){ m.rotation.y = Math.PI/2; box = new THREE.Box3().setFromObject(m); s = box.getSize(new THREE.Vector3()); }
      const c = box.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -box.min.y, -c.z);
      wrap.scale.setScalar(4.5 / s.x);        // real-world length; fitted to the road later
      const out = new THREE.Group(); out.add(wrap); return out;
    }catch(e){ /* try next / fallback */ }
  }
  return procCar();
}

// ---------- scene ----------
const data = await (await fetch('./data/scene.json')).json();
const b = data.bounds, cxm = (b.min[0]+b.max[0])/2, czm = (b.min[2]+b.max[2])/2;

const terrainMesh = addMesh(data.terrain, new THREE.MeshStandardMaterial({vertexColors:true, side, roughness:1,
  polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:2}),
  {colorFn: y => { const t = Math.min(Math.max(y/17, 0), 1); return [.55+.2*t, .66+.05*t, .45+.2*t]; }});
addMesh(data.green, new THREE.MeshStandardMaterial({color:0x6aa361, side, roughness:1}), {y:.12});
addMesh(data.water, new THREE.MeshStandardMaterial({color:0x4a90c2, side, roughness:.2, metalness:.2}), {y:.15});
const roadsMesh = addMesh(data.roads, new THREE.MeshStandardMaterial({color:0x3a3f45, side, roughness:.9}), {y:.2});
addMesh(data.buildings, new THREE.MeshStandardMaterial({color:0xece6dc, side, roughness:.8}), {cast:true});

// trees (instanced)
{
  const T = data.trees, n = T.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,6).translate(0,.5,0), new THREE.MeshStandardMaterial({color:0x6b4a2f}), n);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1), new THREE.MeshStandardMaterial({color:0x3f7d3a, roughness:1, flatShading:true}), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  T.forEach(([x,y,z,cr,c0,c1,tr,t0,t1], i) => {
    p.set(x, y + t0, z); s.set(Math.max(tr,.15), t1 - t0, Math.max(tr,.15)); trunk.setMatrixAt(i, m.compose(p,q,s));
    const h = c1 - c0; p.set(x, y + c0 + h/2, z); s.set(cr, h/2, cr); crown.setMatrixAt(i, m.compose(p,q,s));
  });
  trunk.castShadow = crown.castShadow = true; scene.add(trunk, crown);
}

// ---------- road network & driving ----------
// Only real carriageways: axes whose road surface is >= MIN_W metres wide
// (7+ m = main avenue; 3-3.6 m = lanes/driveways; ~2 m = footpaths and sidewalks). Try 3 to include the side lanes.
const MIN_W = 6;
const wide = data.roadGraph.edges.filter(e => e.w >= MIN_W);
const par = new Map(); const find = x => { while ((par.get(x) ?? x) !== x) x = par.get(x); return x; };
wide.forEach(e => { par.set(find(e.a), find(e.b)); });
const lenOf = e => e.pts.reduce((t, p, i) => i ? t + Math.hypot(p[0]-e.pts[i-1][0], p[2]-e.pts[i-1][2]) : 0, 0);
const sums = new Map(); wide.forEach(e => sums.set(find(e.a), (sums.get(find(e.a)) || 0) + lenOf(e)));
const mainRoot = [...sums.entries()].sort((a, b) => b[1] - a[1])[0][0];
const net = wide.filter(e => find(e.a) === mainRoot);
const roadW = Math.min(...net.map(e => e.w));
const edges = net.map(e => {
  const pts = e.pts.map(p => new THREE.Vector3(p[0], p[1] + .2, p[2]));
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i-1] + pts[i].distanceTo(pts[i-1]));
  return {a:e.a, b:e.b, pts, cum, len:cum[cum.length-1]};
});
const at = (E, d, out, tan) => {
  d = Math.min(Math.max(d, 0), E.len);
  let i = 1; while (i < E.cum.length-1 && E.cum[i] < d) i++;
  const t = (d - E.cum[i-1]) / Math.max(E.cum[i] - E.cum[i-1], 1e-6);
  out.lerpVectors(E.pts[i-1], E.pts[i], t);
  tan.subVectors(E.pts[i], E.pts[i-1]).normalize();
};

const car = await loadCar();
// scale the car to the road: width ~55% of the road width (real car = 1.85 m wide)
const carScale = Math.min(1, (roadW * .55) / (car.userData.width || 1.85));
car.scale.setScalar(carScale);
scene.add(car);
// beacon so the (road-scale) car stays findable from the overview
const beacon = new THREE.Mesh(new THREE.ConeGeometry(3, 9, 12).rotateX(Math.PI),
  new THREE.MeshBasicMaterial({color:0xff2d55, fog:false, depthTest:false, transparent:true, opacity:.9}));
beacon.renderOrder = 10; scene.add(beacon);
scene.updateMatrixWorld(true);
console.log(`road width ${roadW.toFixed(2)} m, car scale ${carScale.toFixed(2)} , car width ${((car.userData.width || 1.85)*carScale).toFixed(2)} m`);

let cur = edges.reduce((a, e) => e.len > a.len ? e : a), dir = 1, dist = 0, last = -1;
const P = new THREE.Vector3(), Tn = new THREE.Vector3(), yaw = {v:0};
function step(dt, speed){
  dist += speed * dt;
  while (dist > cur.len){
    dist -= cur.len;
    const node = dir > 0 ? cur.b : cur.a;
    const opts = edges.filter(e => e !== cur && (e.a === node || e.b === node));
    const nxt = opts.length ? opts[Math.floor(Math.random()*opts.length)] : cur;   // dead end -> turn around
    if (nxt === cur){ dir = -dir; }
    else { dir = nxt.a === node ? 1 : -1; cur = nxt; }
  }
}
// Ride the surface: sample the road (else terrain) under the four wheels, fit a plane -> pitch AND roll.
const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0,-1,0), _o = new THREE.Vector3();
const UP = new THREE.Vector3(0,1,0), fwd = new THREE.Vector3(1,0,0), lat = new THREE.Vector3(0,0,1);
const upS = new THREE.Vector3(0,1,0), _m = new THREE.Matrix4();
const wheel = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];  // FL FR RL RR
function groundY(x, z, fallback){
  ray.set(_o.set(x, fallback + 6, z), DOWN);
  const h = ray.intersectObject(roadsMesh, false)[0] || ray.intersectObject(terrainMesh, false)[0];
  return h ? h.point.y : fallback;
}
function place(){
  const d = dir > 0 ? dist : cur.len - dist;
  at(cur, d, P, Tn); if (dir < 0) Tn.negate();
  // heading from the road (horizontal part only), smoothed
  const hx = Tn.x, hz = Tn.z, hl = Math.hypot(hx, hz) || 1;
  fwd.x += (hx/hl - fwd.x) * .2; fwd.z += (hz/hl - fwd.z) * .2; fwd.y = 0; fwd.normalize();
  lat.crossVectors(fwd, UP).normalize();
  const [hl_, hw_] = car.userData.half || [1.4, .9], L = hl_ * carScale, W = hw_ * carScale;
  [[L,-W],[L,W],[-L,-W],[-L,W]].forEach(([l, w], i) => {
    const x = P.x + fwd.x*l + lat.x*w, z = P.z + fwd.z*l + lat.z*w;
    wheel[i].set(x, groundY(x, z, P.y), z);
  });
  const f = wheel[0].clone().add(wheel[1]).sub(wheel[2]).sub(wheel[3]);   // rear -> front
  const r = wheel[1].clone().add(wheel[3]).sub(wheel[0]).sub(wheel[2]);   // left -> right
  const up = r.clone().cross(f).normalize();
  upS.lerp(up, .25).normalize();
  const fw = f.normalize().sub(upS.clone().multiplyScalar(f.dot(upS))).normalize();
  const rt = fw.clone().cross(upS).normalize();
  car.quaternion.setFromRotationMatrix(_m.makeBasis(fw, upS, rt));
  car.position.set(P.x, (wheel[0].y + wheel[1].y + wheel[2].y + wheel[3].y) / 4, P.z);
}

// ---------- camera ----------
const home = {pos:new THREE.Vector3(cxm + 240, 430, czm + 560), target:new THREE.Vector3(cxm, 0, czm)};
function resetView(){ camera.position.copy(home.pos); controls.target.copy(home.target); follow = false; btnF.setAttribute('aria-pressed','false'); }
let follow = false;
const btnF = document.getElementById('follow');
btnF.onclick = () => { follow = !follow; btnF.setAttribute('aria-pressed', follow);
  if (follow){ controls.target.copy(car.position); camera.position.copy(car.position).add(new THREE.Vector3(-12, 9, 12)); } };
document.getElementById('reset').onclick = resetView;
const speedEl = document.getElementById('speed');
resetView();

function resize(){ const w = innerWidth, h = innerHeight; renderer.setSize(w, h); camera.aspect = w/h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
status.textContent = 'Тяните мышью — вращение, колесо — масштаб, правая кнопка — сдвиг';
setTimeout(() => status.style.display = 'none', 6000);

let prev = performance.now();
window.__car = car;
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prev)/1000, .1); prev = now;
  step(dt, +speedEl.value); place();
  if (follow){ const off = camera.position.clone().sub(controls.target); controls.target.lerp(car.position, .15); camera.position.copy(controls.target).add(off); }
  beacon.position.copy(car.position).y += 12 + Math.sin(now/300);
  beacon.scale.setScalar(Math.max(.3, Math.min(5, camera.position.distanceTo(car.position) / 120)));
  controls.update(); renderer.render(scene, camera);
});
