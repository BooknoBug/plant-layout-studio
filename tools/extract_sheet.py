#!/usr/bin/env python3
"""Step 1 of the layout pipeline: DWG -> raw sheet JSON (all lines of one drawing sheet)

1. Convert the DWG to JSON with LibreDWG (0.13.3 was built from source; AC1032 / AutoCAD 2018 file):
       dwgread -O JSON -o plan.json AR-TO_R1....dwg
2. python3 tools/extract_sheet.py plan.json --box 6140 1354 6232 1426 --out source/pd2_floor2_raw.json
   -> every entity of model space whose position falls inside BOX
      (the floor-plan sheet "ผังพื้น 2"), blocks expanded, units metres, coordinates minus ORIGIN.
3. python3 tools/layouts/<layout>.py   -> layouts/<NAME>.layout.json (edits + metadata)
For another sheet or floor: pass that sheet's frame as --box (DWG units = metres). Origin = box lower-left.
Keep the same origin as an older layout of the same building if the design must stay aligned.
Notes: read the JSON as UTF-8 with errors='replace' (Thai text is correct that way, not cp874);
model-space entities are the ones WITHOUT 'ownerhandle'.
"""
import json, math, collections, re, sys, pathlib, argparse
ap_ = argparse.ArgumentParser()
ap_.add_argument('dwg_json'); ap_.add_argument('--box', nargs=4, type=float, default=[6140,1354,6232,1426])
ap_.add_argument('--origin', nargs=2, type=float, default=None); ap_.add_argument('--out', default='sheet_raw.json')
A_ = ap_.parse_args(); src = A_.dwg_json
raw = open(src,'rb').read().decode('utf-8', errors='replace')
d = json.loads(raw, strict=False)
O = d['OBJECTS']
lay = {o['handle'][2]: o.get('name','?') for o in O if o.get('object')=='LAYER'}
ms = [o for o in O if o.get('entity') and 'ownerhandle' not in o]
bh = {o['handle'][2]:o for o in O if o.get('object')=='BLOCK_HEADER'}
by_owner = collections.defaultdict(list)
for o in O:
    if o.get('entity') and 'ownerhandle' in o: by_owner[o['ownerhandle'][3]].append(o)
BOX=tuple(A_.box); OX,OY=(A_.origin or A_.box[:2])   # sheet frame in DWG units (m) and the origin used by the app
paths=collections.defaultdict(list); texts=[]
def mul(m,n):
    a,b,c,d_,tx,ty=m; A,B,C,D,TX,TY=n
    return (a*A+c*B, b*A+d_*B, a*C+c*D, b*C+d_*D, a*TX+c*TY+tx, b*TX+d_*TY+ty)
def ap(m,x,y): return (m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5])
def lname(e,inh):
    n=lay.get(e['layer'][3],'?')
    return inh if n=='0' and inh else n
def add(layer,pts,closed=False):
    if closed: pts=pts+[pts[0]]
    paths[layer].append([ (round(x-OX,2),round(y-OY,2)) for x,y in pts])
def arcpts(cx,cy,r,a0,a1,n=None):
    if a1<=a0: a1+=2*math.pi
    n=n or max(4,int((a1-a0)/(math.pi/18)))
    return [(cx+r*math.cos(a0+(a1-a0)*i/n),cy+r*math.sin(a0+(a1-a0)*i/n)) for i in range(n+1)]
def emit(e,m,inh,depth,top):
    t=e['entity']; L=lname(e,inh)
    if t=='LINE':
        pts=[ap(m,*e['start'][:2]),ap(m,*e['end'][:2])]
    elif t=='LWPOLYLINE':
        pts=[ap(m,*p[:2]) for p in e['points']]
        if len(pts)<2: return
        if top and not any(BOX[0]<=x<=BOX[2] and BOX[1]<=y<=BOX[3] for x,y in pts): return
        add(L,pts,bool(e.get('flag',0)&512)); return
    elif t=='ARC':
        c=e['center']; pts=[ap(m,x,y) for x,y in arcpts(c[0],c[1],e['radius'],e['start_angle'],e['end_angle'])]
    elif t=='CIRCLE':
        c=e['center']; pts=[ap(m,x,y) for x,y in arcpts(c[0],c[1],e['radius'],0,2*math.pi,24)]
    elif t=='ELLIPSE':
        try:
            c=e['center'];sm=e['sm_axis'];ra=e['axis_ratio'];a0=e.get('start_angle',0);a1=e.get('end_angle',2*math.pi)
            ang=math.atan2(sm[1],sm[0]);a=math.hypot(sm[0],sm[1]);b=a*ra
            if a1<=a0:a1+=2*math.pi
            pts=[]
            for i in range(25):
                th=a0+(a1-a0)*i/24
                x=a*math.cos(th);y=b*math.sin(th)
                pts.append(ap(m,c[0]+x*math.cos(ang)-y*math.sin(ang),c[1]+x*math.sin(ang)+y*math.cos(ang)))
        except Exception: return
    elif t in('TEXT','MTEXT'):
        p=e.get('ins_pt') or e.get('ins_pt') 
        s=e.get('text_value') if t=='TEXT' else e.get('text','')
        if not s or p is None: return
        x,y=ap(m,p[0],p[1])
        if top and not (BOX[0]<=x<=BOX[2] and BOX[1]<=y<=BOX[3]): return
        s=re.sub(r'\\[A-Za-z][^;]*;|[{}]','',s).replace('\\P',' ').strip()
        texts.append([L,s,round(x-OX,2),round(y-OY,2),round(e.get('height',e.get('text_height',0.2))*math.hypot(m[0],m[1]),2),round(e.get('rotation',0),3)]); return
    elif t=='INSERT':
        if depth>3: return
        bhdr=e['block_header'][3]; b=bh.get(bhdr)
        if not b: return
        sx,sy=(e.get('scale') or [1,1,1])[:2]; r=e.get('rotation',0); p=e['ins_pt']; bp=b.get('base_pt',[0,0,0])
        cs,sn=math.cos(r),math.sin(r)
        mi=(cs*sx,sn*sx,-sn*sy,cs*sy,p[0],p[1])
        mi=mul(mi,(1,0,0,1,-bp[0],-bp[1]))
        mm=mul(m,mi)
        if top:
            x,y=ap(m,p[0],p[1])
            if not (BOX[0]<=x<=BOX[2] and BOX[1]<=y<=BOX[3]): return
        for c in by_owner.get(bhdr,[]): emit(c,mm,L,depth+1,False)
        return
    else: return
    if top and not any(BOX[0]<=x<=BOX[2] and BOX[1]<=y<=BOX[3] for x,y in pts): return
    add(L,pts)
I=(1,0,0,1,0,0)
for e in ms: emit(e,I,None,0,True)
tot=sum(len(v) for v in paths.values())
print('paths',tot,'layers',len(paths),'texts',len(texts))
out={'origin':[OX,OY],'bbox':[0,0,BOX[2]-OX,BOX[3]-OY],'paths':paths,'texts':texts}
s=json.dumps(out,ensure_ascii=False,separators=(',',':'))
pathlib.Path(A_.out).write_text(s, encoding='utf-8'); print(len(s)/1e6,'MB')
