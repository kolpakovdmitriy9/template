"""Road markings generated from the road geometry (used by export_dxf.py in --flat mode).

Everything is built in plan view (x east, z south, metres) and emitted as flat triangles:
  * zebra crossings on every approach to a junction,
  * turn arrows before bends and before T-junctions (painted in the right-hand lane, where the car drives),
  * a dashed centre line on wide roads.
Markings are clipped to the real road surface (union of the road contours), so nothing sticks out onto the pavement.
"""
import math
from shapely.geometry import LineString, Point, Polygon, MultiPolygon
from shapely.ops import unary_union, triangulate
from shapely.strtree import STRtree

STRIPE_W, STRIPE_GAP, ZEBRA_LEN = 0.5, 0.5, 3.0
LANE = lambda w: min(max(w * .25, .45), 2.2)          # same lane offset as the car (world.js)


def _unit(dx, dz):
    n = math.hypot(dx, dz) or 1.0
    return dx / n, dz / n


def _pt(line, s):
    s = max(0.0, min(line.length, s))
    p = line.interpolate(s)
    return p.x, p.y


def _tang(line, s, span=3.0):
    x0, z0 = _pt(line, s - span)
    x1, z1 = _pt(line, s + span)
    return _unit(x1 - x0, z1 - z0)


def _rect(cx, cz, t, n, along, across):
    """rectangle centred at (cx,cz): `along` metres along t, `across` metres along n"""
    a, b = along / 2, across / 2
    return Polygon([(cx - t[0] * a - n[0] * b, cz - t[1] * a - n[1] * b), (cx + t[0] * a - n[0] * b, cz + t[1] * a - n[1] * b),
                    (cx + t[0] * a + n[0] * b, cz + t[1] * a + n[1] * b), (cx - t[0] * a + n[0] * b, cz - t[1] * a + n[1] * b)])


def _local_to_world(coords, pos, t):
    """(u forward, v right) -> world. right of travel direction t=(tx,tz) in (x east, z south) is (-tz, tx)."""
    r = (-t[1], t[0])
    return [(pos[0] + t[0] * u + r[0] * v, pos[1] + t[1] * u + r[1] * v) for u, v in coords]


def _turn_arrow(pos, t, turn):
    """arrow painted at `pos`, travelling along t, that turns left (turn=-1) or right (turn=+1); returns a shapely geometry"""
    path = [(-1.3, 0.0), (0.2, 0.0)]
    R = 0.65
    for k in range(1, 9):                                   # quarter arc
        a = (math.pi / 2) * k / 8
        path.append((0.2 + R * math.sin(a), turn * R * (1 - math.cos(a))))
    end = path[-1]
    path.append((end[0] + .35, end[1] + turn * .35))
    # heading at the end of the path (45 deg off after the arc + diagonal tip): point the head along the last segment
    (u0, v0), (u1, v1) = path[-2], path[-1]
    hu, hv = _unit(u1 - u0, v1 - v0)
    body = LineString(path).buffer(.13, cap_style=2, join_style=1)
    tip = (u1 + hu * .62, v1 + hv * .62)
    nu, nv = -hv, hu
    head = Polygon([(u1 + nu * .42, v1 + nv * .42), tip, (u1 - nu * .42, v1 - nv * .42)])
    g = unary_union([body, head])
    return Polygon(_local_to_world(list(g.exterior.coords), pos, t)).buffer(0)


def _straight_arrow(pos, t):
    body = Polygon([(-1.2, -.13), (.55, -.13), (.55, .13), (-1.2, .13)])
    head = Polygon([(.45, -.42), (1.15, 0), (.45, .42)])
    g = unary_union([body, head])
    return Polygon(_local_to_world(list(g.exterior.coords), pos, t)).buffer(0)


