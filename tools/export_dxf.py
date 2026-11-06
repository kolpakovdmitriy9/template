"""Convert the topo DXF (binary, AC1024) into a compact scene.json for the web viewer.

usage: python3 -I tools/export_dxf.py [--flat] <in.dxf> <out.json>
Coordinates: DXF (x, y, z-up, metres) -> three.js (x, z, -y), re-centred on the map.
"""
import sys, json, math, collections
import numpy as np
import ezdxf

FLAT = "--flat" in sys.argv          # flat world: every surface at y=0, buildings sit on it, no hills / bumps
src, dst = [a for a in sys.argv[1:] if not a.startswith("--")][:2]
doc = ezdxf.readfile(src)
msp = doc.modelspace()

emin, emax = doc.header.get('$EXTMIN'), doc.header.get('$EXTMAX')
cx, cy = (emin[0] + emax[0]) / 2, (emin[1] + emax[1]) / 2   # map centre
z0 = 0.0 if emin[2] < 50 else float(round(emin[2]))         # base elevation

def tv(p):                      # DXF -> three
    return [round(p[0] - cx, 2), round(p[2] - z0, 2), round(-(p[1] - cy), 2)]

def mesh_data(entities, base=False):
    pos, idx = [], []
    for e in entities:
        base_i = len(pos) // 3
        verts = list(e.vertices)
        ymin = min((v[2] for v in verts), default=0)
        for v in verts:
            p = tv(v)
            if FLAT: p[1] = round(v[2] - ymin, 2) if base else 0.0       # buildings keep their height, standing on y=0
            pos += p
        for f in e.faces:
            f = list(f)
            for i in range(1, len(f) - 1):          # fan-triangulate
                idx += [base_i + f[0], base_i + f[i], base_i + f[i + 1]]
    return {"pos": pos, "idx": idx}

by = collections.defaultdict(list)
for e in msp:
    by[e.dxf.layer].append(e)

out = {
    "terrain": mesh_data(by["TPX_TERRAIN_TERRAIN_MESH"]),
    "buildings": mesh_data(by["TPX_BUILDINGS"], base=True),
    "roads": mesh_data(by["TPX_ROADS_HATCH"]),
    "water": mesh_data(by["TPX_WATERWAYS_HATCH"]),
    "green": mesh_data(by["TPX_VEGETATION_GREEN_SPACES_HATCH"]),
}


# --- drivable surface only (>= 6 m wide road hatches), used for ray casting / matching colour ---
def hatch_w(h, axis):
    V = np.array([tuple(v) for v in h.vertices]); t = 0.0
    for f in h.faces:
        i = [int(x) for x in f][:3]; p, q, r = V[i]; t += np.linalg.norm(np.cross(q - p, r - p)) / 2
    pts = [tuple(p) for p in axis.points()]
    L = sum(math.dist(p[:2], q[:2]) for p, q in zip(pts, pts[1:]))
    return (t / L) if L > 1 else 0.0
_axes = by["TPX_ROADS_AXES"]; _hatch = by["TPX_ROADS_HATCH"]
out["roadsDrive"] = mesh_data([h for h, a in zip(_hatch, _axes) if hatch_w(h, a) >= 6.0])

