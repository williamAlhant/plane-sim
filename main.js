import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import * as LOOPING from './looping.js';
import rsLibInit, { step_model } from './rs_lib/plane_physics_support_rs_lib.js'

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
const light = new THREE.AmbientLight(0xffffff);
scene.add(light);
const orthoCameraWidth = 15;
const orthoCameraHeight = orthoCameraWidth * window.innerHeight / window.innerWidth;
const camera = new THREE.OrthographicCamera( orthoCameraWidth / - 2, orthoCameraWidth / 2, orthoCameraHeight / 2, orthoCameraHeight / - 2, 0.1, 1000 );
// const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
camera.position.z = 5;

window.addEventListener( 'resize', onWindowResize, false );

function onWindowResize(){
    renderer.setSize( window.innerWidth, window.innerHeight );
}

function makeRulerTexture() {
    const rulerTexture = new THREE.TextureLoader().load('ruler-tex.png');
    rulerTexture.magFilter = THREE.NearestFilter;
    rulerTexture.wrapS = THREE.RepeatWrapping;
    return rulerTexture;
}

const rulerTexture = makeRulerTexture();

function makeRuler(length, width, num_grad) {
    const planeLength = length;
    const planeWidth = width;
    const geometry = new THREE.PlaneGeometry( planeLength, planeWidth );
    const rulerMaterial = new THREE.MeshBasicMaterial( { map: rulerTexture } );
    const ruler = new THREE.Mesh(geometry, rulerMaterial);
    ruler.width = width;
    ruler.length = length;
    ruler.num_grad = num_grad;
    ruler.setScroll = (x) => {rulerSetScroll(ruler, x)};
    ruler.setScroll(0);
    return ruler;
}

function rulerSetScroll(ruler, xi) {
    const uv = ruler.geometry.attributes.uv;
    const x = xi * ruler.num_grad / ruler.length;
    uv.setXY(0, x , 1);
    uv.setXY(1, x + ruler.num_grad, 1);
    uv.setXY(2, x, 0);
    uv.setXY(3, x + ruler.num_grad, 0);
    uv.needsUpdate = true;
}

const bottomRulers = [makeRuler(10, 0.5, 10), makeRuler(10, 1, 1)];
const sideRulers = [makeRuler(10, 0.5, 10), makeRuler(10, 1, 1)];

bottomRulers.forEach((ruler, i) => {
    ruler.position.set(camera.position.x, camera.position.y - orthoCameraHeight / 2 + ruler.width / 2, camera.position.z - 1 - i * 0.1);
    // ruler.position.set(camera.position.x, camera.position.y, 0 - i * 0.1);
    scene.add(ruler);
});

