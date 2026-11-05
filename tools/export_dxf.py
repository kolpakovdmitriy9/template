"""Convert the topo DXF (binary, AC1024) into a compact scene.json for the web viewer.

usage: python3 -I tools/export_dxf.py <in.dxf> <out.json>
Coordinates: DXF (x, y, z-up, metres) -> three.js (x, z, -y), re-centred on the map.
"""
import sys, json, math, collections
import numpy as np
import ezdxf

src, dst = sys.argv[1], sys.argv[2]
doc = ezdxf.readfile(src)
msp = doc.modelspace()

cx, cy = 160.0, 340.0          # approx map centre (EXT is 0..320 x 0..681)
z0 = 130.0                      # base elevation

def tv(p):                      # DXF -> three
    return [round(p[0] - cx, 2), round(p[2] - z0, 2), round(-(p[1] - cy), 2)]

def mesh_data(entities):
    pos, idx = [], []
    for e in entities:
        base = len(pos) // 3
        for v in e.vertices:
            pos += tv(v)
        for f in e.faces:
            f = list(f)
            for i in range(1, len(f) - 1):          # fan-triangulate
                idx += [base + f[0], base + f[i], base + f[i + 1]]
    return {"pos": pos, "idx": idx}

by = collections.defaultdict(list)
for e in msp:
    by[e.dxf.layer].append(e)

out = {
    "terrain": mesh_data(by["TPX_TERRAIN_TERRAIN_MESH"]),
    "buildings": mesh_data(by["TPX_BUILDINGS"]),
    "roads": mesh_data(by["TPX_ROADS_HATCH"]),
    "water": mesh_data(by["TPX_WATERWAYS_HATCH"]),
    "green": mesh_data(by["TPX_VEGETATION_GREEN_SPACES_HATCH"]),
}

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
    trees.append([round(i[0] - cx, 2), round(i[2] - z0, 2), round(-(i[1] - cy), 2)] + cache[n])
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
edges = []
for a in axes:
    edges.append({"a": node_id(a[0]), "b": node_id(a[-1]), "pts": [tv(p) for p in a]})
# keep the biggest connected component by length
parent = list(range(len(nodes)))
def f(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
for e in edges: parent[f(e["a"])] = f(e["b"])
length = collections.Counter()
for e in edges: length[f(e["a"])] += sum(math.dist(p, q) for p, q in zip(e["pts"], e["pts"][1:]))
main = length.most_common(1)[0][0]
edges = [e for e in edges if f(e["a"]) == main]
print("road edges in main network:", len(edges), "of", len(axes), "length %.0f m" % length[main])
out["roadGraph"] = {"width": round(road_w, 2), "edges": edges}

# bounds
allp = np.array(out["terrain"]["pos"]).reshape(-1, 3)
out["bounds"] = {"min": allp.min(0).round(1).tolist(), "max": allp.max(0).round(1).tolist()}

json.dump(out, open(dst, "w"), separators=(",", ":"))
import os; print("wrote", dst, os.path.getsize(dst) // 1024, "KB; trees", len(trees))
