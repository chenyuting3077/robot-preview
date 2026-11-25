/** Rows of the toolbar's Info panel for a loaded model. Usage: modelInfoRows(model, fileName, size, t) */
import { isScalarJoint } from '../models/UnifiedRobotModel.js';

const short = value => String(+value.toPrecision(3));

function formatOf(model, fileName) {
    const ext = (fileName.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
    if (model.userData?.type === 'mjcf') return 'MJCF';
    return { world: 'SDF', xacro: 'Xacro' }[ext] || ext.toUpperCase();
}

/**
 * @param size {x, y, z} in meters in the model's frame, or null
 * @returns [label, value] pairs with empty values left out
 */
export function modelInfoRows(model, fileName, size, t) {
    const joints = model.isMesh ? [] : [...model.joints.values()];
    const mass = model.isMesh ? 0 : [...model.links.values()].reduce((sum, link) => sum + (link.inertial?.mass || 0), 0);
    return [
        [t('file'), fileName],
        [t('format'), formatOf(model, fileName)],
        [t('links'), !model.isMesh && model.links.size.toLocaleString()],
        [t('joints'), joints.length > 0 && joints.length.toLocaleString()],
        [t('movableJoints'), joints.length > 0 && joints.filter(isScalarJoint).length.toLocaleString()],
        [t('totalMass'), mass > 0 && `${short(mass)} kg`],
        [t('size'), size && [size.x, size.y, size.z].map(short).join(' × ')],
        // URDF, MJCF and SDF are in meters, as the USD viewer's row reads a stage's unit; a mesh file states none.
        [t('unit'), size && !model.isMesh && 'm']
    ].filter(([, value]) => value);
}
