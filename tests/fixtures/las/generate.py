"""Writes the LAS / LAZ fixtures and laspy's reading of them (expected.json) for tests/mesh-splat/las.test.mjs.
Usage: python3 -m venv /tmp/las && /tmp/las/bin/pip install laspy==2.7.0 lazrs==0.9.0 && /tmp/las/bin/python tests/fixtures/las/generate.py
"""
import json, os
import laspy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WKT = 'PROJCS["NAD83 / UTM zone 15N",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-93],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],UNIT["metre",1],AUTHORITY["EPSG","26915"]]'


def cloud(fmt, version, count, seed, extra=False):
    rng = np.random.default_rng(seed)
    header = laspy.LasHeader(point_format=fmt, version=version)
    if extra:
        header.add_extra_dim(laspy.ExtraBytesParams(name='range', type=np.float32))
    header.scales = [0.001, 0.001, 0.001]
    header.offsets = [500000, 4000000, 0]
    las = laspy.LasData(header)
    i = np.arange(count)
    r, a = np.sqrt((i + 0.5) / count) * 20, i * 2.399
    las.x = 500123.456 + r * np.cos(a)
    las.y = 4000456.789 + r * np.sin(a)
    las.z = 250 + rng.uniform(0, 30, count)
    las.intensity = rng.integers(0, 65535, count)
    las.return_number = rng.integers(1, 6 if fmt < 6 else 15, count)
    las.classification = rng.integers(0, 31 if fmt < 6 else 255, count)
    las.point_source_id = rng.integers(0, 65535, count)
    if 'gps_time' in las.point_format.dimension_names:
        las.gps_time = 1.3e9 + np.sort(rng.uniform(0, 600, count))
    if 'red' in las.point_format.dimension_names:
        for channel in ['red', 'green', 'blue']:
            las[channel] = rng.integers(0, 65535, count)
    if extra:
        las['range'] = rng.uniform(0, 100, count).astype(np.float32)
    return las


def disc(count):
    """A red disc at UTM coordinates, the e2e's LAZ."""
    header = laspy.LasHeader(point_format=3, version='1.2')
    header.scales, header.offsets = [0.001] * 3, [500000, 4000000, 0]
    las = laspy.LasData(header)
    i = np.arange(count)
    r, a = np.sqrt(i / count), i * 2.399
    las.x, las.y, las.z = 500000 + r * np.cos(a), 4000000 + r * np.sin(a), np.zeros(count) + 120
    las.red, las.green, las.blue = np.full(count, 65535), np.zeros(count), np.zeros(count)
    las.classification = i % 7
    las.intensity = i
    return las


def main():
    files = {}
    for fmt, version in [(0, '1.2'), (1, '1.2'), (2, '1.2'), (3, '1.2'), (4, '1.3'), (5, '1.3'), (6, '1.4'), (7, '1.4'), (8, '1.4'), (9, '1.4'), (10, '1.4')]:
        files[f'f{fmt}-{version}.las'] = cloud(fmt, version, 24, fmt)
    files['f6-extra.las'] = cloud(6, '1.4', 24, 60, extra=True)
    wkt = cloud(7, '1.4', 24, 70)
    wkt.header.global_encoding.wkt = True
    wkt.header.vlrs.append(laspy.vlrs.known.WktCoordinateSystemVlr(WKT))
    files['f7-wkt.las'] = wkt
    geotiff = cloud(3, '1.2', 24, 30)
    keys = np.array([1, 1, 0, 3, 1024, 0, 1, 1, 3072, 0, 1, 26915, 3073, 34737, 21, 0], dtype='<u2').tobytes()
    geotiff.header.vlrs.append(laspy.VLR('LASF_Projection', 34735, record_data=keys))
    geotiff.header.vlrs.append(laspy.VLR('LASF_Projection', 34737, record_data=b'NAD83 / UTM zone 15N|\0'))
    files['f3-geotiff.las'] = geotiff
    expected = {}
    for name, las in files.items():
        las.write(os.path.join(HERE, name))
        if name in ['f3-1.2.las', 'f7-1.4.las']:
            las.write(os.path.join(HERE, name.replace('.las', '.laz')), laz_backend=laspy.LazBackend.Lazrs)
        back = laspy.read(os.path.join(HERE, name))
        dims = list(back.point_format.dimension_names)
        values = lambda dim: np.asarray(back[dim]).tolist()
        expected[name] = {
            'version': str(back.header.version), 'format': back.header.point_format.id, 'count': int(back.header.point_count),
            **{dim: values(dim) for dim in ['x', 'y', 'z', 'intensity', 'classification', 'return_number', 'point_source_id', 'gps_time'] if dim in dims + ['x', 'y', 'z']},
            **({'rgb': np.stack([np.asarray(back[c]) for c in ['red', 'green', 'blue']], 1).ravel().tolist()} if 'red' in dims else {}),
        }
    # Waveform formats have no LAZ compressor in laz-perf, so the viewer must say so.
    cloud(9, '1.4', 24, 9).write(os.path.join(HERE, 'f9-1.4.laz'), laz_backend=laspy.LazBackend.Lazrs)
    disc(2000).write(os.path.join(HERE, 'utm-disc.laz'), laz_backend=laspy.LazBackend.Lazrs)
    with open(os.path.join(HERE, 'expected.json'), 'w') as out:
        json.dump(expected, out, separators=(',', ':'))


main()