def _tris(poly, out_pos, out_idx):
    """triangulate a (possibly non-convex) shapely polygon into the flat lists"""
    polys = list(poly.geoms) if isinstance(poly, MultiPolygon) else [poly]
    for pg in polys:
        if pg.is_empty or pg.area < 1e-4: continue
        if len(pg.exterior.coords) <= 5 and pg.convex_hull.area - pg.area < 1e-6:        # convex quad / triangle: simple fan
            pts = list(pg.exterior.coords)[:-1]
            base = len(out_pos) // 3
            for x, z in pts: out_pos += [round(x, 3), 0.0, round(z, 3)]
            for i in range(1, len(pts) - 1): out_idx += [base, base + i, base + i + 1]
            continue
        for tri in triangulate(pg):
            if not pg.buffer(1e-6).contains(tri.representative_point()): continue
            pts = list(tri.exterior.coords)[:-1]
            base = len(out_pos) // 3
            for x, z in pts: out_pos += [round(x, 3), 0.0, round(z, 3)]
            out_idx += [base, base + 1, base + 2]


def build(edges, surface_polys, log=print):
    """edges: [{'pts': [[x, y, z], ...], 'w': width}], surface_polys: road contour polygons in (x, z)"""
    surf = unary_union(surface_polys).buffer(0)
    surf_in = surf.buffer(-0.12)
    E = [(LineString([(p[0], p[2]) for p in e['pts']]), e['w']) for e in edges if e['w'] >= 2.9 and len(e['pts']) > 1]
    lines = [l for l, _ in E]
    tree = STRtree(lines)
    shapes = []                                                  # (kind, shapely geometry)

    # ---------- junctions: crossings, T-ends and shared nodes
    J = []
    for i, li in enumerate(lines):
        for j in tree.query(li.buffer(2.6)):
            j = int(j)
            if j <= i: continue
            lj = lines[j]
            if li.intersects(lj):
                g = li.intersection(lj)
                if g.geom_type == 'Point': J.append((g.x, g.y))
                elif g.geom_type == 'MultiPoint': J += [(p.x, p.y) for p in g.geoms]
                continue
            for a, b in ((li, lj), (lj, li)):                     # an end of `a` stops at (or very near) the side of `b`
                for ep in (Point(a.coords[0]), Point(a.coords[-1])):
                    if b.distance(ep) <= 2.6:
                        q = b.interpolate(b.project(ep)); J.append((q.x, q.y))
    centres = []
    for x, z in J:
        for c in centres:
            if math.hypot(c[0] - x, c[1] - z) < 9.0:
                c[2] += 1; c[0] += (x - c[0]) / c[2]; c[1] += (z - c[1]) / c[2]; break
        else: centres.append([x, z, 1])
    log("junctions:", len(centres))

    # ---------- zebra crossings on every approach
    placed = []
    def free(x, z, r=3.2):
        return all(math.hypot(x - px, z - pz) >= r for px, pz in placed)
    zebras = 0
    for cxj, czj, _ in centres:
        c = Point(cxj, czj)
        near = [(k, lines[k], E[k][1]) for k in range(len(lines)) if lines[k].distance(c) <= 7.0]
        if len(near) < 2: continue
        wmax = max(w for _, _, w in near)
        d = min(max(wmax / 2 + 2.2, 4.2), 9.0)
        for k, line, w in near:
            s0 = line.project(c)
            for sign in (+1, -1):
                s = s0 + sign * d
                if s < 3 or s > line.length - 3: continue
                if (sign > 0 and line.length - s0 < d + 6) or (sign < 0 and s0 < d + 6): continue
                px, pz = _pt(line, s)
                t = _tang(line, s); n = (-t[1], t[0])
                if not free(px, pz): continue
                placed.append((px, pz))
                span = w - 0.9
                nstripe = max(2, int(span // (STRIPE_W + STRIPE_GAP)) + 1)
                start = -(nstripe - 1) * (STRIPE_W + STRIPE_GAP) / 2
                ok = 0
                for m in range(nstripe):
                    a = start + m * (STRIPE_W + STRIPE_GAP)
                    stripe = _rect(px + n[0] * a, pz + n[1] * a, t, n, ZEBRA_LEN, STRIPE_W)
                    clipped = stripe.intersection(surf_in)
                    if clipped.is_empty or clipped.area < stripe.area * .6: continue
                    shapes.append(('zebra', clipped if clipped.area < stripe.area * .98 else stripe)); ok += 1
                if ok >= 2: zebras += 1
    log("zebra crossings:", zebras)

    # ---------- arrows: bends and T-ends
    arrows = 0
    zeb = list(placed)                                   # zebra centres: arrows keep clear of them
    placed_a = []
    def put_arrow(line, w, s, direction, kind):
        """paint an arrow on the lane of travel (direction=+1 along the line, -1 against it) at distance s along the line"""
        nonlocal arrows
        px, pz = _pt(line, s)
        t = _tang(line, s); t = (t[0] * direction, t[1] * direction)
        r = (-t[1], t[0]); off = LANE(w)
        pos = (px + r[0] * off, pz + r[1] * off)
        if any(math.hypot(gx - pos[0], gz - pos[1]) < 4.2 for gx, gz in zeb): return
        if any(math.hypot(gx - pos[0], gz - pos[1]) < 6.5 for gx, gz in placed_a): return
        geom = kind(pos, t)
        g = geom.intersection(surf_in)
        if g.is_empty or g.area < geom.area * .8: return
        placed_a.append(pos); shapes.append(('arrow', geom)); arrows += 1
    for ei, (line, w) in enumerate(E):
        L = line.length
        if L < 24: continue
        # bends: heading change over a +-6 m window
        step = 1.0; last = -99.0
        s = 8.0
        while s < L - 8:
            a0 = _tang(line, s - 6, 2.0); a1 = _tang(line, s + 6, 2.0)
            ang = math.degrees(math.atan2(a0[0] * a1[1] - a0[1] * a1[0], a0[0] * a1[0] + a0[1] * a1[1]))    # + = clockwise on the (x east, z south) plan = right turn
            if abs(ang) >= 38 and s - last > 14:
                turn = 1 if ang > 0 else -1
                for direction, ss in ((+1, s - 13), (-1, s + 13)):           # one arrow for each travel direction, before the bend
                    t_dir = turn if direction > 0 else -turn                 # coming from the other side the same bend turns the other way
                    if 4 < ss < L - 4:
                        put_arrow(line, w, ss, direction, lambda pos, t, tt=t_dir: _turn_arrow(pos, t, tt))
                last = s
                s += 10
            s += step
        # T-ends: the road finishes at another road -> a fork arrow (left + right) 13 m before it
        for end in (0, 1):
            ep = Point(line.coords[0] if end == 0 else line.coords[-1])
            if any(k != ei and lines[k].distance(ep) <= 2.6 for k in range(len(lines))):
                s = 13.0 if end == 0 else L - 13.0
                direction = -1 if end == 0 else +1                            # travelling towards the end
                put_arrow(line, w, s, direction, lambda pos, t: unary_union([_turn_arrow(pos, t, -1), _turn_arrow(pos, t, +1)]))
    log("arrows:", arrows)

    # ---------- dashed centre line on wide roads (>= 6 m)
    dashes = 0
    for (line, w) in E:
        if w < 6.0: continue
        s = 6.0
        while s < line.length - 6:
            px, pz = _pt(line, s + 1.0); t = _tang(line, s + 1.0); n = (-t[1], t[0])
            d = _rect(px, pz, t, n, 2.0, 0.16)
            g = d.intersection(surf_in)
            if not g.is_empty and g.area >= d.area * .9 and free(px, pz, 3.6):
                shapes.append(('dash', d)); dashes += 1
            s += 5.0
    log("dashes:", dashes)

    pos, idx = [], []
    for _, g in shapes:
        _tris(g, pos, idx)
    log("marking triangles:", len(idx) // 3)
    return {"pos": pos, "idx": idx}
