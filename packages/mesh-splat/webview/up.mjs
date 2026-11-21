import * as THREE from 'three';

// The turn that brings each up axis to the screen's up (three.js +Y).
export const UP = { '+Y': [0, 0, 0], '-Y': [Math.PI, 0, 0], '+Z': [-Math.PI / 2, 0, 0], '-Z': [Math.PI / 2, 0, 0], '+X': [0, 0, Math.PI / 2], '-X': [0, 0, -Math.PI / 2] };

const turn = up => new THREE.Quaternion().setFromEuler(new THREE.Euler(...UP[up]));

// The view turns by the up of the file it opened with; a file that declares another up (glTF is +Y by spec, a
// PCD +Z by REP 103) is turned by this first, so it stands in the view as it stands on its own.
export const relativeUp = (viewUp, fileUp) => turn(viewUp).invert().multiply(turn(fileUp));
