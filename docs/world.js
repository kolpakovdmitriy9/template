import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------- settings
export const YELLOW = 0xffc800;   // car paint
export const CAR_SCALE = 0.5;     // Cybertruck is ~6 m long; 0.5 -> ~3 m so it can turn / U-turn inside the road
const STEER_MAX = 0.85;           // rad (~49 deg)
export const PAL = {              // light "paper-model" palette
  bg: 0xf4f7f9, ground: 0xeeeeec, road: 0xd3d5d8, building: 0xf3f2f0, edge: 0xcfcfcc,
  water: 0xd6e9f3, green: 0xdcefd3, crown: 0xa9e37c, trunk: 0x8a5a3c, mark: 0xffffff,
};

/**
 * Builds the whole 3D world (map + car + fixed route + driving logic) into `scene`.
 * Returns {car, route, bounds, sun, update(dt, speed), ...}. No renderer / camera / UI in here.
 */
export async function buildWorld({scene, data, carUrl = new URL('./models/car.glb', import.meta.url).href, routePre = [[446,-339],[434,-338]], shadowSize = 2048}){
scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3e6, 1.5));
const hemi = scene.children[scene.children.length - 1];
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, {left:-90, right:90, top:90, bottom:-90, near:10, far:700});
scene.add(sun, sun.target);       // the shadow box follows the car (see update)
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
const b = data.bounds, cxm = (b.min[0]+b.max[0])/2, czm = (b.min[2]+b.max[2])/2;
const SIZE = Math.max(b.max[0]-b.min[0], b.max[2]-b.min[2]);
const terrainMesh = addMesh(data.terrain, new THREE.MeshStandardMaterial({color:PAL.ground, side:DS, roughness:1,
  polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:2}));
addMesh(data.green, new THREE.MeshStandardMaterial({color:PAL.green, side:DS, roughness:1}), {y:.1});
// one material for every water piece, drawn on top of the (sunk) terrain: no seams / stripes
addMesh(data.water, new THREE.MeshStandardMaterial({color:PAL.water, side:DS, roughness:1, metalness:0,
  polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}), {y:.05});
addMesh(data.roads, new THREE.MeshStandardMaterial({color:PAL.road, side:DS, roughness:1,
  polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1}), {y:.2});
// road markings (zebra crossings, turn arrows, dashed centre lines): flat triangles on top of the roads; only in the flat world
if (data.markings && data.markings.idx.length) addMesh(data.markings, new THREE.MeshStandardMaterial({color:PAL.mark, side:DS, roughness:1,
  polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3}), {y:.24});

