#!/usr/bin/env python3
"""Layout recipe: PD2 building, 2nd floor (left half)  ->  layouts/PD2-floor2.layout.json
Copy this file as the template for a new layout (new floor / new architect revision).

Input: the raw sheet "ผังพื้น 2" cut out of AR-TO_R1...dwg by tools/extract_sheet.py
       (default path source/pd2_floor2_raw.json — not in git: company drawing).
Edits agreed with the user (Nov 2026):
  1. keep only the left half of the building (cut at x = 49.6 m; grid-axis lines kept to 53.0 m)
  2. move the 1 m floor-tile lines of the main hall out of layer 'AR WALL' into layer 'TILE-GRID'
     (so doors do not snap to tile lines)
  3. add 1 m tile grid to the left bay (around the lift and stair), the top-left and bottom-left
     corner rooms (from column line x = 6.37 to the corner wall) and the two narrow strips
     between the corner rooms and the hall, as on the user's printed plan.
Coordinates are metres from the sheet origin (DWG 6140, 1354). Tile lattice: x = n + 0.37, y = n + 0.09.
Run:  python3 tools/layouts/pd2_floor2.py [raw.json] [out.layout.json]
Give the user the .layout.json file; they open it in the app (tab แบบพื้นหลัง). Bump LAYOUT_ID for a new revision.
"""
import json, pathlib, sys, datetime
R = pathlib.Path(__file__).resolve().parent.parent.parent
RAW = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else R/'source/pd2_floor2_raw.json'
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else R/'layouts/PD2-floor2.layout.json'
LAYOUT_ID = 'pd2-floor2-r1'          # change (r2, r3 ...) when the architect issues a new revision
META = {
  'name': 'อาคาร PD2 ชั้น 2 (ครึ่งซ้าย) · AR-TO R1',
  'floor': '2', 'building': 'PD2', 'source': 'AR-TO_R1 (DWG) แผ่น “ผังพื้น 2”',
  'note': 'ตัดอาคารครึ่งขวาออก · ตาราง 1 ม. ตามแบบพิมพ์ของผู้ใช้ (26 พ.ย. 2026)',
  'units': 'm',
  'wallLayers': ['AR-WALL','AR WALL','$0$AR-WALL','wall-1','AR-SYMBOL WALL','A-Wall','WALL','hat-wall'],
  'defaultVisible': ['AR-WALL','AR WALL','$0$AR-WALL','wall-1','AR-SYMBOL WALL','A-Wall','WALL','COL','01COL','AR-DOOR','ST','AR-WINDOWS','AR-GRID LINES','AR-LIFT-COR','AR-DOOR&WINDOW','door','AR-SANITARY FUR','AR-FUR_WC','TILE-GRID'],
  'demoBox': [13.6, 17.0, 48.8, 59.8],      # interior of the main hall, used by "ใส่ตัวอย่าง"
}
d = json.loads(RAW.read_text(encoding='utf-8'))
P = d['paths']
XCUT, XCUT_AXES = 49.6, 53.0
r = lambda v: round(v, 2)

def clip_path(path, xmax):
    out, cur = [], []
    for a, b in zip(path, path[1:]):
        ina, inb = a[0] <= xmax, b[0] <= xmax
        if ina and inb:
            if not cur: cur = [list(a)]
            cur.append(list(b))
        elif ina or inb:
            t = (xmax - a[0]) / (b[0] - a[0]); m = [xmax, round(a[1] + t*(b[1]-a[1]), 2)]
            if ina:
                if not cur: cur = [list(a)]
                cur.append(m); out.append(cur); cur = []
            else:
                cur = [m, list(b)]
        else:
            if cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return [c for c in out if len(c) >= 2]

new, tile = {}, []
for k, v in P.items():
    xm = XCUT_AXES if k == 'AR-GRID LINES' else XCUT
    for p in v:
        if k == 'AR WALL' and len(p) == 2:            # hall tile lines (36 m horizontals / 44 m verticals)
            a, b = p; l = abs(a[0]-b[0]) + abs(a[1]-b[1])
            if abs(a[1]-b[1]) < 1e-3 and 35 < l < 37 and abs(min(a[0], b[0]) - 13.37) < 0.01: tile.append(p); continue
            if abs(a[0]-b[0]) < 1e-3 and 43 < l < 45 and 14 < a[0] < 49: tile.append(p); continue
        for c in clip_path(p, xm): new.setdefault(k, []).append(c)
grid = [[[r(q[0]), r(q[1])] for q in p] for p in tile]

# --- left bay: x 6.57-13.17, y 22.29-53.89, minus lift and stair footprints ---
EX = [(9.9, 33.9, 13.2, 38.4), (10.6, 38.4, 13.2, 44.3)]   # (x0, y0, x1, y1)
def minus_ex(a, b):
    segs = [(a, b)]
    for (x0, y0, x1, y1) in EX:
        out = []
        for p, q in segs:
            if abs(p[1]-q[1]) < 1e-6 and y0 < p[1] < y1:          # horizontal through the box
                lo, hi = min(p[0], q[0]), max(p[0], q[0])
                if lo < x0: out.append(([lo, p[1]], [min(hi, x0), p[1]]))
                if hi > x1: out.append(([max(lo, x1), p[1]], [hi, p[1]]))
                if hi <= x0 or lo >= x1: out.append((p, q))
                continue
            if abs(p[0]-q[0]) < 1e-6 and x0 < p[0] < x1:          # vertical through the box
                lo, hi = min(p[1], q[1]), max(p[1], q[1])
                if lo < y0: out.append(([p[0], lo], [p[0], min(hi, y0)]))
                if hi > y1: out.append(([p[0], max(lo, y1)], [p[0], hi]))
                continue
            out.append((p, q))
        segs = out
    return [[list(p), list(q)] for p, q in segs if abs(p[0]-q[0]) + abs(p[1]-q[1]) > 0.05]
for k in range(23, 54): grid += minus_ex([6.57, r(k+0.09)], [13.17, r(k+0.09)])
for x in [7.37, 8.37, 9.37, 10.37, 11.37, 12.37]: grid += minus_ex([x, 22.29], [x, 53.89])

# --- corner rooms (column line x 6.37 to corner wall 11.42) and the narrow strips (x 11.82-13.17) ---
for (y0, y1) in [(54.59, 60.09), (16.09, 21.59)]:
    for x in [6.37, 7.37, 8.37, 9.37, 10.37, 11.37]: grid.append([[x, y0], [x, y1]])
    for k in range(int(y0)+1, int(y1)+1):
        y = r(k+0.09)
        if y0 <= y <= y1: grid.append([[6.37, y], [11.42, y]])
for y in [55.09, 56.09, 57.09, 58.09, 59.09, 17.09, 18.09, 19.09, 20.09, 21.09]: grid.append([[11.82, y], [13.17, y]])
grid.append([[12.37, 54.29], [12.37, 60.09]]); grid.append([[12.37, 16.09], [12.37, 21.89]])

new['TILE-GRID'] = grid
texts = [t for t in d['texts'] if t[2] <= XCUT]
out = {'format': 'pls-layout', 'v': 1, 'id': LAYOUT_ID, **META, 'created': datetime.date.today().isoformat(),
       'origin': d['origin'], 'bbox': [0, 0, XCUT_AXES, d['bbox'][3]], 'paths': new, 'texts': texts}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('wrote', OUT)
print('layers', len(new), 'paths', sum(len(v) for v in new.values()), 'tile lines', len(grid), 'texts', len(texts))