sideRulers.forEach((ruler, i) => {
    ruler.setRotationFromMatrix(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    ruler.position.set(camera.position.x + orthoCameraWidth / 2 - ruler.width / 2, camera.position.y, camera.position.z - 1 - i * 0.1);
    scene.add(ruler);
});

let resetFlag = false;
let pauseFlag = false;
const controls = {
    elevator: -10, // deg
    reset: () => { resetFlag = true; },
    pause: () => { pauseFlag = !pauseFlag; },
    v_x: 0.0,
    v_y: 0.0,
    power: 100_000.0,
    thrust_to_weight: 0.0
};
const gui = new GUI();
gui.add(controls, 'elevator', -30, 10);
gui.add(controls, 'reset');
gui.add(controls, 'pause');
gui.add(controls, 'v_x').disable().listen();
gui.add(controls, 'v_y').disable().listen();
gui.add(controls, 'power', 50_000.0, 300_000.0);
gui.add(controls, 'thrust_to_weight').name('T/W').disable().listen();

var plane;
var pos_cg;
var elev;
var elev_local_quat;

function makeDebugCircle() {
    const geometry = new THREE.SphereGeometry(0.1);
    const material = new THREE.MeshBasicMaterial({color: 0x049ef4});
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
}
const debugCircle = makeDebugCircle();
debugCircle.name = 'dbg_cg';

function onGLTFLoad(gltf) {
    plane = gltf.scene;
    const bol = plane.getObjectByName('bol');
    const porte = plane.getObjectByName('porteG');
    elev = plane.getObjectByName('ailes2');
    elev_local_quat = elev.quaternion.clone();
    pos_cg = new THREE.Vector3(0, bol.position.y, porte.position.z);
    debugCircle.position.add(pos_cg);
    plane.add(debugCircle);
    scene.add(plane);
}

new GLTFLoader().load('PA28.glb', onGLTFLoad);

// var simData;
//
// async function get_sim_data() {
//     const response = await fetch("./sim_data.json");
//     const json = await response.json();
//     return json;
// }

class SimState {
    constructor(obj = {}) {
        this.pos_x = obj.pos_x || 0.0;
        this.pos_y = obj.pos_y || 0.0;
        this.v_x = obj.v_x || 50.0;
        this.v_y = obj.v_y || 0.0;
        this.alpha = obj.alpha || 0.2;
        this.d_alpha = obj.d_alpha || 0.0;
        this.e_deflection = obj.e_deflection || 0.0;
        this.power_prop = obj.power_prop || controls.power;
        // this.simDataIndex = 0;
    }

    clone() {
        const copy = new this.constructor();
        copy.pos_x = this.pos_x;
        copy.pos_y = this.pos_y;
        copy.v_x = this.v_x;
        copy.v_y = this.v_y;
        copy.alpha = this.alpha;
        copy.d_alpha = this.d_alpha;
        copy.e_deflection = this.e_deflection;
        copy.power_prop = this.power_prop;
        // copy.simDataIndex = this.simDataIndex;
        return copy;
    }
}

function calcTickUpdateUser(previousState) {
    if (resetFlag) {
        resetFlag = false;
        return new SimState();
    }
    if (pauseFlag) {
        return previousState.clone();
    }
    const stateFromStepObj = step_model(previousState);
    const newState = new SimState(stateFromStepObj);
    newState.e_deflection = controls.elevator * Math.PI / 180;
    newState.power_prop = controls.power;
    controls.v_x = newState.v_x;
    controls.v_y = newState.v_y;
    controls.thrust_to_weight = stateFromStepObj.thrust_to_weight;
    return newState;
}

// function calcTickUpdateUser(previousState) {
//     const previousIndex = previousState.simDataIndex;
//     if (previousIndex + 1 < simData.state_vecs.length) {
//         const newIndex = previousIndex + 1;
//         const stateVec = simData.state_vecs[newIndex];
//         const newState = new SimState();
//         newState.simDataIndex = newIndex;
//         newState.pos_x = stateVec[0];
//         newState.pos_y = stateVec[1];
//         newState.alpha = stateVec[4];
//         return newState;
//     } else {
//         return previousState.clone();
//     }
// }

function renderFrameUser(interpStartState, interpEndState, interpFactor) {
    if (!plane) {
        return;
    }

    const start = interpStartState;
    const end = interpEndState;

    const pos_x = start.pos_x + interpFactor * (end.pos_x - start.pos_x);
    const pos_y = start.pos_y + interpFactor * (end.pos_y - start.pos_y);
    const alpha = start.alpha + interpFactor * (end.alpha - start.alpha);

    const e_deflection = controls.elevator * Math.PI / 180;
    const deflection_quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeRotationX(-e_deflection));
    elev.quaternion.copy(deflection_quat.multiply(elev_local_quat));

    plane.setRotationFromMatrix(new THREE.Matrix4().identity());
    plane.position.copy(new THREE.Vector3().sub(pos_cg));
    plane.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));

    plane.applyMatrix4(new THREE.Matrix4().makeRotationZ(alpha));
    plane.position.add(pos_cg);

    bottomRulers.forEach((ruler, i) => {
        ruler.setScroll(pos_x);
    });

    sideRulers.forEach((ruler, i) => {
        ruler.setScroll(pos_y);
    });

    renderer.clear();
    renderer.render( scene, camera );
    renderer.clearDepth();
    renderer.render( debugCircle, camera );
}

async function main() {
    // simData = await get_sim_data();
    // if (simData.tick * 1000 != LOOPING.tickMs) {
    //     throw new Error("Unexpected tick in sim data");
    // }
    await rsLibInit();
    renderer.setClearColor(0xe3bb76, 1);
    renderer.autoClear = false;
    LOOPING.startLooping(renderFrameUser, calcTickUpdateUser, new SimState());
}

console.debug = () => {};
main();