# --- sink the terrain under the river so it can never poke through the (draped) water mesh ---
wp = np.array(out["water"]["pos"]).reshape(-1, 3); wi = np.array(out["water"]["idx"]).reshape(-1, 3)
tp = np.array(out["terrain"]["pos"]).reshape(-1, 3)
A, B, C = wp[wi[:, 0]], wp[wi[:, 1]], wp[wi[:, 2]]
sunk = 0
for k, (x, y, z) in enumerate(tp):
    # barycentric test (x,z plane) against all water triangles
    d = (B[:, 2] - C[:, 2]) * (A[:, 0] - C[:, 0]) + (C[:, 0] - B[:, 0]) * (A[:, 2] - C[:, 2])
    ok = np.abs(d) > 1e-9
    l1 = ((B[:, 2] - C[:, 2]) * (x - C[:, 0]) + (C[:, 0] - B[:, 0]) * (z - C[:, 2])) / np.where(ok, d, 1)
    l2 = ((C[:, 2] - A[:, 2]) * (x - C[:, 0]) + (A[:, 0] - C[:, 0]) * (z - C[:, 2])) / np.where(ok, d, 1)
    l3 = 1 - l1 - l2
    hit = ok & (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
    if hit.any():
        j = np.argmax(hit); wy = l1[j] * A[j, 1] + l2[j] * B[j, 1] + l3[j] * C[j, 1]
        if y > wy - 0.4: tp[k, 1] = round(wy - 0.4, 2); sunk += 1
out["terrain"]["pos"] = tp.ravel().round(2).tolist()
print("terrain vertices sunk under water:", sunk)

# trees: position + trunk/crown size from the block geometry
trees = []
cache = {}
for e in by["TPX_VEGETATION_TREES_INDIVIDUAL"]:
    n = e.dxf.name
    if n not in cache:
        ms = list(doc.blocks[n])
        trunk, crown = ms[0], ms[1]
        tvv = np.array(list(trunk.vertices)); cvv = np.array(list(crown.vertices))
        if cvv[:, 2].max() < tvv[:, 2].max():
            trunk, crown, tvv, cvv = crown, trunk, cvv, tvv
        cache[n] = [round(float(cvv[:, 0].max()), 2), round(float(cvv[:, 2].min()), 2),
                    round(float(cvv[:, 2].max()), 2), round(float(tvv[:, 0].max()), 2),
                    round(float(tvv[:, 2].min()), 2), round(float(tvv[:, 2].max()), 2)]
    i = e.dxf.insert
    trees.append([round(i[0] - cx, 2), 0.0 if FLAT else round(i[2] - z0, 2), round(-(i[1] - cy), 2)] + cache[n])
out["trees"] = trees   # x,y,z, crownR, crownZ0, crownZ1, trunkR, trunkZ0, trunkZ1

# road graph from axes
axes = [[tuple(p) for p in e.points()] for e in by["TPX_ROADS_AXES"]]
cont = np.array([p[:2] for e in by["TPX_ROADS_CONTOURS"] for p in map(tuple, e.points())])
# densify contour edges so the half-width estimate is accurate
segs = []
for e in by["TPX_ROADS_CONTOURS"]:
    pts = [tuple(p)[:2] for p in e.points()]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        segs.append((a, b))
sa = np.array([s[0] for s in segs]); sb = np.array([s[1] for s in segs])
def dist_to_contour(p):
    p = np.array(p[:2]); ab = sb - sa
    t = np.clip(((p - sa) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    proj = sa + ab * t[:, None]
    return float(np.hypot(*(proj - p).T).min())
widths = [2 * dist_to_contour(p) for a in axes for p in a]
# robust width: road hatch area / axis length (median of point distances is skewed by junctions)
area = 0.0
hp = np.array(out["roads"]["pos"]).reshape(-1, 3); hi = np.array(out["roads"]["idx"]).reshape(-1, 3)
a_, b_, c_ = hp[hi[:, 0]], hp[hi[:, 1]], hp[hi[:, 2]]
area = float(np.linalg.norm(np.cross(b_ - a_, c_ - a_), axis=1).sum() / 2)
axis_len = sum(math.dist(p, q) for a in axes for p, q in zip(a, a[1:]))
road_w = area / axis_len
print("road width median %.2f m (p10 %.2f p90 %.2f)" % (road_w, np.percentile(widths, 10), np.percentile(widths, 90)))

# merge endpoints into nodes (3 m tolerance)
nodes = []
def node_id(p):
    for i, q in enumerate(nodes):
        if math.dist(p[:2], q[:2]) < 3.0: return i
    nodes.append(p); return len(nodes) - 1
hatches = by["TPX_ROADS_HATCH"]
assert len(hatches) == len(axes)
def hatch_area(h):
    V = np.array([tuple(v) for v in h.vertices]); t = 0.0
    for f in h.faces:
        i = [int(x) for x in f][:3]; p, q, r = V[i]; t += np.linalg.norm(np.cross(q - p, r - p)) / 2
    return t
edges = []
for a, h in zip(axes, hatches):
    L = sum(math.dist(p[:2], q[:2]) for p, q in zip(a, a[1:]))
    w = hatch_area(h) / L if L > 1 else 0
    edges.append({"a": node_id(a[0]), "b": node_id(a[-1]), "w": round(w, 1), "pts": [([q[0], 0.0, q[2]] if FLAT else q) for q in (tv(p) for p in a)]})
print("edge widths (m):", sorted({e["w"] for e in edges}, reverse=True)[:8], "...")
try:
    from shapely.geometry import Polygon, LineString
    from shapely.ops import unary_union
    water = unary_union([Polygon([tuple(p)[:2] for p in e.points()]).buffer(0) for e in by["TPX_WATERWAYS_OUTLINE"]])
    for e, a in zip(edges, axes):
        inter = LineString([p[:2] for p in a]).intersection(water) if len(a) > 1 else None
        e["br"] = round(inter.length) if inter is not None else 0
        if e["br"] > 3:                      # mid-point of the part over water, in scene coords
            c = inter.centroid; e["bp"] = [round(c.x - cx, 1), round(-(c.y - cy), 1)]
except ImportError:
    pass
edges = [e for e in edges if e["w"] >= 2.5]
out["roadGraph"] = {"width": round(road_w, 2), "edges": edges}

# road markings (flat world only): zebra crossings, turn arrows, dashed centre lines - see tools/markings.py
if FLAT:
    import os as _os
    sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
    import markings
    from shapely.geometry import Polygon as _Poly
    _surf = []
    for c in by["TPX_ROADS_CONTOURS"]:
        q = [tv(p) for p in c.points()]
        if len(q) >= 3: _surf.append(_Poly([(a[0], a[2]) for a in q]).buffer(0))
    out["markings"] = markings.build(edges, _surf)

# bounds
allp = np.array(out["terrain"]["pos"]).reshape(-1, 3)
out["bounds"] = {"min": allp.min(0).round(1).tolist(), "max": allp.max(0).round(1).tolist()}

json.dump(out, open(dst, "w"), separators=(",", ":"))
import os; print("wrote", dst, os.path.getsize(dst) // 1024, "KB; trees", len(trees))
