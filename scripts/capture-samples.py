"""Builds test-files/capture/, the openly licensed samples tests/e2e/capture.mjs records.
Usage: pnpm fixtures:usd && python3 scripts/capture-samples.py   (needs numpy, pandas, Pillow and git)
"""
import glob, gzip, io, json, os, pickle, shutil, subprocess, urllib.request, zipfile
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test-files')
OUT, TMP = os.path.join(ROOT, 'capture'), os.path.join(ROOT, 'capture', '.download')
PLY = 'ply\nformat binary_little_endian 1.0\nelement vertex %d\n%send_header\n'


def fetch(url, file):
    if not os.path.exists(file):
        os.makedirs(os.path.dirname(file), exist_ok=True)
        urllib.request.urlretrieve(url, file)
    return file


def so101():
    """SO-101 URDF, MJCF and STEP assembly: TheRobotStudio/SO-ARM100, Apache-2.0."""
    repo = os.path.join(TMP, 'SO-ARM100')
    if not os.path.exists(repo):
        subprocess.run(['git', 'clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/TheRobotStudio/SO-ARM100', repo], check=True)
        subprocess.run(['git', '-C', repo, 'sparse-checkout', 'set', 'Simulation/SO101', 'STEP/SO101'], check=True)
    os.makedirs(os.path.join(OUT, 'so101'), exist_ok=True)
    for name in ['assets', 'scene.xml', 'joints_properties.xml', 'so101_new_calib.urdf', 'so101_new_calib.xml']:
        src, dst = os.path.join(repo, 'Simulation/SO101', name), os.path.join(OUT, 'so101', name)
        shutil.copytree(src, dst, dirs_exist_ok=True) if os.path.isdir(src) else shutil.copy(src, dst)
    shutil.copy(os.path.join(repo, 'STEP/SO101/SO101 Assembly.step'), os.path.join(OUT, 'perception', 'so101_assembly.step'))


def bust(count=1200000):
    """A splat of flat Gaussians sampled from Poly Haven's Marble Bust 01 (CC0), turned z-up."""
    base = 'https://dl.polyhaven.org/file/ph-assets/Models/'
    gltf = json.load(open(fetch(base + 'gltf/1k/marble_bust_01/marble_bust_01_1k.gltf', os.path.join(TMP, 'bust.gltf'))))
    data = open(fetch(base + 'gltf/8k/marble_bust_01/marble_bust_01.bin', os.path.join(TMP, 'bust.bin')), 'rb').read()
    texture = np.asarray(Image.open(fetch(base + 'jpg/2k/marble_bust_01/marble_bust_01_diff_2k.jpg', os.path.join(TMP, 'bust.jpg'))).convert('RGB'), np.float32) / 255

    def accessor(index):
        a = gltf['accessors'][index]
        view = gltf['bufferViews'][a['bufferView']]
        width = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        return np.frombuffer(data, {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a['componentType']], a['count'] * width, view.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, width)

    primitive = gltf['meshes'][0]['primitives'][0]
    zup = lambda v: np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)
    points, normals, uvs = zup(accessor(primitive['attributes']['POSITION'])), zup(accessor(primitive['attributes']['NORMAL'])), accessor(primitive['attributes']['TEXCOORD_0'])
    faces = accessor(primitive['indices']).reshape(-1, 3).astype(int)
    rng = np.random.default_rng(0)
    a, b, c = (points[faces[:, k]] for k in range(3))
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    face = rng.choice(len(faces), count, p=area / area.sum())
    u, v = rng.random(count), rng.random(count)
    over = u + v > 1
    u[over], v[over] = 1 - u[over], 1 - v[over]
    weights = np.stack([1 - u - v, u, v], 1)
    mix = lambda values: (values[faces[face]] * weights[:, :, None]).sum(1)
    position, normal, uv = mix(points), mix(normals), mix(uvs)
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    height, width = texture.shape[:2]
    color = texture[np.clip((uv[:, 1] % 1 * height).astype(int), 0, height - 1), np.clip((uv[:, 0] % 1 * width).astype(int), 0, width - 1)]
    # Each Gaussian's z axis is turned onto the surface normal (a wxyz quaternion) and squashed along it.
    axis = np.cross(np.broadcast_to([0, 0, 1.0], normal.shape), normal)
    sine = np.linalg.norm(axis, axis=1)
    half = np.arctan2(sine, normal[:, 2]) / 2
    rotation = np.concatenate([np.cos(half)[:, None], axis / np.maximum(sine, 1e-9)[:, None] * np.sin(half)[:, None]], 1)
    radius = np.sqrt(area.sum() / count) * 1.25 * np.exp(rng.normal(0, 0.25, count))
    scale = np.log(np.stack([radius, radius * np.exp(rng.normal(0, 0.3, count)), radius * 0.1], 1))
    names = 'x y z nx ny nz f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3'.split()
    splat = np.zeros(count, dtype=[(name, '<f4') for name in names])
    for k in range(3):
        splat['xyz'[k]], splat[f'f_dc_{k}'], splat[f'scale_{k}'] = position[:, k], (color[:, k] - 0.5) / 0.28209479, scale[:, k]
    for k in range(4):
        splat[f'rot_{k}'] = rotation[:, k]
    splat['opacity'] = 6
    with open(os.path.join(OUT, 'perception', 'marble_bust.ply'), 'wb') as out:
        out.write((PLY % (count, ''.join(f'property float {name}\n' for name in names))).encode())
        out.write(splat.tobytes())


