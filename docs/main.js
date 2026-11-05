// Interactive viewer (index.html): free orbit camera, follow button, speed slider.
// The map / car / driving logic lives in world.js and is shared with the portfolio scene (portfolio.js).
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildWorld, PAL} from './world.js';

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

const data = await (await fetch('./data/scene.json')).json();
const world = await buildWorld({scene, data});
const {car, bounds} = world;
scene.fog = new THREE.Fog(PAL.bg, bounds.size * 1.4, bounds.size * 4);

const beacon = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 12).rotateX(Math.PI),
  new THREE.MeshBasicMaterial({color:0xff2d55, fog:false, depthTest:false, transparent:true, opacity:.9}));
beacon.renderOrder = 10; scene.add(beacon);

// ---------------------------------------------------------------- camera / UI
const SIZE = bounds.size;
const home = {pos:new THREE.Vector3(bounds.cx + SIZE*.3, SIZE*.55, bounds.cz + SIZE*.75), target:new THREE.Vector3(bounds.cx, 0, bounds.cz)};
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
window.__cam = {camera, controls}; window.__car = car; window.__edges = world.edges; window.__world = world;
window.__neighbours = () => []; window.__speed = () => world.speed; window.__setSpeed = x => { world.speed = x; };
window.__steer = () => world.steer; window.__brake = () => world.brake; window.__goto = (i, d, dr) => world.goto(i, d, dr);

let prevT = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - prevT)/1000, .1); prevT = now;
  world.update(dt, +speedEl.value);
  if (follow){ const off = camera.position.clone().sub(controls.target); controls.target.lerp(car.position, .15); camera.position.copy(controls.target).add(off); }
  beacon.position.copy(car.position).y += 9 + Math.sin(now/300);
  beacon.scale.setScalar(Math.max(.3, Math.min(6, camera.position.distanceTo(car.position) / 150)));
  controls.update(); renderer.render(scene, camera);
});