// street furniture (flat world only): sign posts with road signs and traffic lights on junction corners
if (data.props){
  const P = data.props, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1,1,1);
  const place = (inst, list, fn) => { list.forEach((it, i) => { fn(it, i); inst.setMatrixAt(i, M); }); inst.instanceMatrix.needsUpdate = true; return inst; };
  const yaw = (nx, nz) => Q.setFromAxisAngle(new THREE.Vector3(0,1,0), Math.atan2(nx, nz));
  // poles
  const poleMat = new THREE.MeshStandardMaterial({color:0x6c7178, roughness:.6, metalness:.3});
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .06, 3.1, 6).translate(0, 1.55, 0), poleMat, P.poles.length);
  place(poles, P.poles, (p, i) => { M.compose(V.set(p[0], 0, p[1]), Q.identity(), S); });
  poles.castShadow = true; scene.add(poles);
  // road signs: one instanced mesh per sign design (blue direction signs, white speed-limit discs)
  const sign = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); draw(x);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const blueSq = (x) => { x.fillStyle = '#1f6fd6'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#fff'; x.strokeStyle = '#fff'; };
  const arrowTex = (dir) => sign(x => { blueSq(x); x.save(); x.translate(64, 64); x.scale(dir, 1); x.beginPath();
    x.moveTo(-34, -12); x.lineTo(8, -12); x.lineTo(8, -30); x.lineTo(38, 0); x.lineTo(8, 30); x.lineTo(8, 12); x.lineTo(-34, 12); x.closePath(); x.fill(); x.restore(); });
  const pedTex = sign(x => { blueSq(x); x.beginPath(); x.arc(64, 40, 12, 0, Math.PI * 2); x.fill();
    x.fillRect(54, 54, 20, 36); x.fillRect(40, 58, 10, 28); x.fillRect(78, 58, 10, 28); x.fillRect(48, 86, 10, 26); x.fillRect(70, 86, 10, 26); });
  const limitTex = (v) => sign(x => { x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#d7262b'; x.lineWidth = 12; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#111'; x.font = 'bold 60px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(v), 64, 68); });
  const designs = {
    'turn:1': arrowTex(1), 'turn:-1': arrowTex(-1), 'ped:0': pedTex, 'limit:40': limitTex(40), 'limit:60': limitTex(60)
  };
  const groups = {};
  P.signs.forEach(sg => { const key = sg[4] === 'turn' ? 'turn:' + (sg[5] > 0 ? 1 : -1) : sg[4] === 'ped' ? 'ped:0' : 'limit:' + sg[5]; (groups[key] = groups[key] || []).push(sg); });
  for (const [key, list] of Object.entries(groups)){
    const mat = new THREE.MeshBasicMaterial({map: designs[key], side: THREE.DoubleSide, transparent: true, alphaTest: .05});
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(.75, .75), mat, list.length);
    place(inst, list, (sg) => { M.compose(V.set(sg[0], 2.6, sg[1]), yaw(sg[2], sg[3]), S); });
    scene.add(inst);
  }
  // traffic lights: a dark head on top of a pole, three lamps on its front
  const lights = P.lights;
  if (lights.length){
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(.36, .9, .26), new THREE.MeshStandardMaterial({color:0x1b1d20, roughness:.5}), lights.length);
    const lampGeo = new THREE.PlaneGeometry(.1, .1);
    const lampRed = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({color:0xff3b30}), lights.length);
    const lampYel = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({color:0xffcc00}), lights.length);
    const lampGrn = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({color:0x34c759}), lights.length);
    const lposeGeo = new THREE.CylinderGeometry(.07, .07, 3.4, 6).translate(0, 1.7, 0);
    const lpole = new THREE.InstancedMesh(lposeGeo, poleMat, lights.length);
    const off = new THREE.Vector3();
    lights.forEach((l, i) => {
      const q = yaw(l[2], l[3]); const fwd = new THREE.Vector3(l[2], 0, l[3]);
      M.compose(V.set(l[0], 0, l[1]), Q.identity(), S); lpole.setMatrixAt(i, M);
      M.compose(V.set(l[0], 3.45, l[1]), q, S); head.setMatrixAt(i, M);
      const lamp = (inst, dy) => { M.compose(off.set(l[0], 3.45 + dy, l[1]).addScaledVector(fwd, .135), q, S); inst.setMatrixAt(i, M); };
      lamp(lampRed, .3); lamp(lampYel, 0); lamp(lampGrn, -.3);
    });
    [lpole, head, lampRed, lampYel, lampGrn].forEach(m => { m.instanceMatrix.needsUpdate = true; m.castShadow = m === lpole || m === head; scene.add(m); });
  }
}
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
function makeRearLightsRed(m, fwd, centre, halfLen){
  const tex = glowTexture(), rear = [], jobs = [], sprites = [];
  let plight = null;
  m.traverse(o => { if (o.isMesh && /^(light|glass_light)/i.test(o.name) && o.geometry.index) jobs.push(o); });
  for (const o of jobs){
    const g = o.geometry, pos = g.attributes.position, idx = g.index.array;
    const V = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], C = new THREE.Vector3(), front = [], back = [];
    for (let i = 0; i < idx.length; i += 3){
      C.set(0,0,0); for (let k = 0; k < 3; k++){ V[k].fromBufferAttribute(pos, idx[i+k]).applyMatrix4(o.matrixWorld); C.add(V[k]); }
      C.multiplyScalar(1/3);
      const isRear = C.clone().sub(centre).dot(fwd) < -.6 * halfLen;     // only the very back of the car
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
  const gltf = await new GLTFLoader().loadAsync(carUrl);
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
  const rearLights = makeRearLightsRed(m, new THREE.Vector3(1,0,0), c, s.x / 2);
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
// ---- fixed route (drawn by the user): start east of the wide avenue, west along the street, south along the long
// street, then west again. Pieces are cut out of the road axes by their index in data.roadGraph.edges.
const ROUTE = {
  pre: routePre,                                      // arrow start (east of the avenue)
  legs: [[321,[421,-337],[249,-328]],                 // E-W street heading west
         [265,[249,-328],[229,-70]],                  // long N-S street heading south
         [237,[229,-70],[166,-66]]],                  // turn west at the second street
};
function cutEdge(E, p, q){                            // part of polyline E.pts between the points nearest to p and q
  const nearest = pt => { let best = {d:1e9};
    for (let i = 0; i < E.pts.length - 1; i++){
      const a = E.pts[i], b = E.pts[i+1], dx = b[0]-a[0], dz = b[2]-a[2], L2 = dx*dx + dz*dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((pt[0]-a[0])*dx + (pt[1]-a[2])*dz) / L2));
      const x = a[0] + dx*t, z = a[2] + dz*t, d = Math.hypot(pt[0]-x, pt[1]-z);
      if (d < best.d) best = {d, i, t, p:[x, a[1] + (b[1]-a[1])*t, z]}; }
    return best; };
  const A = nearest(p), B = nearest(q), fwdDir = (A.i + A.t) <= (B.i + B.t);
  const out = [A.p];
  if (fwdDir){ for (let i = A.i + 1; i <= B.i; i++) out.push(E.pts[i]); }
  else      { for (let i = A.i; i > B.i; i--) out.push(E.pts[i]); }
  out.push(B.p); return out;
}
const routePts = []; let routeW = 99;
{
  const E = data.roadGraph.edges;
  ROUTE.legs.forEach(([i, p, q]) => { routeW = Math.min(routeW, E[i].w); cutEdge(E[i], p, q).forEach(pt => {
    const last = routePts[routePts.length-1]; if (!last || Math.hypot(last[0]-pt[0], last[2]-pt[2]) > .05) routePts.push(pt); }); });
  const y0 = routePts[0][1]; ROUTE.pre.slice().reverse().forEach(([x, z]) => routePts.unshift([x, y0, z]));
}
const route = (() => {
  const pts = routePts.map(p => new THREE.Vector3(p[0], p[1] + .2, p[2]));
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i-1] + pts[i].distanceTo(pts[i-1]));
  return {w:routeW, pts, cum, len:cum[cum.length-1], ends:[pts[0], pts[pts.length-1]]};
})();
const edges = [route];
const neighbours = () => [];            // both ends are dead ends: the car U-turns and drives the route back and forth
console.log(`route: ${route.len.toFixed(0)} m, road ${route.w} m wide, ${route.pts.length} points`);
const at = (E, d, out, tan) => {
  d = Math.min(Math.max(d, 0), E.len);
  let i = 1; while (i < E.cum.length-1 && E.cum[i] < d) i++;
  const t = (d - E.cum[i-1]) / Math.max(E.cum[i] - E.cum[i-1], 1e-6);
  out.lerpVectors(E.pts[i-1], E.pts[i], t);
  tan.subVectors(E.pts[i], E.pts[i-1]).normalize();
};
// invisible ray-cast surface = the drivable road hatches (bridges included), terrain as fallback
const driveMesh = (() => {
  const bb = new THREE.Box3().setFromPoints(route.pts).expandByScalar(30), pos = data.roads.pos, src = data.roads.idx, idx = [];
  for (let i = 0; i < src.length; i += 3){
    const x = (pos[src[i]*3] + pos[src[i+1]*3] + pos[src[i+2]*3]) / 3, z = (pos[src[i]*3+2] + pos[src[i+1]*3+2] + pos[src[i+2]*3+2]) / 3;
    if (x > bb.min.x && x < bb.max.x && z > bb.min.z && z < bb.max.z) idx.push(src[i], src[i+1], src[i+2]);
  }
  return new THREE.Mesh(geom({pos, idx}));
})();
driveMesh.position.y = .2; driveMesh.updateMatrixWorld(true);
terrainMesh.updateMatrixWorld(true);

const car = await loadCar();
car.scale.setScalar(CAR_SCALE);
scene.add(car);
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
      uturn = {phi:0, r:Math.max(offS, 1.6), c:P.clone(), td:Tn.clone().setY(0).normalize()};
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
    offS += (Math.min(Math.max(cur.w * .25, .45), 2.2) - offS) * (1 - Math.exp(-dt * 3));
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
// ---------------------------------------------------------------- per-frame logic
let v = 0, brakeHold = 0, brakeK = 0;
setBrake(0);
function update(dt, base){
  // speed: slow down for turns (look at the steering angle), brake lights glow only while braking
  const target = base * (1 - .65 * Math.min(Math.abs(steerS) / .45, 1));
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
}
return {
  car, route, edges, sun, hemi, update, terrainMesh,
  bounds: {cx: cxm, cz: czm, size: SIZE, minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2]},
  get speed(){ return v; }, set speed(x){ v = x; }, get steer(){ return steerS; }, get brake(){ return brakeK; },
  goto(i, d, dr = 1){ cur = edges[i]; dir = dr; dist = d; uturn = null; },
};
}