class Ranged(io.RawIOBase):
    """A remote file read by HTTP ranges, so one sequence comes out of the 44 GB PandaSet zip."""

    def __init__(self, url):
        response = urllib.request.urlopen(urllib.request.Request(url, method='HEAD'))
        self.url, self.size, self.at = response.url, int(response.headers['Content-Length']), 0

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.at

    def seek(self, offset, whence=0):
        self.at = [offset, self.at + offset, self.size + offset][whence]
        return self.at

    def readinto(self, buffer):
        if self.at >= self.size or not len(buffer):
            return 0
        request = urllib.request.Request(self.url, headers={'Range': f'bytes={self.at}-{min(self.size, self.at + len(buffer)) - 1}'})
        got = urllib.request.urlopen(request).read()
        buffer[:len(got)] = got
        self.at += len(got)
        return len(got)


class Frames(pickle.Unpickler):
    """Sweeps are pickled DataFrames; a downloaded pickle may name any callable, so only pandas and numpy load."""

    def find_class(self, module, name):
        if module.split('.')[0] in ('pandas', 'numpy') or (module, name) in (('builtins', 'slice'), ('builtins', 'object'), ('copyreg', '_reconstructor')):
            return super().find_class(module, name)
        raise pickle.UnpicklingError(f'{module}.{name} refused')


def street(sequence='001'):
    """The 80 Pandar64 sweeps of one PandaSet sequence (Hesai and Scale AI, CC BY 4.0), already in world coordinates, as one PCD."""
    folder = os.path.join(TMP, 'pandaset', sequence)
    if len(glob.glob(folder + '/*.pkl.gz')) < 80:
        os.makedirs(folder, exist_ok=True)
        archive = zipfile.ZipFile(io.BufferedReader(Ranged('https://huggingface.co/datasets/georghess/pandaset/resolve/main/pandaset.zip'), 1 << 22))
        for name in archive.namelist():
            if name.startswith(f'pandaset/{sequence}/lidar/') and name.endswith('.pkl.gz'):
                open(os.path.join(folder, os.path.basename(name)), 'wb').write(archive.read(name))
    sweeps = [Frames(gzip.open(file)).load() for file in sorted(glob.glob(folder + '/*.pkl.gz'))]
    cloud = np.concatenate([sweep[sweep['d'] == 0][['x', 'y', 'z', 'i']].to_numpy(np.float32) for sweep in sweeps])
    cloud[:, :3] -= np.median(cloud[:, :3], 0)
    cloud[:, 2] -= np.percentile(cloud[:, 2], 2)
    with open(os.path.join(OUT, 'perception', 'street_scan.pcd'), 'wb') as out:
        out.write(f'VERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH {len(cloud)}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS {len(cloud)}\nDATA binary\n'.encode())
        out.write(cloud.tobytes())


def isaac():
    """The Isaac Sim robots scripts/fetch-usd-fixtures.mjs downloaded; NVIDIA's license, so they stay out of the repo."""
    for robot in ['Unitree/G1', 'FrankaRobotics/FrankaPanda']:
        shutil.copytree(os.path.join(ROOT, 'usd/isaac/5.1/Isaac/Robots', robot), os.path.join(OUT, 'isaac', os.path.basename(robot)), dirs_exist_ok=True)


os.makedirs(os.path.join(OUT, 'perception'), exist_ok=True)
for step in [so101, bust, street, isaac]:
    step()
    print(step.__name__, 'done')
