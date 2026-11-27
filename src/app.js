'use strict';
/* ====================== helpers ====================== */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const r2=v=>Math.round(v*100)/100;
const fmt=(v,n=2)=>(+v).toFixed(n);

/* ====================== state ====================== */
const S={rooms:[],machines:[],doors:[],flows:[],dims:[],bgHidden:[],bgErase:[],cfg:{minAisle:1.2,minDP:5,wallH:3.5,colorBy:'pa',groupMove:true,ach:{...ACH_DEF},spec:{...SPEC_DEF}}};
let nextId=1;
const U={paths:{},texts:[],origin:[0,0],loaded:false,vis:{},alpha:1,showText:false,p2d:{},cnt:{},bb:{},keys:{},hidden:new Set(),
  id:null,name:'',meta:null,raw:null,wallL:WALL_LAYERS,snapL:SNAP_LAYERS,defVis:DEF_VIS};
const T={tool:'select',lib:LIB[0],door:DOORS[0],snap:true,sel:null,tab:'props',view:'2d',poly:[],pend:null,meas:[],hover:null,checks:[],pairs:[],
  rtype:'process',flow:FLOWS[0],fpts:[],dpts:[],bgLock:true,bgMode:'tap',bgTile:false,bgHover:null,bgBox:null};
const V={s:8,tx:0,ty:0,w:100,h:100,dpr:1};
const undo=[],redo=[];
let snapIdx=new Map(),wallSegs=[];

/* ====================== history & autosave ====================== */
const snapState=()=>JSON.stringify({rooms:S.rooms,machines:S.machines,doors:S.doors,flows:S.flows,dims:S.dims,bgHidden:S.bgHidden,bgErase:S.bgErase,cfg:S.cfg,nextId});
/* project file format. Bump PROJECT_FORMAT when the saved structure changes and add a step in migrateProject,
   so drafts and .json files from older versions still open. */
const PROJECT_FORMAT=4;
function migrateProject(o){
  o=o||{};const v=+o.v||1;
  if(v<2){o.flows=o.flows||[];o.dims=o.dims||[];o.bgHidden=o.bgHidden||[]}
  /* v3 adds layoutRef {id,name,origin} and, in files, the whole layout (o.layout) — nothing to convert */
  /* v4 adds bgErase: rectangles [x0,y0,x1,y1] where background lines are cut away (eraser) */
  if(v<4){o.bgErase=o.bgErase||[]}
  /* if(v<5){ ...next change... } */
  return o}
function applyProj(o){
  o=migrateProject(o);
  S.rooms=o.rooms||[];S.machines=o.machines||[];S.doors=o.doors||[];S.flows=o.flows||[];S.dims=o.dims||[];
  const before=JSON.stringify([S.bgHidden,S.bgErase]);S.bgHidden=Array.isArray(o.bgHidden)?o.bgHidden:[];S.bgErase=Array.isArray(o.bgErase)?o.bgErase:[];
  const c=o.cfg||{};Object.assign(S.cfg,c);S.cfg.ach=Object.assign({...ACH_DEF},c.ach||{});S.cfg.spec=Object.assign({...SPEC_DEF},c.spec||{});
  if(U.loaded&&before!==JSON.stringify([S.bgHidden,S.bgErase]))rebuildUnderlay()}
/* HIST: hooks filled in by collab.js when the page runs as a shared Claude artifact (several people editing).
   There undo works per person on what that person changed, instead of restoring whole snapshots. */
const HIST={};
function commit(){if(HIST.commit)HIST.commit();undo.push(snapState());if(undo.length>80)undo.shift();redo.length=0;updHist()}
function restore(js){const o=JSON.parse(js);applyProj(o);nextId=o.nextId||nextId;T.sel=null;changed(true)}
function doUndo(){if(HIST.undo){HIST.undo();return}if(!undo.length)return;redo.push(snapState());restore(undo.pop());updHist()}
function doRedo(){if(HIST.redo){HIST.redo();return}if(!redo.length)return;undo.push(snapState());restore(redo.pop());updHist()}
/* throw away the step just started (cancel a drag) */
function revertLast(){if(HIST.revert){HIST.revert();return}restore(undo.pop());updHist()}
function updHist(){if(HIST.sync)HIST.sync();$('#undo').disabled=!undo.length;$('#redo').disabled=!redo.length}
let saveT=0;
function autosave(){clearTimeout(saveT);saveT=setTimeout(()=>{try{localStorage.setItem('pls-project-v1',snapState())}catch(e){}},400)}
function loadAuto(){try{const j=localStorage.getItem('pls-project-v1');if(j){const o=JSON.parse(j);if(o&&o.rooms){applyProj(o);nextId=o.nextId||1;return true}}}catch(e){}return false}

/* ====================== geometry ====================== */
function polyArea(p){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1]}return a/2}
function centroid(p){let a=0,cx=0,cy=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length],f=p[i][0]*q[1]-q[0]*p[i][1];a+=f;cx+=(p[i][0]+q[0])*f;cy+=(p[i][1]+q[1])*f}if(Math.abs(a)<1e-9){return[p[0][0],p[0][1]]}return[cx/(3*a),cy/(3*a)]}
function pip(p,x,y){let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=clamp(t,0,1);const cx=ax+t*dx,cy=ay+t*dy;return[Math.hypot(px-cx,py-cy),cx,cy,t]}
function segInter(a,b,c,d){const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);const d1=o(a,b,c),d2=o(a,b,d),d3=o(c,d,a),d4=o(c,d,b);return((d1>1e-9&&d2<-1e-9)||(d1<-1e-9&&d2>1e-9))&&((d3>1e-9&&d4<-1e-9)||(d3<-1e-9&&d4>1e-9))}
function polyDist(A,B){
  for(const v of A)if(pip(B,v[0],v[1]))return{d:0,p:v,q:v,ov:true};
  for(const v of B)if(pip(A,v[0],v[1]))return{d:0,p:v,q:v,ov:true};
  for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++)if(segInter(A[i],A[(i+1)%A.length],B[j],B[(j+1)%B.length]))return{d:0,p:A[i],q:A[i],ov:true};
  let best={d:1e9};
  const scan=(P,Q,sw)=>{for(const v of P)for(let j=0;j<Q.length;j++){const w=Q[(j+1)%Q.length],r=segDist(v[0],v[1],Q[j][0],Q[j][1],w[0],w[1]);if(r[0]<best.d)best={d:r[0],p:sw?[r[1],r[2]]:v,q:sw?v:[r[1],r[2]]}}};
  scan(A,B,false);scan(B,A,true);return best}
function machinePoly(m,exp=0){const hw=m.w/2+exp,hd=m.d/2+exp,a=(m.rot||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([x,y])=>[m.x+x*c-y*s,m.y+x*s+y*c])}
function roomsOverlap(A,B){
  const ca=centroid(A.pts),cb=centroid(B.pts);
  const nud=(v,c)=>[v[0]+(c[0]-v[0])*0.02,v[1]+(c[1]-v[1])*0.02];
  for(const v of A.pts){const q=nud(v,ca);if(pip(B.pts,q[0],q[1]))return true}
  for(const v of B.pts){const q=nud(v,cb);if(pip(A.pts,q[0],q[1]))return true}
  for(let i=0;i<A.pts.length;i++)for(let j=0;j<B.pts.length;j++)if(segInter(A.pts[i],A.pts[(i+1)%A.pts.length],B.pts[j],B.pts[(j+1)%B.pts.length]))return true;
  return false}
function roomAt(x,y){let best=null,ba=1e12;for(const r of S.rooms)if(pip(r.pts,x,y)){const a=Math.abs(polyArea(r.pts));if(a<ba){ba=a;best=r}}return best}
function doorGeom(d){
  const a=d.ang,u=[Math.cos(a),Math.sin(a)],n=[-Math.sin(a),Math.cos(a)],h=d.w/2,hs=d.hinge||1,sd=d.side||1;
  if(d.dbl){const h1=[d.x-u[0]*h,d.y-u[1]*h],h2=[d.x+u[0]*h,d.y+u[1]*h];
    return{dbl:true,leaves:[{hinge:h1,closed:[d.x,d.y],open:[h1[0]+n[0]*sd*h,h1[1]+n[1]*sd*h],r:h},{hinge:h2,closed:[d.x,d.y],open:[h2[0]+n[0]*sd*h,h2[1]+n[1]*sd*h],r:h}],u,n,ends:[h1,h2]}}
  const hg=[d.x-u[0]*h*hs,d.y-u[1]*h*hs],cl=[hg[0]+u[0]*d.w*hs,hg[1]+u[1]*d.w*hs];
  return{dbl:false,leaves:[{hinge:hg,closed:cl,open:[hg[0]+n[0]*sd*d.w,hg[1]+n[1]*sd*d.w],r:d.w}],u,n,ends:[hg,cl]}}

/* ====================== colors ====================== */
function paColor(pa){if(pa<0)return'#e8590c';if(pa===0)return'#7a8594';if(pa<=15)return'#0c8f82';if(pa<=30)return'#3b5bdb';return'#9c36b5'}
function roomColor(r){return S.cfg.colorBy==='grade'?(GCOL[r.grade]||'#868e96'):paColor(+r.pa||0)}
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ====================== underlay ====================== */
function prepUnderlay(d){
  U.paths=d.paths;U.texts=d.texts||[];U.origin=d.origin||[0,0];U.loaded=true;
  U.p2d={};U.cnt={};U.bb={};U.keys={};U.vis={};
  U.id=d.id||null;U.name=d.name||'แบบพื้นหลัง';U.meta=d;U.raw=d;
  /* a layout file may name its own wall / snap / visible layers (a new DWG can use other layer names) */
  U.wallL=d.wallLayers||WALL_LAYERS;U.snapL=d.snapLayers||[...U.wallL,'COL','01COL','AR-LIFT-COR','ST'];U.defVis=d.defaultVisible||DEF_VIS;
  for(const k of Object.keys(U.paths)){
    U.bb[k]=U.paths[k].map(p=>{let a=1e9,b=1e9,c=-1e9,e=-1e9;for(const v of p){if(v[0]<a)a=v[0];if(v[1]<b)b=v[1];if(v[0]>c)c=v[0];if(v[1]>e)e=v[1]}return[a,b,c,e]});
    U.keys[k]=U.paths[k].map(p=>{const a=p[0],b=p[p.length-1];return k+'@'+[a[0],a[1],b[0],b[1]].map(v=>(+v).toFixed(2)).join(',')+','+p.length});
    U.vis[k]=U.defVis.includes(k)}
  if(!Object.values(U.vis).some(Boolean))for(const k in U.vis)U.vis[k]=true;
  U.grid=inferGrid(d);
  rebuildUnderlay();
}
/* background lines are never part of the design: they can only be hidden (erased) in the "แก้พื้นหลัง" tool, and the list of hidden lines is saved with the project */
function rebuildUnderlay(){
  /* older projects stored "layer#index"; convert them to geometry keys */
  S.bgHidden=[...new Set(S.bgHidden.map(x=>{const m=/^(.*)#(\d+)$/.exec(x);return m&&U.keys[m[1]]&&U.keys[m[1]][+m[2]]?U.keys[m[1]][+m[2]]:x}))];
  const H=new Set(S.bgHidden);U.hidden=H;S.bgErase=S.bgErase||[];
  U.clip={};const E=S.bgErase;
  for(const k of Object.keys(U.paths)){
    const p=new Path2D();let n=0;U.clip[k]=[];
    U.paths[k].forEach((path,i)=>{if(path.length<2||H.has(U.keys[k][i]))return;
      /* the 1 m tile grid is never erased; other lines lose the parts inside eraser rectangles */
      const b=U.bb[k][i],hit=k==='TILE-GRID'?[]:E.filter(e=>b[0]<=e[2]&&b[2]>=e[0]&&b[1]<=e[3]&&b[3]>=e[1]);
      const pcs=hit.length?clipPath(path,hit):[path];if(hit.length)U.clip[k][i]=pcs;
      for(const q of pcs){if(q.length<2)continue;p.moveTo(q[0][0],q[0][1]);for(let j=1;j<q.length;j++)p.lineTo(q[j][0],q[j][1])}if(pcs.length)n++});
    U.p2d[k]=p;U.cnt[k]=n}
  buildSnap();
}
/* the visible pieces of background path i of layer k (after the eraser) */
const pieces=(k,i)=>(U.clip&&U.clip[k]&&U.clip[k][i])||[U.paths[k][i]];
/* segment a-b minus rectangle e: 0, 1 or 2 pieces (Liang-Barsky) */
function cutSeg(a,b,e){const dx=b[0]-a[0],dy=b[1]-a[1];let t0=0,t1=1;
  const P=[-dx,dx,-dy,dy],Q=[a[0]-e[0],e[2]-a[0],a[1]-e[1],e[3]-a[1]];
  for(let i=0;i<4;i++){if(Math.abs(P[i])<1e-12){if(Q[i]<0)return[[a,b]];continue}const t=Q[i]/P[i];if(P[i]<0){if(t>t0)t0=t}else if(t<t1)t1=t}
  if(t0>=t1)return[[a,b]];
  const at=t=>[a[0]+dx*t,a[1]+dy*t],out=[];if(t0>1e-6)out.push([a,at(t0)]);if(t1<1-1e-6)out.push([at(t1),b]);return out}
function clipPath(path,rects){const segs=[];
  for(let j=0;j+1<path.length;j++){let parts=[[path[j],path[j+1]]];for(const e of rects)parts=parts.flatMap(s=>cutSeg(s[0],s[1],e));segs.push(...parts)}
  const out=[];for(const s of segs){const l=out[out.length-1];if(l&&l[l.length-1]===s[0])l.push(s[1]);else out.push([s[0],s[1]])}
  return out}
/* the 1 m floor-tile lattice: from the layout's "grid" entry, or worked out from its TILE-GRID lines.
   It is drawn as unbroken lines over the tiled area and its crossings are snap points. */
function inferGrid(d){
  if(d.grid&&d.grid.step)return d.grid;
  const g=d.paths&&d.paths['TILE-GRID'];if(!g||g.length<4)return null;
  const xs=[],ys=[];let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const p of g){const a=p[0],b=p[p.length-1];for(const v of p){x0=Math.min(x0,v[0]);x1=Math.max(x1,v[0]);y0=Math.min(y0,v[1]);y1=Math.max(y1,v[1])}
    if(Math.abs(a[0]-b[0])<1e-6)xs.push(a[0]);else if(Math.abs(a[1]-b[1])<1e-6)ys.push(a[1])}
  if(xs.length<2||ys.length<2)return null;
  const top=m=>[...m.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  const u=[...new Set(xs.map(q=>q.toFixed(2)))].map(Number).sort((a,b)=>a-b),dc=new Map();
  for(let i=1;i<u.length;i++){const q=r2(u[i]-u[i-1]);dc.set(q,(dc.get(q)||0)+1)}
  const step=top(dc);if(!(step>0.1))return null;
  const off=v=>{const m=new Map();for(const q of v){const k=r2(((q%step)+step)%step);m.set(k,(m.get(k)||0)+1)}return top(m)};
  return{ox:off(xs),oy:off(ys),step,x0:r2(x0),y0:r2(y0),x1:r2(x1),y1:r2(y1)}}
/* nearest grid crossing to (x,y), or null outside the tiled area / grid layer hidden */
function gridNear(x,y){const G=U.grid;if(!G||!U.vis['TILE-GRID'])return null;
  if(x<G.x0-0.3||x>G.x1+0.3||y<G.y0-0.3||y>G.y1+0.3)return null;
  const sn=(v,o,lo,hi)=>{let q=o+Math.round((v-o)/G.step)*G.step;while(q<lo-1e-6)q+=G.step;while(q>hi+1e-6)q-=G.step;return r2(q)};
  return[sn(x,G.ox,G.x0,G.x1),sn(y,G.oy,G.y0,G.y1)]}
function findBg(x,y,tol){
  let best=null,bd=tol,bt=null,btd=tol;
  for(const k of Object.keys(U.paths)){if(!U.vis[k])continue;const L=U.paths[k],B=U.bb[k],tile=k==='TILE-GRID';if(tile&&U.grid)continue;
    for(let i=0;i<L.length;i++){const b=B[i];if(x<b[0]-tol||x>b[2]+tol||y<b[1]-tol||y>b[3]+tol)continue;if(U.hidden.has(U.keys[k][i]))continue;
      for(const p of pieces(k,i))for(let j=0;j+1<p.length;j++){const d=segDist(x,y,p[j][0],p[j][1],p[j+1][0],p[j+1][1])[0];if(tile){if(d<btd){btd=d;bt={k,i}}}else if(d<bd){bd=d;best={k,i}}}}}
  return best||bt}
function boxBg(a,b){
  const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),y0=Math.min(a[1],b[1]),y1=Math.max(a[1],b[1]),out=[];
  for(const k of Object.keys(U.paths)){if(!U.vis[k])continue;if(k==='TILE-GRID'&&(U.grid||!T.bgTile))continue;const B=U.bb[k];
    for(let i=0;i<B.length;i++){const q=B[i];if(q[0]>=x0&&q[2]<=x1&&q[1]>=y0&&q[3]<=y1&&!U.hidden.has(U.keys[k][i]))out.push(U.keys[k][i])}}
  return out}
function eraseBg(a,b){const e=[r2(Math.min(a[0],b[0])),r2(Math.min(a[1],b[1])),r2(Math.max(a[0],b[0])),r2(Math.max(a[1],b[1]))];
  if(e[2]-e[0]<0.02||e[3]-e[1]<0.02){toast('กรอบเล็กเกินไป');return false}
  commit();S.bgErase.push(e);rebuildUnderlay();T.bgHover=null;changed();renderCtx();toast('ลบเส้นในกรอบแล้ว (ตาราง 1 ม. ไม่ถูกลบ) · Ctrl+Z ย้อนได้');return true}
function hideBg(keys){if(!keys.length){toast('ไม่เจอเส้นในบริเวณนี้');return}commit();S.bgHidden=S.bgHidden.concat(keys);rebuildUnderlay();T.bgHover=null;changed();renderCtx();toast(`ลบเส้นพื้นหลัง ${keys.length} เส้น · กดย้อนกลับได้`)}
function buildSnap(){
  snapIdx=new Map();wallSegs=[];
  const add=(x,y)=>{const key=Math.floor(x)+','+Math.floor(y);let a=snapIdx.get(key);if(!a){a=[];snapIdx.set(key,a)}a.push([x,y])};
  for(const k of U.snapL){const L=U.paths[k];if(!L)continue;
    for(let pi=0;pi<L.length;pi++){if(U.hidden.has(U.keys[k][pi]))continue;for(const path of pieces(k,pi)){for(const v of path)add(v[0],v[1]);
      if(U.wallL.includes(k))for(let i=0;i+1<path.length;i++){const a=path[i],b=path[i+1];if(Math.hypot(b[0]-a[0],b[1]-a[1])>0.4)wallSegs.push(a[0],a[1],b[0],b[1])}}}}
}
function fitBox(){
  const xs=[],ys=[];
  const ks=[...U.wallL,'COL','01COL'].filter(k=>U.paths[k]);
  for(const k of(ks.length?ks:Object.keys(U.paths))){const L=U.paths[k];if(!L)continue;for(const p of L)for(const v of p){xs.push(v[0]);ys.push(v[1])}}
  if(!xs.length)return[0,0,92,72];
  xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
  const q=(a,f)=>a[Math.floor((a.length-1)*f)];
  return[q(xs,.01),q(ys,.01),q(xs,.99),q(ys,.99)]
}
function fitView(){const b=fitBox(),w=b[2]-b[0],h=b[3]-b[1],m=1.08;V.s=Math.min(V.w/(w*m),V.h/(h*m));V.tx=V.w/2-((b[0]+b[2])/2)*V.s;V.ty=V.h/2+((b[1]+b[3])/2)*V.s;V3.cx=(b[0]+b[2])/2;V3.cy=(b[1]+b[3])/2;V3.s=Math.min(V.w/(w*1.25),V.h/(h*1.25));render()}
const w2s=(x,y)=>[x*V.s+V.tx,-y*V.s+V.ty];
const s2w=(x,y)=>[(x-V.tx)/V.s,-(y-V.ty)/V.s];

/* ====================== snapping ====================== */
/* Snapping, in order:
   1. a corner (room corners win over background points: they count as 60% of their distance)
   2. otherwise line up x and/or y with a room corner anywhere on the sheet, or a background point nearby
      (red dashed guide) — so two rooms drawn separately end up with edges exactly in line
   Holding Shift (or Ctrl) = no snapping at all, the point goes where you click.
   opt.skipRoom: a room whose corners are ignored (the one being moved) · opt.skipPt: one corner array (the one being dragged) */
const MOD={free:false};
const snapRad=()=>Math.max(0.15,14/V.s);
function bgNear(x,y,R){const out=[],cx=Math.floor(x),cy=Math.floor(y),n=Math.ceil(R);
  for(let i=-n;i<=n;i++)for(let j=-n;j<=n;j++){const a=snapIdx.get((cx+i)+','+(cy+j));if(a)for(const v of a)if(Math.abs(v[0]-x)<=R&&Math.abs(v[1]-y)<=R)out.push(v)}
  return out}
function roomCorners(opt){const out=[];for(const r of S.rooms){if(opt&&opt.skipRoom===r)continue;for(const v of r.pts)if(!opt||v!==opt.skipPt)out.push(v)}
  if(T.tool==='poly')for(let i=0;i<T.poly.length-(opt&&opt.polyLast?1:0);i++)out.push(T.poly[i]);
  return out}
function snapPt(x,y,rad,opt){
  opt=opt||{};const free=opt.mod?opt.mod.free:MOD.free;
  if(!T.snap||free)return{x:r2(x),y:r2(y),k:null};
  const rc=roomCorners(opt);
  let best=null,bd=rad;
  const gn=gridNear(x,y);
  for(const v of bgNear(x,y,rad).concat(gn?[gn]:[])){const d=Math.hypot(v[0]-x,v[1]-y);if(d<bd){bd=d;best=v}}
  for(const v of rc){const d=Math.hypot(v[0]-x,v[1]-y)*0.6;if(d<bd){bd=d;best=v}}
  if(best)return{x:best[0],y:best[1],k:'pt'};
  if(opt.noAlign)return{x:r2(x),y:r2(y),k:null};
  /* line up: room corners from anywhere, background points within a few snap radii */
  let ax=null,bx=rad,ay=null,by=rad;
  for(const v of rc.concat(bgNear(x,y,rad*6))){const ex=Math.abs(v[0]-x),ey=Math.abs(v[1]-y);
    if(ex<bx||ex===bx&&ax&&ey<Math.abs(ax[1]-y)){bx=ex;ax=v}if(ey<by||ey===by&&ay&&ex<Math.abs(ay[0]-x)){by=ey;ay=v}}
  if(gn){if(Math.abs(gn[0]-x)<bx){bx=Math.abs(gn[0]-x);ax=gn}if(Math.abs(gn[1]-y)<by){by=Math.abs(gn[1]-y);ay=gn}}
  if(ax||ay){const refs=[ax,ay].filter(Boolean);return{x:ax?ax[0]:r2(x),y:ay?ay[1]:r2(y),k:'ax',ref:refs[0],refs,alx:!!ax,aly:!!ay}}
  return{x:r2(x),y:r2(y),k:null}}
/* ortho drawing for polygon rooms: a segment that is nearly horizontal/vertical locks straight,
   then snaps only to points on that line or lined up with it (so a nearby column can't pull it crooked). */
const ORTHO_TOL=Math.tan(8*Math.PI/180);
function orthoPt(prev,x,y,rad,mod){
  mod=mod||MOD;if(mod.free)return{x:r2(x),y:r2(y),k:null};
  if(!prev)return snapPt(x,y,rad,{mod});
  const dx=x-prev[0],dy=y-prev[1],hz=Math.abs(dx)>=Math.abs(dy),big=Math.max(Math.abs(dx),Math.abs(dy)),small=Math.min(Math.abs(dx),Math.abs(dy));
  if(big<1e-9||small>big*ORTHO_TOL)return snapPt(x,y,rad,{mod,polyLast:true});
  let px=hz?x:prev[0],py=hz?prev[1]:y;
  if(T.snap){let on=null,bo=rad,al=null,ba=rad,bOff=1e9;
    /* corners of rooms (and of this room) line up from any distance, background points only nearby */
    const own=T.poly.slice(0,-1);
    const gq=gridNear(px,py);
    for(const v of bgNear(px,py,rad*4).concat(roomCorners({polyLast:true}),gq?[gq]:[])){const along=hz?Math.abs(v[0]-px):Math.abs(v[1]-py),off=hz?Math.abs(v[1]-py):Math.abs(v[0]-px);
      if(along>=rad)continue;
      if(off<1e-3){if(along<bo){bo=along;on=v}}
      else{const o=own.includes(v)?-1:off;if(o<bOff||o===bOff&&along<ba){bOff=o;ba=along;al=v}}}
    if(on)return{x:on[0],y:on[1],k:'pt',ortho:true};
    if(al)return hz?{x:al[0],y:py,k:'ax',ref:al,refs:[al],ortho:true}:{x:px,y:al[1],k:'ax',ref:al,refs:[al],ortho:true}}
  return{x:hz?r2(px):px,y:hz?py:r2(py),k:null,ortho:true}}
const polyPt=(x,y)=>orthoPt(T.poly[T.poly.length-1],x,y,snapRad());
/* dragging a room corner: snap / line up (ignoring the corner itself), neighbouring corners first */
function vtxPt(r,i,x,y,mod){mod=mod||MOD;const rad=snapRad();if(mod.free)return{x:r2(x),y:r2(y),k:null};
  const s=snapPt(x,y,rad,{mod,skipPt:r.pts[i],noAlign:true});if(s.k)return s;
  const n=r.pts.length,nb=[r.pts[(i+n-1)%n],r.pts[(i+1)%n]];let px=null,py=null,bx=rad,by=rad;
  for(const v of nb){if(Math.abs(v[0]-x)<bx){bx=Math.abs(v[0]-x);px=v}if(Math.abs(v[1]-y)<by){by=Math.abs(v[1]-y);py=v}}
  const a=snapPt(x,y,rad,{mod,skipPt:r.pts[i]});
  const X=px?px[0]:a.alx?a.x:r2(x),Y=py?py[1]:a.aly?a.y:r2(y);
  const refs=[px||(a.alx&&a.refs[0]),py||(a.aly&&a.refs[a.refs.length-1])].filter(Boolean);
  return{x:X,y:Y,k:refs.length?'ax':null,ref:refs[0],refs,ortho:refs.length>0}}
/* moving a whole room: whichever of its corners comes near another corner snaps onto it;
   otherwise its edges line up with other rooms' corners */
/* group move: what belongs to a room — machines standing in it, doors on (or in) its walls,
   flow lines and dimension lines lying wholly in it. Positions are kept as they were when the drag began. */
function roomMembers(r){const tol=0.15;
  const edge=(x,y)=>{let d=1e9;for(let i=0;i<r.pts.length;i++){const a=r.pts[i],b=r.pts[(i+1)%r.pts.length];d=Math.min(d,segDist(x,y,a[0],a[1],b[0],b[1])[0])}return d};
  const on=(x,y)=>pip(r.pts,x,y)||edge(x,y)<tol;
  const M=S.machines.filter(m=>pip(r.pts,m.x,m.y)),D=S.doors.filter(d=>on(d.x,d.y)),F=S.flows.filter(f=>f.pts.every(p=>on(p[0],p[1]))),L=S.dims.filter(d=>on(...d.a)&&on(...d.b));
  return{pt:[...M,...D].map(o=>({o,x:o.x,y:o.y})),fl:F.map(o=>({o,pts:o.pts.map(p=>p.slice())})),dm:L.map(o=>({o,a:o.a.slice(),b:o.b.slice()})),n:{m:M.length,d:D.length,f:F.length,l:L.length}}}
function moveMembers(g,dx,dy){const mv=p=>[r2(p[0]+dx),r2(p[1]+dy)];
  for(const q of g.pt){q.o.x=r2(q.x+dx);q.o.y=r2(q.y+dy)}for(const q of g.fl)q.o.pts=q.pts.map(mv);for(const q of g.dm){q.o.a=mv(q.a);q.o.b=mv(q.b)}}
function moveSnap(r,pts,dx,dy,mod){mod=mod||MOD;if(!T.snap||mod.free)return[dx,dy,null];const rad=snapRad();
  let best=null,bd=1e9;
  for(const p of pts){const x=p[0]+dx,y=p[1]+dy,s=snapPt(x,y,rad,{mod,skipRoom:r,noAlign:true});if(s.k){const d=Math.hypot(s.x-x,s.y-y);if(d<bd){bd=d;best=[s.x-p[0],s.y-p[1],s]}}}
  if(best)return best;
  let ox=null,bx=rad,oy=null,by=rad,rx=null,ry=null;
  for(const p of pts){const x=p[0]+dx,y=p[1]+dy,s=snapPt(x,y,rad,{mod,skipRoom:r});if(s.k!=='ax')continue;
    if(s.alx&&Math.abs(s.x-x)<bx){bx=Math.abs(s.x-x);ox=s.x-p[0];rx=s}if(s.aly&&Math.abs(s.y-y)<by){by=Math.abs(s.y-y);oy=s.y-p[1];ry=s}}
  return[ox!=null?ox:r2(dx),oy!=null?oy:r2(dy),null]}
/* add a corner on a room edge (double-click edge) or remove one (double-click corner, min 3) */
function editVertexAt(wx,wy,sp){
  const rooms=T.sel&&T.sel.type==='room'?[getSel(),...S.rooms]:S.rooms;
  for(const r of rooms){if(!r)continue;
    for(let i=0;i<r.pts.length;i++){const p=w2s(...r.pts[i]);if(Math.hypot(p[0]-sp[0],p[1]-sp[1])<10){
      if(r.pts.length<=3){toast('ห้องต้องมีอย่างน้อย 3 มุม');return true}
      commit();r.pts.splice(i,1);setSel('room',r.id);changed();toast('ลบมุมแล้ว');return true}}}
  const tol=Math.max(0.15,12/V.s);
  for(const r of rooms){if(!r)continue;
    for(let i=0;i<r.pts.length;i++){const a=r.pts[i],b=r.pts[(i+1)%r.pts.length],d=segDist(wx,wy,a[0],a[1],b[0],b[1]);
      if(d[0]<tol&&d[3]>0.02&&d[3]<0.98){commit();
        const q=Math.abs(a[1]-b[1])<1e-6?[r2(d[1]),a[1]]:Math.abs(a[0]-b[0])<1e-6?[a[0],r2(d[2])]:[r2(d[1]),r2(d[2])];
        r.pts.splice(i+1,0,q);setSel('room',r.id);changed();toast('เพิ่มมุมแล้ว ลากมุมใหม่ไปตำแหน่งที่ต้องการ');return true}}}
  return false}
function nearWall(x,y,tol){
  let best=null,bd=tol;
  const test=(ax,ay,bx,by)=>{const r=segDist(x,y,ax,ay,bx,by);if(r[0]<bd){bd=r[0];best={x:r[1],y:r[2],ang:Math.atan2(by-ay,bx-ax)}}};
  for(let i=0;i<wallSegs.length;i+=4)test(wallSegs[i],wallSegs[i+1],wallSegs[i+2],wallSegs[i+3]);
  for(const r of S.rooms)for(let i=0;i<r.pts.length;i++){const a=r.pts[i],b=r.pts[(i+1)%r.pts.length];test(a[0],a[1],b[0],b[1])}
  return best}

/* ====================== checks ====================== */
function runChecks(){
  const out=[],add=(sev,msg,at,sel)=>out.push({sev,msg,at,sel});
  const R=S.rooms,M=S.machines,D=S.doors,minA=+S.cfg.minAisle;
  for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++)if(roomsOverlap(R[i],R[j])){const c=centroid(R[i].pts);add('warn',`ห้อง “${R[i].name}” ทับกับ “${R[j].name}”`,c,{type:'room',id:R[i].id})}
  for(let i=0;i<M.length;i++){
    const a=M[i],pa=machinePoly(a);
    for(let j=i+1;j<M.length;j++){
      const b=M[j],pb=machinePoly(b),g=polyDist(pa,pb);
      const mid=[(g.p[0]+g.q[0])/2,(g.p[1]+g.q[1])/2];
      if(g.ov){add('err',`${a.name} ทับ ${b.name}`,mid,{type:'machine',id:a.id},[a.id,b.id]);continue}
      const za=polyDist(machinePoly(a,a.clear),pb).ov,zb=polyDist(machinePoly(b,b.clear),pa).ov;
      if(za||zb){add('warn',`ระยะบริการของ ${za?a.name:b.name} ทับ ${za?b.name:a.name} (ห่าง ${fmt(g.d)} ม.)`,mid,{type:'machine',id:a.id},[a.id,b.id]);continue}
      if(g.d<minA)add('warn',`${a.name} กับ ${b.name} ห่าง ${fmt(g.d)} ม. น้อยกว่าทางเดินขั้นต่ำ ${fmt(minA,1)} ม.`,mid,{type:'machine',id:a.id},[a.id,b.id])
    }
    if(R.length){
      const rm=roomAt(a.x,a.y);
      if(!rm)add('info',`${a.name} ไม่ได้อยู่ในห้องใด`,[a.x,a.y],{type:'machine',id:a.id});
      else if(pa.some(v=>!pip(rm.pts,v[0],v[1])))add('warn',`${a.name} ล้ำออกนอกห้อง “${rm.name}”`,[a.x,a.y],{type:'machine',id:a.id});
    }
  }
  const touched=new Set(),pairs=[],doorsOf=new Map();
  const addDoorOf=(r,d)=>{if(!r)return;if(!doorsOf.has(r.id))doorsOf.set(r.id,[]);doorsOf.get(r.id).push(d)};
  for(const d of D){
    const g=doorGeom(d),n=g.n,off=0.6;
    const pA=[d.x+n[0]*off,d.y+n[1]*off],pB=[d.x-n[0]*off,d.y-n[1]*off];
    const rA=roomAt(pA[0],pA[1]),rB=roomAt(pB[0],pB[1]);
    if(rA)touched.add(rA.id);if(rB)touched.add(rB.id);addDoorOf(rA,d);if(rB!==rA)addDoorOf(rB,d);
    const sel={type:'door',id:d.id},at=[d.x,d.y],dn=d.name||'ประตู';
    if(R.length){
      if(rA&&rB&&rA!==rB){
        const dp=Math.abs((+rA.pa||0)-(+rB.pa||0));
        if(dp<+S.cfg.minDP&&rA.grade!==rB.grade)add('warn',`${dn}: “${rA.name}” กับ “${rB.name}” ต่างเกรดแต่ความดันต่างกันแค่ ${dp} Pa (ขั้นต่ำที่ตั้งไว้ ${S.cfg.minDP} Pa)`,at,sel);
        const sr=(d.side||1)===1?rA:rB,orr=sr===rA?rB:rA;
        if((+sr.pa||0)<(+orr.pa||0))add('info',`${dn}: บานเปิดเข้าห้อง “${sr.name}” ซึ่งความดันต่ำกว่า “${orr.name}” (ปกติให้เปิดเข้าด้านความดันสูง ปรึกษาผู้ออกแบบ)`,at,sel);
        pairs.push({d,a:rA,b:rB});
        const ta=rA.type||'other',tb=rB.type||'other',pa=+rA.pa||0,pb=+rB.pa||0;
        const buf=t=>t==='airlock'||t==='gowning';
        if(rA.grade!==rB.grade&&!buf(ta)&&!buf(tb))add('info',`${dn}: “${rA.name}” (${rA.grade}) ต่อกับ “${rB.name}” (${rB.grade}) โดยตรง ระหว่างต่างเกรดควรผ่าน airlock หรือห้องเปลี่ยนชุด`,at,sel);
        const proc=ta==='process'?rA:tb==='process'?rB:null,cor=ta==='corridor'?rA:tb==='corridor'?rB:null;
        if(proc&&cor&&proc!==cor&&(+proc.pa||0)>=(+cor.pa||0))add('warn',`${dn}: ห้องผลิต “${proc.name}” (${proc.pa} Pa) ไม่ต่ำกว่าทางเดิน “${cor.name}” (${cor.pa} Pa) ฝุ่นยาอาจออกสู่ทางเดิน ปกติให้ห้องผลิตต่ำกว่าทางเดิน`,at,sel);
        if(pa===pb&&ta!==tb)add('info',`${dn}: “${rA.name}” กับ “${rB.name}” ความดันเท่ากัน (${pa} Pa) ทิศทางลมผ่านประตูไม่ชัด`,at,sel);
      }else if(!(rA||rB)){add('info',`${dn} ไม่ได้อยู่ระหว่างห้องใด`,at,sel)}
      else if(rA===rB)add('info',`${dn} อยู่ภายในห้องเดียว (${rA.name})`,at,sel);
    }
    for(const m of M){
      const poly=machinePoly(m,0.05);let hit=false;
      for(const l of g.leaves){
        const a0=Math.atan2(l.closed[1]-l.hinge[1],l.closed[0]-l.hinge[0]),a1=Math.atan2(l.open[1]-l.hinge[1],l.open[0]-l.hinge[0]);
        let df=a1-a0;while(df>Math.PI)df-=2*Math.PI;while(df<-Math.PI)df+=2*Math.PI;
        for(let k=0;k<=8;k++){const a=a0+df*k/8;for(const rr of[1,0.66,0.33]){if(pip(poly,l.hinge[0]+Math.cos(a)*l.r*rr,l.hinge[1]+Math.sin(a)*l.r*rr)){hit=true;break}}if(hit)break}
        if(hit)break}
      if(hit)add('warn',`บานประตูชน ${m.name}`,at,sel);
    }
  }
  if(R.length)for(const r of R)if(!touched.has(r.id))add('warn',`ห้อง “${r.name}” ยังไม่มีประตู`,centroid(r.pts),{type:'room',id:r.id});
  for(const r of R){if(r.type!=='airlock')continue;const ds=doorsOf.get(r.id)||[];
    if(ds.length&&ds.length!==2)add('info',`Airlock “${r.name}” มีประตู ${ds.length} บาน ปกติ airlock มี 2 บาน (เข้า-ออก)`,centroid(r.pts),{type:'room',id:r.id});
    if(ds.some(d=>!d.interlock))add('info',`Airlock “${r.name}”: ยังมีประตูที่ไม่ได้ตั้ง interlock (ห้ามเปิดพร้อมกัน)`,centroid(r.pts),{type:'room',id:r.id})}
  /* flows */
  const FW=S.flows;
  const xpt=(a,b,c,d)=>{const r=[b[0]-a[0],b[1]-a[1]],q=[d[0]-c[0],d[1]-c[1]],den=r[0]*q[1]-r[1]*q[0];if(Math.abs(den)<1e-12)return a;const t=((c[0]-a[0])*q[1]-(c[1]-a[1])*q[0])/den;return[a[0]+t*r[0],a[1]+t*r[1]]};
  for(let i=0;i<FW.length;i++)for(let j=i+1;j<FW.length;j++){
    const f=FW[i],g=FW[j],sf=FL(f.kind).side,sg=FL(g.kind).side;
    if(!((sf==='d'&&sg==='c')||(sf==='c'&&sg==='d')))continue;
    let hit=null;for(let a=0;a+1<f.pts.length&&!hit;a++)for(let b=0;b+1<g.pts.length;b++)if(segInter(f.pts[a],f.pts[a+1],g.pts[b],g.pts[b+1])){hit=xpt(f.pts[a],f.pts[a+1],g.pts[b],g.pts[b+1]);break}
    if(hit)add('warn',`เส้นทาง “${f.name}” ตัดกับ “${g.name}” สะอาดกับสกปรกสวนกัน เสี่ยงปนเปื้อนข้าม ควรแยกเส้นทางหรือแยกเวลา`,hit,{type:'flow',id:f.id})}
  for(const f of FW){const seen=new Set();
    for(let a=0;a+1<f.pts.length;a++)for(const r of R)for(let e=0;e<r.pts.length;e++){
      const p=r.pts[e],q=r.pts[(e+1)%r.pts.length];if(!segInter(f.pts[a],f.pts[a+1],p,q))continue;
      const x=xpt(f.pts[a],f.pts[a+1],p,q);if(D.some(d=>Math.hypot(d.x-x[0],d.y-x[1])<=Math.max(0.9,d.w*0.75)))continue;
      if(seen.has(r.id))continue;seen.add(r.id);add('warn',`เส้นทาง “${f.name}” ผ่านผนังห้อง “${r.name}” ตรงที่ไม่มีประตู`,x,{type:'flow',id:f.id})}}
  T.pairs=pairs;
  const rank={err:0,warn:1,info:2};out.sort((a,b)=>rank[a.sev]-rank[b.sev]);
  T.checks=out;
  const nb=$('#nchk'),ne=out.filter(o=>o.sev!=='info').length;nb.textContent=ne;nb.className='badge'+(ne?'':' z');
}

/* ====================== rendering 2D ====================== */
const c2=$('#c2'),x2=c2.getContext('2d');
let rq=0;function render(){if(rq)return;rq=requestAnimationFrame(()=>{rq=0;if(T.view==='2d')draw2D();else draw3D()})}
function resize(){const st=$('#stage'),r=st.getBoundingClientRect();V.w=Math.max(10,r.width);V.h=Math.max(10,r.height);V.dpr=Math.min(window.devicePixelRatio||1,2);
  for(const c of[c2,$('#c3')]){c.width=Math.round(V.w*V.dpr);c.height=Math.round(V.h*V.dpr)}render()}
function drawLabel(ctx,txt,x,y,size,color,bold){ctx.font=`${bold?500:400} ${size}px ${css('--font')}`;ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(txt,x,y)}
function draw2D(){
  const ctx=x2,dpr=V.dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=css('--canvas');ctx.fillRect(0,0,V.w,V.h);
  const uw=css('--uw'),uw2=css('--uw2'),ink=css('--ink');
  // underlay
  if(U.loaded){
    ctx.save();ctx.setTransform(V.s*dpr,0,0,-V.s*dpr,V.tx*dpr,V.ty*dpr);ctx.globalAlpha=U.alpha;ctx.lineJoin='round';
    for(const k of Object.keys(U.p2d)){if(!U.vis[k])continue;const wall=U.wallL.includes(k)||k==='COL'||k==='01COL';
      ctx.strokeStyle=wall?uw2:uw;ctx.lineWidth=(wall?1.2:0.8)/V.s;
      if(k==='TILE-GRID'&&U.grid){const G=U.grid;if(G.step*V.s<4)continue;const v0=s2w(0,V.h),v1=s2w(V.w,0),gp=new Path2D();
        const xa=Math.max(G.x0,v0[0]),xb=Math.min(G.x1,v1[0]),ya=Math.max(G.y0,v0[1]),yb=Math.min(G.y1,v1[1]);
        if(xa<xb&&ya<yb){for(let x=G.ox+Math.ceil((xa-G.ox)/G.step-1e-9)*G.step;x<=xb+1e-9;x+=G.step){gp.moveTo(x,ya);gp.lineTo(x,yb)}
          for(let y=G.oy+Math.ceil((ya-G.oy)/G.step-1e-9)*G.step;y<=yb+1e-9;y+=G.step){gp.moveTo(xa,y);gp.lineTo(xb,y)}ctx.stroke(gp)}continue}
      ctx.stroke(U.p2d[k])}
    ctx.restore();
    if(U.showText){ctx.fillStyle=uw2;ctx.textAlign='left';ctx.textBaseline='alphabetic';
      for(const t of U.texts){const px=t[4]*V.s;if(px<5||!U.vis[t[0]]&&false)continue;const p=w2s(t[2],t[3]);if(p[0]<-50||p[0]>V.w+50||p[1]<-50||p[1]>V.h+50)continue;ctx.save();ctx.translate(p[0],p[1]);if(t[5])ctx.rotate(-t[5]);ctx.font=`${Math.min(px,40)}px ${css('--font')}`;ctx.fillText(t[1],0,0);ctx.restore()}}
  }
  if(T.tool==='bg'&&T.bgHover&&U.paths[T.bgHover.k]){ctx.beginPath();for(const p of pieces(T.bgHover.k,T.bgHover.i))p.forEach((v,i)=>{const q=w2s(v[0],v[1]);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])});ctx.strokeStyle=css('--err');ctx.lineWidth=3.5;ctx.stroke()}
  if(T.bgBox){const a=w2s(...T.bgBox[0]),b=w2s(...T.bgBox[1]);ctx.save();ctx.setLineDash([6,4]);ctx.strokeStyle=css('--err');ctx.lineWidth=1.5;ctx.strokeRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));ctx.globalAlpha=0.07;ctx.fillStyle=css('--err');ctx.fillRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));ctx.restore()}
  // rooms
  for(const r of S.rooms){
    const col=roomColor(r);ctx.beginPath();r.pts.forEach((v,i)=>{const p=w2s(v[0],v[1]);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])});ctx.closePath();
    ctx.globalAlpha=0.2;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=T.sel&&T.sel.id===r.id?3:1.8;ctx.strokeStyle=col;ctx.stroke();
  }
  // machines
  for(const m of S.machines){
    const sel=T.sel&&T.sel.id===m.id,col=m.col||'#7a8594';
    const z=machinePoly(m,m.clear).map(v=>w2s(v[0],v[1]));
    ctx.beginPath();z.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
    ctx.globalAlpha=0.1;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=0.8;ctx.setLineDash([5,4]);ctx.lineWidth=1;ctx.strokeStyle=col;ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
    const b=machinePoly(m).map(v=>w2s(v[0],v[1]));
    ctx.beginPath();b.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
    ctx.globalAlpha=0.85;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=sel?3:1.2;ctx.strokeStyle=sel?css('--accent'):ink;ctx.stroke();
  }
  // checks: link lines
  for(const c of T.checks){if(c.sev==='info'||!c.at)continue;const p=w2s(c.at[0],c.at[1]);ctx.beginPath();ctx.arc(p[0],p[1],6,0,7);ctx.strokeStyle=c.sev==='err'?css('--err'):css('--warn');ctx.lineWidth=2;ctx.stroke()}
  // doors
  for(const d of S.doors){
    const g=doorGeom(d),sel=T.sel&&T.sel.id===d.id,col=sel?css('--accent'):(d.dbl?'#e8590c':'#1c7ed6');
    ctx.strokeStyle=col;ctx.lineWidth=sel?2.5:1.6;
    for(const l of g.leaves){
      const h=w2s(...l.hinge),o=w2s(...l.open),c=w2s(...l.closed);
      ctx.beginPath();ctx.moveTo(h[0],h[1]);ctx.lineTo(o[0],o[1]);ctx.stroke();
      const aU=Math.atan2(c[1]-h[1],c[0]-h[0]),aV=Math.atan2(o[1]-h[1],o[0]-h[0]);let df=aV-aU;while(df>Math.PI)df-=2*Math.PI;while(df<-Math.PI)df+=2*Math.PI;
      ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.beginPath();ctx.arc(h[0],h[1],l.r*V.s,aU,aV,df<0);ctx.stroke();ctx.setLineDash([]);ctx.lineWidth=sel?2.5:1.6}
    const e0=w2s(...g.ends[0]),e1=w2s(...g.ends[1]);
    ctx.beginPath();ctx.arc(e0[0],e0[1],2.5,0,7);ctx.arc(e1[0],e1[1],2.5,0,7);ctx.fillStyle=col;ctx.fill();
    if(d.interlock){const c=w2s(d.x,d.y);drawLabel(ctx,'IL',c[0]+g.n[0]*0,c[1]-12,10,col,true)}
  }
  // dimensions (mm, like the architect's drawing)
  for(const d of S.dims){const sel=T.sel&&T.sel.id===d.id;drawDim(ctx,d.a,d.b,sel?css('--accent'):'#2b8a3e',sel)}
  // material / personnel flows
  for(const f of S.flows)drawFlow(ctx,f.pts,FL(f.kind),T.sel&&T.sel.id===f.id);
  // labels
  for(const r of S.rooms){const c=centroid(r.pts),p=w2s(c[0],c[1]),ar=Math.abs(polyArea(r.pts))*V.s*V.s;if(ar<2500)continue;
    const f=clamp(V.s*0.55,10,15);drawLabel(ctx,r.name,p[0],p[1]-f*0.6,f,css('--ink'),true);
    drawLabel(ctx,`${r.grade==='ไม่จัดเกรด'?'':'Grade '+r.grade+' · '}${r.pa} Pa`,p[0],p[1]+f*0.7,f-1,css('--muted'),false)}
  for(const m of S.machines){const p=w2s(m.x,m.y);if(m.w*V.s<34)continue;drawLabel(ctx,m.name,p[0],p[1],clamp(V.s*0.36,9,12),'#fff',true)}
  // selection handles
  if(T.sel&&T.sel.type==='room'){const r=S.rooms.find(q=>q.id===T.sel.id);if(r)for(const v of r.pts){const p=w2s(v[0],v[1]);ctx.fillStyle=css('--panel');ctx.strokeStyle=css('--accent');ctx.lineWidth=2;ctx.beginPath();ctx.arc(p[0],p[1],6,0,7);ctx.fill();ctx.stroke()}}
  // drawing previews
  const acc=css('--accent');ctx.strokeStyle=acc;ctx.fillStyle=acc;ctx.lineWidth=2;
  if(T.tool==='poly'&&T.poly.length){ctx.beginPath();T.poly.forEach((v,i)=>{const p=w2s(v[0],v[1]);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])});if(T.hover){const p=w2s(T.hover.x,T.hover.y);ctx.lineTo(p[0],p[1])}ctx.stroke();
    T.poly.forEach(v=>{const p=w2s(v[0],v[1]);ctx.beginPath();ctx.arc(p[0],p[1],4,0,7);ctx.fill()});
    if(T.hover){const l=T.poly[T.poly.length-1],a=w2s(l[0],l[1]),b=w2s(T.hover.x,T.hover.y),L=Math.hypot(T.hover.x-l[0],T.hover.y-l[1]);
      if(L>0.05)drawLabel(ctx,`${fmt(L)} ม.${T.hover.ortho?' ⟂':''}`,(a[0]+b[0])/2,(a[1]+b[1])/2-12,12,acc,true)}}
  if(T.hover&&T.hover.k==='ax'&&T.hover.ref){const b=w2s(T.hover.x,T.hover.y);ctx.save();ctx.strokeStyle=css('--err');ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();
    for(const rf of(T.hover.refs||[T.hover.ref])){const a=w2s(...rf);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])}ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(b[0],b[1],4,0,7);ctx.stroke();ctx.restore();ctx.strokeStyle=acc;ctx.fillStyle=acc;ctx.lineWidth=2}
  if(T.tool==='room'&&T.pend&&T.hover){const a=w2s(T.pend[0],T.pend[1]),b=w2s(T.hover.x,T.hover.y);ctx.setLineDash([6,4]);ctx.strokeRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));ctx.setLineDash([]);
    const w=Math.abs(T.hover.x-T.pend[0]),h=Math.abs(T.hover.y-T.pend[1]);drawLabel(ctx,`${fmt(w,2)} × ${fmt(h,2)} ม.`,(a[0]+b[0])/2,Math.min(a[1],b[1])-10,12,acc,true)}
  if(T.tool==='measure'&&T.meas.length){const pts=T.meas.slice();if(pts.length===1&&T.hover)pts.push([T.hover.x,T.hover.y]);
    const a=w2s(...pts[0]);ctx.beginPath();ctx.moveTo(a[0],a[1]);if(pts[1]){const b=w2s(...pts[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();drawLabel(ctx,`${fmt(Math.hypot(pts[1][0]-pts[0][0],pts[1][1]-pts[0][1]))} ม.`,(a[0]+b[0])/2,(a[1]+b[1])/2-12,13,acc,true)}
    pts.forEach(v=>{const p=w2s(...v);ctx.beginPath();ctx.arc(p[0],p[1],4,0,7);ctx.fill()})}
  if(T.tool==='machine'&&T.hover){const m={x:T.hover.x,y:T.hover.y,w:T.lib.w,d:T.lib.d,rot:0,clear:T.lib.c};const b=machinePoly(m).map(v=>w2s(v[0],v[1]));ctx.globalAlpha=0.5;ctx.beginPath();b.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=T.lib.col;ctx.fill();ctx.globalAlpha=1}
  if(T.tool==='door'&&T.hover&&T.hover.ang!=null){const d={x:T.hover.x,y:T.hover.y,ang:T.hover.ang,w:T.door.w,dbl:T.door.dbl,side:1,hinge:1};const g=doorGeom(d);ctx.globalAlpha=0.6;ctx.lineWidth=2;for(const l of g.leaves){const h=w2s(...l.hinge),o=w2s(...l.open);ctx.beginPath();ctx.moveTo(h[0],h[1]);ctx.lineTo(o[0],o[1]);ctx.stroke()}ctx.globalAlpha=1}
  if(T.tool==='flow'&&T.fpts.length){const pts=T.fpts.slice();if(T.hover)pts.push([T.hover.x,T.hover.y]);if(pts.length>1)drawFlow(ctx,pts,T.flow,false);T.fpts.forEach(v=>{const p=w2s(...v);ctx.beginPath();ctx.arc(p[0],p[1],4,0,7);ctx.fillStyle=T.flow.col;ctx.fill()})}
  if(T.tool==='dim'&&T.dpts.length&&T.hover)drawDim(ctx,T.dpts[0],[T.hover.x,T.hover.y],acc,false);
  if(T.hover&&T.hover.k==='pt'){const p=w2s(T.hover.x,T.hover.y);ctx.strokeStyle=css('--err');ctx.lineWidth=1.5;ctx.strokeRect(p[0]-5,p[1]-5,10,10)}
  if(HIST.draw)HIST.draw(ctx);
  if(!U.loaded){drawLabel(ctx,'ยังไม่ได้เปิดแบบพื้นหลัง',V.w/2,V.h/2-12,16,css('--ink'),true);drawLabel(ctx,'แท็บ “แบบพื้นหลัง” หรือเมนู ⋯ → เปิดแบบพื้นหลัง (.layout.json)',V.w/2,V.h/2+14,13,css('--muted'),false)}
  drawScale();
}
function arrowHead(ctx,x,y,ang,sz){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-sz*Math.cos(ang-0.42),y-sz*Math.sin(ang-0.42));ctx.lineTo(x-sz*Math.cos(ang+0.42),y-sz*Math.sin(ang+0.42));ctx.closePath();ctx.fill()}
function drawFlow(ctx,pts,F,sel){
  const sp=pts.map(v=>w2s(v[0],v[1]));ctx.save();ctx.strokeStyle=F.col;ctx.fillStyle=F.col;ctx.lineWidth=sel?5:3;ctx.lineJoin='round';ctx.lineCap='round';ctx.globalAlpha=0.9;
  ctx.setLineDash(F.dash?[9,6]:[]);ctx.beginPath();sp.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();ctx.setLineDash([]);
  for(let i=0;i+1<sp.length;i++){const a=sp[i],b=sp[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]),ang=Math.atan2(b[1]-a[1],b[0]-a[0]);if(L>40&&i+2<sp.length||L>80)arrowHead(ctx,(a[0]+b[0])/2,(a[1]+b[1])/2,ang,9)}
  if(sp.length>1){const a=sp[sp.length-2],b=sp[sp.length-1];arrowHead(ctx,b[0],b[1],Math.atan2(b[1]-a[1],b[0]-a[0]),13)}
  const s0=sp[0];ctx.beginPath();ctx.arc(s0[0],s0[1],4,0,7);ctx.fill();ctx.restore()}
function drawDim(ctx,A,B,col,sel){
  const a=w2s(...A),b=w2s(...B),L=Math.hypot(B[0]-A[0],B[1]-A[1]);if(L<1e-6)return;
  let ang=Math.atan2(b[1]-a[1],b[0]-a[0]);ctx.save();ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=sel?2.5:1.4;
  ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);
  for(const p of[a,b]){ctx.moveTo(p[0]-5*Math.cos(ang+0.785),p[1]-5*Math.sin(ang+0.785));ctx.lineTo(p[0]+5*Math.cos(ang+0.785),p[1]+5*Math.sin(ang+0.785))}ctx.stroke();
  for(const p of[a,b]){ctx.beginPath();ctx.arc(p[0],p[1],2.2,0,7);ctx.fill()}
  if(ang>Math.PI/2)ang-=Math.PI;if(ang<-Math.PI/2)ang+=Math.PI;
  ctx.translate((a[0]+b[0])/2,(a[1]+b[1])/2);ctx.rotate(ang);ctx.font=`500 ${clamp(V.s*0.32,10,14)}px ${css('--mono')}`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(String(Math.round(L*1000)),0,-3);ctx.restore()}
function drawScale(){const target=90/V.s;const steps=[0.5,1,2,5,10,20,50];let L=steps.find(s=>s>=target)||50;const el=$('#scalebar');el.innerHTML=`<div style="width:${L*V.s}px"></div>${L} ม.`}

/* ====================== 3D ====================== */
const c3=$('#c3'),x3=c3.getContext('2d');
const V3={yaw:-0.55,pitch:0.85,s:8,cx:0,cy:0,px:0,py:0,under:true};
function draw3D(){
  const ctx=x3,dpr=V.dpr,W=V.w,H=V.h;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=css('--canvas');ctx.fillRect(0,0,W,H);
  const cY=Math.cos(V3.yaw),sY=Math.sin(V3.yaw),sP=Math.sin(V3.pitch),cP=Math.cos(V3.pitch);
  const pr=(x,y,z)=>{const dx=x-V3.cx,dy=y-V3.cy,xr=dx*cY-dy*sY,yr=dx*sY+dy*cY;return[W/2+V3.px+xr*V3.s,H/2+V3.py-(yr*sP+z*cP)*V3.s,yr*cP-z*sP]};
  if(V3.under&&U.loaded){ctx.lineWidth=1;ctx.strokeStyle=css('--uw2');ctx.globalAlpha=0.55;ctx.beginPath();
    for(const k of U.wallL.concat(['COL','01COL'])){const L=U.paths[k];if(!L||!U.vis[k])continue;for(let pi=0;pi<L.length;pi++){if(U.hidden.has(U.keys[k][pi]))continue;for(const p of pieces(k,pi)){let first=true;for(const v of p){const q=pr(v[0],v[1],0);first?ctx.moveTo(q[0],q[1]):ctx.lineTo(q[0],q[1]);first=false}}}}
    ctx.stroke();ctx.globalAlpha=1}
  for(const r of S.rooms){const col=roomColor(r);ctx.beginPath();r.pts.forEach((v,i)=>{const q=pr(v[0],v[1],0);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])});ctx.closePath();ctx.globalAlpha=0.3;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke()}
  const faces=[];
  const quad=(pts,fill,alpha,stroke)=>{const q=pts.map(p=>pr(p[0],p[1],p[2]));faces.push({q,d:q.reduce((a,b)=>a+b[2],0)/q.length,fill,alpha,stroke})};
  for(const r of S.rooms){const col=roomColor(r),h=+r.h||S.cfg.wallH;
    for(let i=0;i<r.pts.length;i++){const a=r.pts[i],b=r.pts[(i+1)%r.pts.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(L/3));
      for(let k=0;k<n;k++){const t0=k/n,t1=(k+1)/n,p0=[a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0],p1=[a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1];quad([[p0[0],p0[1],0],[p1[0],p1[1],0],[p1[0],p1[1],h],[p0[0],p0[1],h]],col,0.42,col)}}}
  for(const m of S.machines){const b=machinePoly(m),h=m.h||1.5,col=m.col||'#7a8594';
    quad(b.map(v=>[v[0],v[1],h]),col,0.95,'#000');
    for(let i=0;i<4;i++){const a=b[i],c=b[(i+1)%4];quad([[a[0],a[1],0],[c[0],c[1],0],[c[0],c[1],h],[a[0],a[1],h]],col,0.8,'#000')}}
  for(const d of S.doors){const g=doorGeom(d),a=g.ends[0],b=g.ends[1],h=2.1;quad([[a[0],a[1],0],[b[0],b[1],0],[b[0],b[1],h],[a[0],a[1],h]],'#c98a3d',0.95,'#000')}
  faces.sort((a,b)=>b.d-a.d);
  for(const f of faces){ctx.beginPath();f.q.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.fill;ctx.fill();ctx.globalAlpha=0.55;ctx.strokeStyle=f.stroke;ctx.lineWidth=0.8;ctx.stroke();ctx.globalAlpha=1}
  for(const r of S.rooms){const c=centroid(r.pts),q=pr(c[0],c[1],(+r.h||S.cfg.wallH)+0.2);if(Math.abs(polyArea(r.pts))*V3.s*V3.s>1800)drawLabel(ctx,r.name,q[0],q[1],12,css('--ink'),true)}
}

/* ====================== interaction ====================== */
const P=new Map();let drag=null,pinch=null,hoverRaf=0;
const pt=e=>{const r=c2.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
function doorHit(d,x,y,tol){const g=doorGeom(d),e=g.ends;
  if(segDist(x,y,e[0][0],e[0][1],e[1][0],e[1][1])[0]<tol)return true;
  for(const l of g.leaves){const h=l.hinge;if(segDist(x,y,h[0],h[1],l.open[0],l.open[1])[0]<tol)return true;
    const vx=x-h[0],vy=y-h[1],r=Math.hypot(vx,vy);if(r>l.r+tol)continue;
    const c=[l.closed[0]-h[0],l.closed[1]-h[1]],o=[l.open[0]-h[0],l.open[1]-h[1]],lc=Math.hypot(...c)||1,lo=Math.hypot(...o)||1;
    if((vx*c[0]+vy*c[1])/lc>=-tol&&(vx*o[0]+vy*o[1])/lo>=-tol)return true}
  return false}
function hitTest(wx,wy){
  const tol=Math.max(0.2,10/V.s);
  /* doors first: the whole door counts (wall opening, leaf lines and the swing area), not just its centre */
  for(let i=S.doors.length-1;i>=0;i--){const d=S.doors[i];if(doorHit(d,wx,wy,tol))return{type:'door',obj:d}}
  for(let i=S.machines.length-1;i>=0;i--){const m=S.machines[i];if(pip(machinePoly(m,0.05),wx,wy))return{type:'machine',obj:m}}
  for(let i=S.dims.length-1;i>=0;i--){const d=S.dims[i];if(segDist(wx,wy,d.a[0],d.a[1],d.b[0],d.b[1])[0]<tol)return{type:'dim',obj:d}}
  for(let i=S.flows.length-1;i>=0;i--){const f=S.flows[i];for(let j=0;j+1<f.pts.length;j++)if(segDist(wx,wy,f.pts[j][0],f.pts[j][1],f.pts[j+1][0],f.pts[j+1][1])[0]<tol)return{type:'flow',obj:f}}
  let best=null,ba=1e12;for(const r of S.rooms)if(pip(r.pts,wx,wy)){const a=Math.abs(polyArea(r.pts));if(a<ba){ba=a;best=r}}
  if(best)return{type:'room',obj:best};return null}
const getSel=()=>{if(!T.sel)return null;const l=S[LK[T.sel.type]]||[];return l.find(o=>o.id===T.sel.id)||null};
function setSel(type,id){T.sel=type?{type,id}:null;if(type)T.tab='props';renderDock();render()}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),2200)}

function hoverUpdate(sp){
  const w=s2w(sp[0],sp[1]);let h=null;
  if(T.tool==='poly'){h=polyPt(w[0],w[1])}
  else if(['room','measure'].includes(T.tool)||T.tool==='select'&&drag&&drag.t==='vtx'){h=snapPt(w[0],w[1],snapRad())}
  else if(T.tool==='machine'){const g=0.05;h={x:Math.round(w[0]/g)*g,y:Math.round(w[1]/g)*g}}
  else if(T.tool==='door'){const nw=nearWall(w[0],w[1],Math.max(0.6,18/V.s));h=nw?{x:nw.x,y:nw.y,ang:nw.ang}:{x:w[0],y:w[1],ang:null}}
  else if(T.tool==='flow'){const g=0.1;h={x:r2(Math.round(w[0]/g)*g),y:r2(Math.round(w[1]/g)*g)}}
  else if(T.tool==='dim'){h=snapPt(w[0],w[1],snapRad())}
  else if(T.tool==='bg'){T.bgHover=(!T.bgLock&&T.bgMode==='tap'&&U.loaded)?findBg(w[0],w[1],Math.max(0.15,10/V.s)):null}
  T.hover=h;render()}

c2.addEventListener('pointerdown',e=>{
  c2.setPointerCapture(e.pointerId);P.set(e.pointerId,pt(e));
  if(P.size===2){const[a,b]=[...P.values()];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1]),cx:(a[0]+b[0])/2,cy:(a[1]+b[1])/2,s:V.s,tx:V.tx,ty:V.ty};drag=null;return}
  const sp=pt(e),w=s2w(sp[0],sp[1]);
  if(e.button===1||e.button===2){drag={t:'pan',sx:sp[0],sy:sp[1],tx:V.tx,ty:V.ty,moved:true,rmb:e.button===2,far:false};return}
  const tool=T.tool;
  if(tool==='select'){
    if(T.sel&&T.sel.type==='room'){const r=getSel();if(r){for(let i=0;i<r.pts.length;i++){const p=w2s(...r.pts[i]);if(Math.hypot(p[0]-sp[0],p[1]-sp[1])<16){commit();drag={t:'vtx',r,i};return}}}}
    const h=hitTest(w[0],w[1]);
    if(h&&(h.type==='flow'||h.type==='dim')){setSel(h.type,h.obj.id);drag={t:'movepts',o:h.obj,type:h.type,lx:w[0],ly:w[1],sx:sp[0],sy:sp[1],moved:false,orig:JSON.parse(JSON.stringify(h.obj))};return}
    if(h&&h.type!=='room'){setSel(h.type,h.obj.id);drag={t:'move',o:h.obj,type:h.type,ox:h.obj.x-w[0],oy:h.obj.y-w[1],moved:false,sx:sp[0],sy:sp[1]};return}
    if(h&&h.type==='room'){
      if(T.sel&&T.sel.id===h.obj.id){drag={t:'moveroom',r:h.obj,lx:w[0],ly:w[1],moved:false,sx:sp[0],sy:sp[1],pts:h.obj.pts.map(p=>p.slice()),grp:S.cfg.groupMove!==false?roomMembers(h.obj):null};return}
      drag={t:'taproom',r:h.obj,sx:sp[0],sy:sp[1],tx:V.tx,ty:V.ty,moved:false};return}
    drag={t:'pan',sx:sp[0],sy:sp[1],tx:V.tx,ty:V.ty,moved:false,desel:true};return}
  if(tool==='room'){const s=snapPt(w[0],w[1],snapRad());drag={t:'rect',p0:[s.x,s.y],sx:sp[0],sy:sp[1],moved:false};T.hover=s;return}
  if(tool==='bg'){
    if(T.bgLock){drag={t:'pan',sx:sp[0],sy:sp[1],tx:V.tx,ty:V.ty,moved:false,lockMsg:true};return}
    if(T.bgMode==='box'){drag={t:'bgbox',p0:w,sx:sp[0],sy:sp[1],moved:false};return}
    if(T.bgMode==='erase'){const s=snapPt(w[0],w[1],snapRad(),{noAlign:true});drag={t:'bgbox',erase:true,p0:[s.x,s.y],sx:sp[0],sy:sp[1],moved:false};return}}
  drag={t:'tap',sx:sp[0],sy:sp[1],tx:V.tx,ty:V.ty,moved:false}
});
c2.addEventListener('pointermove',e=>{
  const sp=pt(e);if(P.has(e.pointerId))P.set(e.pointerId,sp);
  if(pinch&&P.size===2){const[a,b]=[...P.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]),cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,k=clamp(pinch.s*d/pinch.d,0.5,400);
    const wx=(pinch.cx-pinch.tx)/pinch.s,wy=-(pinch.cy-pinch.ty)/pinch.s;V.s=k;V.tx=cx-wx*k;V.ty=cy+wy*k;render();return}
  if(!drag){if(e.pointerType==='mouse')hoverUpdate(sp);return}
  /* right button pressed while dragging with the left = cancel that drag */
  if(drag.t!=='pan'&&(e.buttons&2)){cancelDraw();return}
  const mv=Math.hypot(sp[0]-drag.sx,sp[1]-drag.sy);if(mv>5){drag.moved=true;drag.far=true}
  const w=s2w(sp[0],sp[1]);
  switch(drag.t){
    case'pan':case'taproom':case'tap':if(drag.moved||drag.t==='pan'&&drag.moved===true){V.tx=drag.tx+(sp[0]-drag.sx);V.ty=drag.ty+(sp[1]-drag.sy);if(T.tool!=='select')hoverUpdate(sp);render()}break;
    case'move':{if(!drag.moved)break;if(!drag.committed){commit();drag.committed=true}drag.o.x=r2(Math.round((w[0]+drag.ox)/0.05)*0.05);drag.o.y=r2(Math.round((w[1]+drag.oy)/0.05)*0.05);if(drag.type==='door'){const nw=nearWall(w[0],w[1],0.6);if(nw){drag.o.x=r2(nw.x);drag.o.y=r2(nw.y);drag.o.ang=nw.ang}}changed(true,true);break}
    case'moveroom':{if(!drag.moved)break;if(!drag.committed){commit();drag.committed=true}const[ddx,ddy]=moveSnap(drag.r,drag.pts,w[0]-drag.lx,w[1]-drag.ly);drag.r.pts=drag.pts.map(p=>[r2(p[0]+ddx),r2(p[1]+ddy)]);if(drag.grp){moveMembers(drag.grp,ddx,ddy);if(!drag.told){drag.told=true;const n=drag.grp.n;if(n.m||n.d||n.f||n.l)toast(`ย้ายพร้อม${n.m?` เครื่องจักร ${n.m}`:''}${n.d?` ประตู ${n.d}`:''}${n.f?` เส้นทาง ${n.f}`:''}${n.l?` เส้นบอกขนาด ${n.l}`:''}`)}}changed(true,true);break}
    case'vtx':{const s=vtxPt(drag.r,drag.i,w[0],w[1]);drag.r.pts[drag.i]=[s.x,s.y];T.hover=s;changed(true,true);break}
    case'rect':{const s=snapPt(w[0],w[1],snapRad());T.hover=s;T.pend=drag.p0;render();break}
    case'bgbox':{if(!drag.moved)break;let q=w;if(drag.erase){const s=snapPt(w[0],w[1],snapRad(),{noAlign:true});q=[s.x,s.y]}T.bgBox=[drag.p0,q];render();break}
    case'movepts':{if(!drag.moved)break;if(!drag.committed){commit();drag.committed=true}const dx=w[0]-drag.lx,dy=w[1]-drag.ly,mv=p=>[r2(p[0]+dx),r2(p[1]+dy)];
      if(drag.type==='flow')drag.o.pts=drag.orig.pts.map(mv);else{drag.o.a=mv(drag.orig.a);drag.o.b=mv(drag.orig.b)}changed(true,true);break}
  }
});
function endPointer(e){
  P.delete(e.pointerId);if(pinch){if(P.size<2)pinch=null;return}
  const d=drag;drag=null;if(!d)return;
  const sp=pt(e),w=s2w(sp[0],sp[1]);
  if(d.t==='pan'&&d.rmb&&!d.far){cancelDraw();return}
  if(d.t==='pan'&&!d.moved&&d.desel){setSel(null);return}
  if(d.t==='pan'&&!d.moved&&d.lockMsg){toast('พื้นหลังล็อกอยู่ กด “ปลดล็อก” ก่อนลบเส้น');return}
  if(d.t==='bgbox'&&d.erase){T.bgBox=null;if(d.moved){const s=snapPt(w[0],w[1],snapRad(),{noAlign:true});eraseBg(d.p0,[s.x,s.y])}else toast('ลากเป็นกรอบ เส้นเฉพาะส่วนที่อยู่ในกรอบจะถูกลบ');render();return}
  if(d.t==='bgbox'){T.bgBox=null;if(d.moved)hideBg(boxBg(d.p0,w));else{const h=findBg(w[0],w[1],Math.max(0.15,12/V.s));hideBg(h?[U.keys[h.k][h.i]]:[])}render();return}
  if(d.t==='taproom'&&!d.moved){setSel('room',d.r.id);return}
  if(d.t==='vtx'||d.t==='move'||d.t==='moveroom'||d.t==='movepts'){renderDock();changed(false);return}
  if(d.t==='rect'){
    const s=snapPt(w[0],w[1],snapRad());
    if(d.moved){finishRect(d.p0,[s.x,s.y]);T.pend=null}
    else{if(T.pend){finishRect(T.pend,[s.x,s.y]);T.pend=null}else{T.pend=[s.x,s.y];toast('แตะมุมตรงข้าม')}}
    render();return}
  if(d.t==='tap'&&!d.moved){tapTool(w,sp)}
}
c2.addEventListener('pointerup',endPointer);
c2.addEventListener('pointercancel',e=>{P.delete(e.pointerId);pinch=null;drag=null});
c2.addEventListener('contextmenu',e=>e.preventDefault());
c2.addEventListener('wheel',e=>{e.preventDefault();const sp=pt(e),w=s2w(sp[0],sp[1]),k=clamp(V.s*Math.exp(-e.deltaY*0.0015),0.5,400);V.s=k;V.tx=sp[0]-w[0]*k;V.ty=sp[1]+w[1]*k;render()},{passive:false});
c2.addEventListener('dblclick',e=>{if(T.tool==='poly')finishPoly();if(T.tool==='flow')finishFlow();
  if(T.tool==='select'){const sp=pt(e),w=s2w(sp[0],sp[1]);editVertexAt(w[0],w[1],sp)}});
const setMod=e=>{const f=!!(e.shiftKey||e.ctrlKey||e.metaKey);if(f!==MOD.free){MOD.free=f;return true}return false};
c2.addEventListener('pointermove',setMod,true);c2.addEventListener('pointerdown',setMod,true);

function tapTool(w,sp){
  const tool=T.tool;
  if(tool==='poly'){const s=polyPt(w[0],w[1]);
    if(T.poly.length>=3){const f=w2s(...T.poly[0]);if(Math.hypot(f[0]-sp[0],f[1]-sp[1])<16){finishPoly();return}}
    T.poly.push([s.x,s.y]);renderCtx();render();return}
  if(tool==='machine'){const g=0.05,x=r2(Math.round(w[0]/g)*g),y=r2(Math.round(w[1]/g)*g);commit();
    const n=S.machines.filter(m=>m.k===T.lib.k).length+1;
    const m={id:nextId++,k:T.lib.k,name:T.lib.n+(n>1?' '+n:''),x,y,w:T.lib.w,d:T.lib.d,h:T.lib.h,clear:T.lib.c,rot:0,col:T.lib.col};
    S.machines.push(m);setSel('machine',m.id);changed();return}
  if(tool==='door'){const nw=nearWall(w[0],w[1],Math.max(0.6,18/V.s));
    commit();const d={id:nextId++,name:'ประตู '+(S.doors.length+1),x:r2(nw?nw.x:w[0]),y:r2(nw?nw.y:w[1]),ang:nw?nw.ang:0,w:T.door.w,dbl:T.door.dbl,side:1,hinge:1};
    S.doors.push(d);setSel('door',d.id);changed();if(!nw)toast('ไม่เจอผนังใกล้ๆ วางตามแนวนอนไว้ก่อน');return}
  if(tool==='measure'){const s=snapPt(w[0],w[1],snapRad());if(T.meas.length>=2)T.meas=[];T.meas.push([s.x,s.y]);render()}
  if(tool==='flow'){const g=0.1,p=[r2(Math.round(w[0]/g)*g),r2(Math.round(w[1]/g)*g)];
    if(T.fpts.length>=2){const l=w2s(...T.fpts[T.fpts.length-1]);if(Math.hypot(l[0]-sp[0],l[1]-sp[1])<16){finishFlow();return}}
    T.fpts.push(p);renderCtx();render();return}
  if(tool==='dim'){const s=snapPt(w[0],w[1],snapRad());T.dpts.push([s.x,s.y]);
    if(T.dpts.length===2){const[a,b]=T.dpts;T.dpts=[];if(Math.hypot(b[0]-a[0],b[1]-a[1])<0.05){render();return}commit();const d={id:nextId++,a,b};S.dims.push(d);changed()}else render();return}
  if(tool==='bg'){if(T.bgLock){toast('พื้นหลังล็อกอยู่ กด “ปลดล็อก” ก่อนลบเส้น');return}const h=findBg(w[0],w[1],Math.max(0.15,12/V.s));hideBg(h?[U.keys[h.k][h.i]]:[]);return}
}
function finishFlow(){if(T.fpts.length<2){toast('ต้องมีอย่างน้อย 2 จุด');return}commit();const n=S.flows.filter(f=>f.kind===T.flow.k).length+1;
  const f={id:nextId++,kind:T.flow.k,name:'เส้นทาง'+T.flow.n+' '+n,pts:T.fpts.map(p=>p.slice())};S.flows.push(f);T.fpts=[];setSel('flow',f.id);renderCtx();changed()}
function newRoom(pts){commit();const rt=RT(T.rtype);const n=S.rooms.filter(q=>(q.type||'other')===rt.k).length+1;const r={id:nextId++,name:rt.n+' '+n,type:rt.k,grade:rt.grade,pa:rt.pa,h:S.cfg.wallH,pts};S.rooms.push(r);setSel('room',r.id);changed();return r}
function finishRect(a,b){const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),y0=Math.min(a[1],b[1]),y1=Math.max(a[1],b[1]);if(x1-x0<0.5||y1-y0<0.5){toast('ห้องเล็กเกินไป');return}newRoom([[x0,y0],[x1,y0],[x1,y1],[x0,y1]])}
function finishPoly(){if(T.poly.length<3){toast('ต้องมีอย่างน้อย 3 จุด');return}newRoom(T.poly.map(p=>p.slice()));T.poly=[];renderCtx()}

function changed(light,noDock){if(HIST.changed)HIST.changed();autosave();runChecks();renderLegend();if(!light){renderDock()}else if(!noDock){updChecksTab()}render()}
function updChecksTab(){if(T.tab==='checks')renderDock()}

/* 3D pointers */
{let d3=null;const P3=new Map();let pz=null;
c3.addEventListener('pointerdown',e=>{c3.setPointerCapture(e.pointerId);P3.set(e.pointerId,[e.clientX,e.clientY]);if(P3.size===2){const[a,b]=[...P3.values()];pz={d:Math.hypot(a[0]-b[0],a[1]-b[1]),s:V3.s};d3=null}else d3={x:e.clientX,y:e.clientY,yaw:V3.yaw,pitch:V3.pitch,px:V3.px,py:V3.py,btn:e.button}});
c3.addEventListener('pointermove',e=>{if(!P3.has(e.pointerId))return;P3.set(e.pointerId,[e.clientX,e.clientY]);
  if(pz&&P3.size===2){const[a,b]=[...P3.values()];V3.s=clamp(pz.s*Math.hypot(a[0]-b[0],a[1]-b[1])/pz.d,1,200);render();return}
  if(!d3)return;const dx=e.clientX-d3.x,dy=e.clientY-d3.y;
  if(d3.btn===2||e.shiftKey){V3.px=d3.px+dx;V3.py=d3.py+dy}else{V3.yaw=d3.yaw+dx*0.008;V3.pitch=clamp(d3.pitch+dy*0.006,0.15,1.5)}render()});
const up=e=>{P3.delete(e.pointerId);if(P3.size<2)pz=null;if(!P3.size)d3=null};
c3.addEventListener('pointerup',up);c3.addEventListener('pointercancel',up);c3.addEventListener('contextmenu',e=>e.preventDefault());
c3.addEventListener('wheel',e=>{e.preventDefault();V3.s=clamp(V3.s*Math.exp(-e.deltaY*0.0015),1,200);render()},{passive:false})}

let lastSp=null;c2.addEventListener('pointermove',e=>{if(e.pointerType==='mouse')lastSp=pt(e)});
const modKey=e=>{if(setMod(e)&&lastSp&&!drag)hoverUpdate(lastSp)};
window.addEventListener('keyup',modKey);
window.addEventListener('keydown',e=>{
  modKey(e);
  /* use e.code (physical key) so shortcuts work with the Thai keyboard layout too (Z gives 'ผ' there) */
  const ck=e.ctrlKey||e.metaKey,isZ=e.code==='KeyZ'||e.key.toLowerCase()==='z',isY=e.code==='KeyY'||e.key.toLowerCase()==='y';
  const inField=e.target.closest&&e.target.closest('input,select,textarea');
  /* in the side-panel fields the edit is already in app history (commit on first keystroke): undo that, not the browser's text undo */
  if(ck&&(isZ||isY)&&inField&&!e.target.closest('#pane'))return;
  if(ck&&isZ){e.preventDefault();if(inField)inField.blur();e.shiftKey?doRedo():doUndo();return}
  if(ck&&isY){e.preventDefault();if(inField)inField.blur();doRedo();return}
  if(inField)return;
  if(e.key==='Escape'){if(!cancelDraw()){setSel(null);renderCtx();render()}}
  if(e.key==='Enter'&&T.tool==='flow')finishFlow();
  if(e.key==='Enter'&&T.tool==='poly')finishPoly();
  if((e.key==='Delete'||e.key==='Backspace')&&T.sel)delSel();
  if((e.code==='KeyR'||e.key.toLowerCase()==='r')&&!ck&&T.sel&&T.sel.type==='machine')rotSel();
});

/* ====================== editing actions ====================== */
function delSel(){const o=getSel();if(!o)return;commit();const k=LK[T.sel.type];S[k]=S[k].filter(q=>q.id!==o.id);T.sel=null;changed();toast(`ลบ “${o.name||'รายการ'}” แล้ว · กด Ctrl+Z เพื่อเอาคืน`)}
/* room width (axis 0, x) / length (axis 1, y): the far edge moves, the near (left/bottom) edge stays */
function roomSize(r){const xs=r.pts.map(p=>p[0]),ys=r.pts.map(p=>p[1]);return[Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]}
function resizeRoom(r,ax,val){val=r2(val);const cs=r.pts.map(p=>p[ax]),lo=Math.min(...cs),hi=Math.max(...cs),nh=r2(lo+val);
  if(val<0.3){toast('ขนาดต้องอย่างน้อย 0.3 ม.');return false}
  if(Math.abs(nh-hi)<1e-9)return true;
  if(r.pts.some(p=>Math.abs(p[ax]-hi)>1e-6&&p[ax]>=nh-0.05)){toast('ย่อเท่านี้ไม่ได้ จะทับมุมด้านในของห้อง ให้ลากมุมแทน');return false}
  commit();for(const p of r.pts)if(Math.abs(p[ax]-hi)<=1e-6)p[ax]=nh;changed();return true}
/* cancel what is being drawn or dragged (right-click, or Esc) */
function cancelDraw(){let did=false;const d=drag;
  if(d&&['rect','vtx','move','moveroom','movepts','bgbox'].includes(d.t)){drag=null;did=true;
    if(d.t==='vtx'||d.committed){const sel=T.sel;revertLast();if(sel&&getSelBy(sel))setSel(sel.type,sel.id)}}
  if(T.poly.length||T.pend||T.meas.length||T.fpts.length||T.dpts.length||T.bgBox)did=true;
  T.poly=[];T.pend=null;T.meas=[];T.fpts=[];T.dpts=[];T.bgBox=null;
  if(did){renderCtx();render();toast('ยกเลิกแล้ว')}return did}
const getSelBy=s=>(S[LK[s.type]]||[]).find(o=>o.id===s.id);
function rotSel(){const o=getSel();if(!o||T.sel.type!=='machine')return;commit();o.rot=((o.rot||0)+90)%360;changed()}
function dupSel(){const o=getSel();if(!o||!(T.sel.type==='machine'||T.sel.type==='door'))return;commit();const c=JSON.parse(JSON.stringify(o));c.id=nextId++;if(c.x!=null){c.x=r2(c.x+1);c.y=r2(c.y+1)}(T.sel.type==='machine'?S.machines:S.doors).push(c);setSel(T.sel.type,c.id);changed()}

/* ====================== UI: tools / ctx / dock ====================== */
const TOOLS=[['select','เลือก/ย้าย'],['room','ห้อง ▭'],['poly','ห้อง ⬠'],['machine','เครื่องจักร'],['door','ประตู'],['flow','เส้นทางไหล'],['dim','บอกขนาด'],['measure','วัดระยะ'],['|'],['bg','แก้พื้นหลัง'],['snap','ดูดติด']];
function renderTools(){
  $('#tools').innerHTML=TOOLS.map(([k,n])=>k==='|'?'<span class="gap"></span>':`<button data-tool="${k}" aria-pressed="${k==='snap'?T.snap:T.tool===k}">${n}</button>`).join('');
}
function renderCtx(){
  const c=$('#ctx');let h='';
  if(T.view==='3d'){h=`<span class="hint">ลากเพื่อหมุน · บีบเพื่อซูม · คลิกขวาลากเพื่อเลื่อน</span><button class="chip" data-c3="pa" aria-pressed="${S.cfg.colorBy==='pa'}">สีตามความดัน</button><button class="chip" data-c3="grade" aria-pressed="${S.cfg.colorBy==='grade'}">สีตามเกรด</button><button class="chip" data-c3="under" aria-pressed="${V3.under}">แสดงผนังเดิม</button>`}
  else if(T.tool==='machine')h=LIB.map(l=>`<button class="chip" data-lib="${l.k}" aria-pressed="${T.lib.k===l.k}">${esc(l.n)}</button>`).join('');
  else if(T.tool==='door')h=DOORS.map(l=>`<button class="chip" data-door="${l.k}" aria-pressed="${T.door.k===l.k}">${esc(l.n)}</button>`).join('')+'<span class="hint">แตะที่ผนัง บานจะวางตามแนวผนังให้</span>';
  else if(T.tool==='room'||T.tool==='poly'){
    const rt=RTYPES.map(t=>`<button class="chip" data-rtype="${t.k}" aria-pressed="${T.rtype===t.k}">${esc(t.n)} · ${t.pa}</button>`).join('');
    h=(T.tool==='room'?'<span class="hint">ลากเป็นสี่เหลี่ยม หรือแตะ 2 มุม · ขอบจะเรียงแนวกับมุมห้องอื่นให้ (เส้นประแดง) · Shift ค้าง = ไม่ดูด · คลิกขวา/Esc = ยกเลิก · ประเภท:</span>':`<button class="chip go" data-act="polydone">เสร็จ (${T.poly.length} จุด)</button><button class="chip" data-act="polyundo">ลบจุดล่าสุด</button><span class="hint">แตะทีละมุม เส้นเกือบตรงจะล็อกฉากให้ (⟂) · Shift ค้าง = ไม่ดูด วางอิสระ · คลิกขวา/Esc = ยกเลิก · ประเภท:</span>`)+rt}
  else if(T.tool==='flow')h=FLOWS.map(f=>`<button class="chip" data-flow="${f.k}" aria-pressed="${T.flow.k===f.k}"><span class="sw" style="background:${f.col}"></span>${esc(f.n)}</button>`).join('')+`<button class="chip go" data-act="flowdone">เสร็จ (${T.fpts.length} จุด)</button><button class="chip" data-act="flowundo">ลบจุดล่าสุด</button><span class="hint">แตะทีละจุดตามทางเดิน แตะจุดสุดท้ายซ้ำเพื่อจบ</span>`;
  else if(T.tool==='dim')h='<span class="hint">แตะ 2 จุดเพื่อเขียนเส้นบอกขนาด (มม.) ค้างไว้บนแบบ</span>';
  else if(T.tool==='bg')h=`<button class="chip${T.bgLock?'':' go'}" data-act="bglock">${T.bgLock?'🔒 ล็อกอยู่ · แตะเพื่อปลดล็อก':'🔓 ปลดล็อกแล้ว · แตะเพื่อล็อก'}</button>`
    +`<button class="chip" data-act="bgmode" data-v="tap" aria-pressed="${T.bgMode==='tap'}">แตะลบทีละเส้น</button><button class="chip" data-act="bgmode" data-v="box" aria-pressed="${T.bgMode==='box'}">ลากกรอบลบทั้งเส้น</button><button class="chip" data-act="bgmode" data-v="erase" aria-pressed="${T.bgMode==='erase'}">🧽 ยางลบ</button>`
    +(T.bgMode==='box'&&!U.grid?`<button class="chip" data-act="bgtile" aria-pressed="${T.bgTile}">รวมเส้นตาราง</button>`:'')
    +(T.bgMode==='erase'?'<span class="hint">ลากกรอบ: ตัดเฉพาะส่วนของเส้นที่อยู่ในกรอบ (เช่น ผนังที่จะทุบ) มุมกรอบดูดติดตาราง/ผนัง · ตาราง 1 ม. ไม่ถูกลบ</span>':'')
    +`<span class="hint">ลบไปแล้ว ${S.bgHidden.length} เส้น${S.bgErase.length?` · ยางลบ ${S.bgErase.length} กรอบ`:''}</span>`+(S.bgHidden.length||S.bgErase.length?'<button class="chip" data-act="bgrestore">คืนเส้นทั้งหมด</button>':'');
  else if(T.tool==='measure')h='<span class="hint">แตะ 2 จุดเพื่อวัดระยะ</span>';
  else h=`<button class="chip" data-act="group" aria-pressed="${S.cfg.groupMove!==false}">🔗 ย้ายห้องพร้อมของข้างใน</button>`+'<span class="hint">แตะวัตถุเพื่อเลือก ลากเครื่องจักรหรือประตูเพื่อย้าย ลากพื้นที่ว่างเพื่อเลื่อนแบบ · ดับเบิลคลิกขอบห้อง = เพิ่มมุม · ดับเบิลคลิกมุม = ลบมุม</span>';
  c.innerHTML=h;
}
function renderLegend(){
  let items;
  if(S.cfg.colorBy==='grade')items=GRADES.map(g=>[GCOL[g],g==='ไม่จัดเกรด'?g:'เกรด '+g]);
  else items=[['#e8590c','ลบ (−Pa)'],['#7a8594','0 Pa'],['#0c8f82','1–15 Pa'],['#3b5bdb','16–30 Pa'],['#9c36b5','>30 Pa']];
  const used=FLOWS.filter(f=>S.flows.some(x=>x.kind===f.k));
  $('#legend').innerHTML=items.map(([c,n])=>`<span><i style="background:${c}"></i>${esc(n)}</span>`).join('')+used.map(f=>`<span><i style="background:${f.col};height:4px;width:16px;vertical-align:2px"></i>${esc(f.n)}</span>`).join('');
}
function areaOf(r){return Math.abs(polyArea(r.pts))}
function renderDock(){
  const tabs=[...document.querySelectorAll('#tabs button')];tabs.forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===T.tab));
  const p=$('#pane');let h='';
  if(T.tab==='props')h=propsHTML();
  else if(T.tab==='layers')h=layersHTML();
  else if(T.tab==='checks')h=checksHTML();
  else if(T.tab==='sum')h=sumHTML();
  else h=listHTML();
  p.innerHTML=h;
}
function propsHTML(){
  const o=getSel();
  if(!o){
    if(!U.loaded)return `<p style="margin-top:0">ยังไม่ได้เปิดแบบพื้นหลัง เปิดไฟล์ .layout.json ที่ได้รับมา หรือเปิดไฟล์งาน .json ที่บันทึกไว้ (มีแบบพื้นหลังอยู่ในไฟล์)</p>
      <div class="row"><button class="btn pri" data-act="lay-open">เปิดแบบพื้นหลัง…</button></div>`;
    return `<p class="muted" style="margin-top:0">ยังไม่ได้เลือกอะไร เริ่มจากเลือกเครื่องมือ “ห้อง” เลือกประเภทห้อง แล้ววาดทับแบบพื้นหลัง จากนั้นเพิ่มประตู เครื่องจักร และเส้นทางไหล แบบพื้นหลังถูกล็อกไว้ ถ้าจะลบเส้นผนังหรือประตูเดิม ใช้เครื่องมือ “แก้พื้นหลัง”</p>
    <h3>ค่ากฎตรวจ (แก้ได้)</h3><div class="f">
    <label>ทางเดินขั้นต่ำระหว่างเครื่อง (ม.)<input type="number" step="0.1" min="0" data-cfg="minAisle" value="${S.cfg.minAisle}"></label>
    <label>ความดันต่างขั้นต่ำเมื่อต่างเกรด (Pa)<input type="number" step="1" min="0" data-cfg="minDP" value="${S.cfg.minDP}"></label>
    <label>ความสูงผนังห้องใหม่ (ม.)<input type="number" step="0.1" min="2" data-cfg="wallH" value="${S.cfg.wallH}"></label></div>
    <p class="muted">ค่าตั้งต้นเป็นแนวทั่วไป ไม่ใช่ข้อกำหนดทางกฎหมาย ให้ปรับตามมาตรฐาน GMP และผู้ออกแบบของโครงการ</p>`}
  const t=T.sel.type;
  if(t==='room')return `<h3>ห้อง</h3><div class="f">
    <label class="w">ชื่อห้อง<input id="p-name" data-p="name" value="${esc(o.name)}"></label>
    <label class="w">ประเภทห้อง (เปลี่ยนแล้วตั้งเกรด/ความดันตามประเภท)<select data-p="type">${RTYPES.map(t=>`<option value="${t.k}" ${t.k===(o.type||'other')?'selected':''}>${esc(t.n)} · ${t.grade} · ${t.pa} Pa</option>`).join('')}</select></label>
    <label>เกรดความสะอาด<select data-p="grade">${GRADES.map(g=>`<option ${g===o.grade?'selected':''}>${g}</option>`).join('')}</select></label>
    <label>ความดัน (Pa)<input type="number" step="1" data-p="pa" value="${o.pa}"></label>
    <label>ความสูงผนัง (ม.)<input type="number" step="0.1" min="2" data-p="h" value="${o.h}"></label>
    <label>กว้าง ↔ (ม.)<input type="number" step="0.1" min="0.3" data-dim="0" value="${fmt(roomSize(o)[0],2)}"></label>
    <label>ยาว ↕ (ม.)<input type="number" step="0.1" min="0.3" data-dim="1" value="${fmt(roomSize(o)[1],2)}"></label>
    <label>พื้นที่ (ตร.ม.)<input readonly value="${fmt(areaOf(o),1)}"></label>
    <label>ปริมาตร (ลบ.ม.)<input readonly value="${fmt(areaOf(o)*(+o.h||0),1)}"></label></div>
    <div class="pa">${PA_PRESETS.map(v=>`<button data-act="pa" data-v="${v}">${v} Pa</button>`).join('')}</div>
    <div class="row"><button class="btn dng" data-act="del">ลบห้อง</button></div>
    <p class="muted">พิมพ์กว้าง/ยาวแล้วกด Enter: มุมซ้ายล่างอยู่ที่เดิม ขยายไปทางขวา/ขึ้นบน · ลากจุดวงกลมที่มุมเพื่อปรับรูปทรง · ลากในห้องเพื่อย้ายทั้งห้อง (เปิด 🔗 ที่แถบบน = เครื่องจักร ประตู เส้นทางในห้องย้ายตามด้วย) · เผลอลบหรือแก้ผิด กด Ctrl+Z</p>`;
  if(t==='machine')return `<h3>เครื่องจักร</h3><div class="f">
    <label class="w">ชื่อ<input data-p="name" value="${esc(o.name)}"></label>
    <label>กว้าง (ม.)<input type="number" step="0.05" min="0.1" data-p="w" value="${o.w}"></label>
    <label>ลึก (ม.)<input type="number" step="0.05" min="0.1" data-p="d" value="${o.d}"></label>
    <label>สูง (ม.)<input type="number" step="0.1" min="0.1" data-p="h" value="${o.h}"></label>
    <label>ระยะเว้นบริการ (ม.)<input type="number" step="0.1" min="0" data-p="clear" value="${o.clear}"></label>
    <label>หมุน (องศา)<input type="number" step="15" data-p="rot" value="${o.rot||0}"></label></div>
    <div class="row"><button class="btn" data-act="rot">หมุน 90°</button><button class="btn" data-act="dup">คัดลอก</button><button class="btn dng" data-act="del">ลบ</button></div>
    <p class="muted">ขนาดเป็นค่าสมมติ ให้แก้ตามแคตตาล็อกของผู้ผลิตเครื่องที่เลือก</p>`;
  if(t==='flow'){const F=FL(o.kind);let L=0;for(let i=0;i+1<o.pts.length;i++)L+=Math.hypot(o.pts[i+1][0]-o.pts[i][0],o.pts[i+1][1]-o.pts[i][1]);
    return `<h3>เส้นทางไหล</h3><div class="f">
    <label class="w">ชื่อ<input data-p="name" value="${esc(o.name)}"></label>
    <label>ชนิด<select data-p="kind">${FLOWS.map(f=>`<option value="${f.k}" ${f.k===o.kind?'selected':''}>${esc(f.n)}</option>`).join('')}</select></label>
    <label>ระยะทาง (ม.)<input readonly value="${fmt(L,1)}"></label></div>
    <div class="row"><button class="btn" data-act="rev">กลับทิศ</button><button class="btn dng" data-act="del">ลบ</button></div>
    <p class="muted">${F.side==='d'?'เส้นประ = ฝั่งสกปรก โปรแกรมจะเตือนถ้าตัดกับเส้นทางฝั่งสะอาด':F.side==='c'?'ฝั่งสะอาด โปรแกรมจะเตือนถ้าตัดกับเส้นทางของเสียหรืออุปกรณ์สกปรก':'เส้นทางคน'} และเตือนถ้าเส้นทางผ่านผนังห้องตรงที่ไม่มีประตู ลากเพื่อย้ายทั้งเส้น</p>`}
  if(t==='dim'){const L=Math.hypot(o.b[0]-o.a[0],o.b[1]-o.a[1]);return `<h3>เส้นบอกขนาด</h3><div class="f"><label>ความยาว (มม.)<input readonly value="${Math.round(L*1000)}"></label></div>
    <div class="row"><button class="btn dng" data-act="del">ลบ</button></div><p class="muted">ลากเพื่อย้าย ส่งออกไปกับ DXF ด้วย</p>`}
  return `<h3>ประตู</h3><div class="f">
    <label class="w">ชื่อ<input data-p="name" value="${esc(o.name||'')}"></label>
    <label>กว้าง (ม.)<input type="number" step="0.05" min="0.6" data-p="w" value="${o.w}"></label>
    <label>แบบ<select data-p="dbl"><option value="0" ${o.dbl?'':'selected'}>บานเดี่ยว</option><option value="1" ${o.dbl?'selected':''}>บานคู่</option></select></label>
    <label class="lay w" style="flex-direction:row"><input type="checkbox" data-p="interlock" ${o.interlock?'checked':''}><span>Interlock (ห้ามเปิดพร้อมบานอื่นของ airlock)</span></label></div>
    <div class="row"><button class="btn" data-act="flip">พลิกทิศเปิด</button>${o.dbl?'':'<button class="btn" data-act="hinge">สลับบานพับ</button>'}<button class="btn" data-act="dup">คัดลอก</button><button class="btn dng" data-act="del">ลบ</button></div>
    <p class="muted">ปกติให้บานเปิดเข้าด้านห้องที่ความดันสูงกว่า โปรแกรมจะเตือนถ้าตั้งสวนทาง · ลบ: คลิกที่บานหรือวงสวิงของประตูแล้วกด Delete หรือปุ่ม ลบ (Ctrl+Z เอาคืน)</p>`;
}
function layoutsHTML(){
  const A=getLayouts(),ids=Object.keys(A).sort((a,b)=>A[b].ts-A[a].ts),m=U.meta||{};
  return `<h3 style="margin-top:0">แบบพื้นหลัง</h3>
  <p style="margin:4px 0">${U.loaded?`<b>${esc(U.name)}</b>${m.floor?' · ชั้น '+esc(m.floor):''}${m.created?' · '+esc(m.created):''}${m.note?`<br><span class="muted">${esc(m.note)}</span>`:''}`:'<span class="muted">ยังไม่ได้เปิด</span>'}</p>
  <div class="row"><button class="btn pri" data-act="lay-open">เปิดไฟล์แบบพื้นหลัง (.layout.json)…</button></div>
  ${ids.filter(i=>i!==U.id).length?`<p class="muted" style="margin:6px 0 2px">แบบที่เคยเปิดในเครื่องนี้</p><table>${ids.filter(i=>i!==U.id).map(i=>`<tr><td>${esc(A[i].name)}<br><span class="muted">${fdate(A[i].ts)}</span></td><td style="text-align:right;white-space:nowrap"><button class="btn" data-act="lay-use" data-id="${esc(i)}">ใช้แบบนี้</button> <button class="btn dng" data-act="lay-del" data-id="${esc(i)}">ลบ</button></td></tr>`).join('')}</table>`:''}
  <p class="muted">เปลี่ยนแบบแล้ว ห้อง เครื่องจักร และประตูที่วางไว้ยังอยู่ ถ้าแบบใหม่มาจาก DWG พิกัดเดียวกัน จะอยู่ตรงตำแหน่งเดิม</p>`}
function layersHTML(){
  if(!U.loaded)return layoutsHTML();
  const names=Object.keys(U.paths).sort((a,b)=>U.cnt[b]-U.cnt[a]);
  return layoutsHTML()+`<h3>เลเยอร์</h3>${S.bgHidden.length||S.bgErase.length?`<div class="row"><span class="muted">ลบเส้นพื้นหลังไปแล้ว ${S.bgHidden.length} เส้น${S.bgErase.length?` · ยางลบ ${S.bgErase.length} กรอบ`:''}</span><button class="btn" data-act="bgrestore2">คืนทั้งหมด</button></div>`:''}<div class="row"><button class="btn" data-act="lay-walls">เฉพาะผนังและเสา</button><button class="btn" data-act="lay-def">ค่าตั้งต้น</button><button class="btn" data-act="lay-all">ทั้งหมด</button></div>
  <label class="muted">ความเข้มของแบบพื้นหลัง<input type="range" min="0.1" max="1" step="0.05" value="${U.alpha}" data-alpha></label>
  <label class="lay"><input type="checkbox" data-txt ${U.showText?'checked':''}><span>แสดงข้อความในแบบ</span></label>
  ${names.map(n=>`<label class="lay"><input type="checkbox" data-lay="${esc(n)}" ${U.vis[n]?'checked':''}><span>${esc(n)}</span><span class="c">${U.cnt[n]}</span></label>`).join('')}`;
}
function checksHTML(){
  if(!S.rooms.length&&!S.machines.length)return'<p class="muted">ยังไม่มีอะไรให้ตรวจ วาดห้องและวางเครื่องก่อน</p>';
  if(!T.checks.length)return'<div class="ok">ผ่านทุกข้อที่ตรวจ ทางเดิน ระยะบริการ ประตูชน และความดันข้ามห้อง</div>';
  const lab={err:'ผิดพลาด',warn:'เตือน',info:'ข้อสังเกต'};
  return T.checks.map((c,i)=>`<button class="item ${c.sev}" data-chk="${i}"><b>${lab[c.sev]}</b><span>${esc(c.msg)}</span></button>`).join('');
}
function sumHTML(){
  const by={};for(const r of S.rooms){const a=areaOf(r),v=a*(+r.h||S.cfg.wallH),g=r.grade;by[g]=by[g]||{n:0,a:0,v:0};by[g].n++;by[g].a+=a;by[g].v+=v}
  const gs=GRADES.filter(g=>by[g]);let ta=0,tq=0;
  const rows=gs.map(g=>{const x=by[g],ach=+S.cfg.ach[g]||0,q=x.v*ach;ta+=x.a;tq+=q;
    return`<tr><td><span class="sw" style="background:${GCOL[g]}"></span>${esc(g)}</td><td class="n">${x.n}</td><td class="n">${fmt(x.a,1)}</td><td class="n"><input type="number" min="0" step="1" data-ach="${esc(g)}" value="${ach}" style="width:56px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);padding:2px 4px;font:12px var(--mono);text-align:right"></td><td class="n">${Math.round(q).toLocaleString()}</td></tr>`}).join('');
  const spec=gs.map(g=>`<label class="w">${esc(g)}<input data-spec="${esc(g)}" value="${esc(S.cfg.spec[g]||'')}" placeholder="เช่น 22±2 °C · 50±10 %RH"></label>`).join('');
  const pr=T.pairs.map(p=>{const hi=(+p.a.pa||0)>=(+p.b.pa||0)?p.a:p.b,lo=hi===p.a?p.b:p.a,dp=(+hi.pa||0)-(+lo.pa||0);
    return`<tr><td>${esc(hi.name)} <span class="muted">${hi.pa}</span></td><td>→ ${esc(lo.name)} <span class="muted">${lo.pa}</span></td><td class="n" style="${dp===0?'color:var(--warn)':''}">${dp}</td></tr>`}).join('');
  const fl=FLOWS.map(f=>[f,S.flows.filter(x=>x.kind===f.k).length]).filter(x=>x[1]).map(([f,n])=>`<span style="margin-right:10px"><span class="sw" style="background:${f.col}"></span>${esc(f.n)} ${n}</span>`).join('');
  return `<h3 style="margin-top:0">พื้นที่ห้องสะอาดตามเกรด</h3>
  ${gs.length?`<table><tr><th>เกรด</th><th class="n">ห้อง</th><th class="n">ตร.ม.</th><th class="n">ACH</th><th class="n">ลม m³/ชม.</th></tr>${rows}<tr><td><b>รวม</b></td><td></td><td class="n"><b>${fmt(ta,1)}</b></td><td></td><td class="n"><b>${Math.round(tq).toLocaleString()}</b></td></tr></table>
  <p class="muted">ลม = ปริมาตรห้อง × ACH เป็นตัวเลขประมาณการเบื้องต้นสำหรับคุยกับผู้ออกแบบ HVAC ค่า ACH ตั้งต้นแก้ได้ ไม่ใช่ข้อกำหนด</p>`:'<p class="muted">ยังไม่มีห้อง</p>'}
  ${gs.length?`<h3>สภาวะห้อง (ใส่ในตารางแบบ)</h3><div class="f">${spec}</div>`:''}
  <h3>ความดันข้ามประตู (สูง → ต่ำ, Pa)</h3>
  ${pr?`<table><tr><th>ด้านสูง</th><th>ด้านต่ำ</th><th class="n">ΔP</th></tr>${pr}</table>`:'<p class="muted">ยังไม่มีประตูที่อยู่ระหว่าง 2 ห้อง</p>'}
  <h3>เส้นทางไหล</h3>${fl?`<p>${fl}</p>`:'<p class="muted">ยังไม่มี ใช้เครื่องมือ “เส้นทางไหล” วาดเส้นทางคน วัตถุดิบ ผลิตภัณฑ์ อุปกรณ์ และของเสีย</p>'}`}
function listHTML(){
  const rooms=S.rooms.map(r=>`<tr><td>${esc(r.name)}<br><span class="muted">${esc(RT(r.type).n)}</span></td><td>${esc(r.grade)}</td><td class="n">${r.pa}</td><td class="n">${fmt(areaOf(r),1)}</td></tr>`).join('');
  const tot=S.rooms.reduce((a,r)=>a+areaOf(r),0);
  const mach=S.machines.map(m=>{const rm=roomAt(m.x,m.y);return`<tr><td>${esc(m.name)}</td><td>${rm?esc(rm.name):'-'}</td><td class="n">${fmt(m.w)}×${fmt(m.d)}</td></tr>`}).join('');
  return `<h3>ห้อง (${S.rooms.length})</h3>${S.rooms.length?`<table><tr><th>ชื่อ</th><th>เกรด</th><th class="n">Pa</th><th class="n">ตร.ม.</th></tr>${rooms}<tr><td colspan="3"><b>รวม</b></td><td class="n"><b>${fmt(tot,1)}</b></td></tr></table>`:'<p class="muted">ยังไม่มีห้อง</p>'}
  <h3>เครื่องจักร (${S.machines.length})</h3>${S.machines.length?`<table><tr><th>ชื่อ</th><th>อยู่ในห้อง</th><th class="n">ม.</th></tr>${mach}</table>`:'<p class="muted">ยังไม่มีเครื่องจักร</p>'}
  <h3>ประตู: ${S.doors.length} · เส้นทางไหล: ${S.flows.length} · เส้นบอกขนาด: ${S.dims.length}</h3>`;
}

/* dock events */
$('#pane').addEventListener('input',e=>{
  const t=e.target;
  if(t.dataset.cfg){if(!t._c){commit();t._c=true}S.cfg[t.dataset.cfg]=+t.value||0;changed(true,true);return}
  if(t.dataset.p){const o=getSel();if(!o)return;if(!t._c){commit();t._c=true}
    let v=t.type==='checkbox'?t.checked:t.value;if(t.type==='number'){v=parseFloat(v);if(isNaN(v))return}
    if(t.dataset.p==='dbl'){o.dbl=v==='1'}
    else if(t.dataset.p==='type'){o.type=v;const rt=RT(v);o.grade=rt.grade;o.pa=rt.pa}
    else o[t.dataset.p]=v;
    changed(true,true);return}
  if(t.dataset.ach){if(!t._c){commit();t._c=true}S.cfg.ach[t.dataset.ach]=+t.value||0;autosave();return}
  if(t.dataset.spec){if(!t._c){commit();t._c=true}S.cfg.spec[t.dataset.spec]=t.value;autosave();return}
  if(t.dataset.alpha!==undefined){U.alpha=+t.value;render();return}
  if(t.dataset.lay){U.vis[t.dataset.lay]=t.checked;render();return}
  if(t.dataset.txt!==undefined){U.showText=t.checked;render()}
});
$('#pane').addEventListener('change',e=>{const t=e.target;
  if(t.dataset.dim!==undefined){const o=getSel();if(o&&T.sel.type==='room'){const v=parseFloat(t.value);if(!isNaN(v))resizeRoom(o,+t.dataset.dim,v)}renderDock();return}if(t.dataset.p&&['grade','dbl','type','kind'].includes(t.dataset.p)){renderDock()}if(t.dataset.ach){renderDock()}});
$('#pane').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.chk!==undefined){const c=T.checks[+b.dataset.chk];if(c.at){const w=w2s(c.at[0],c.at[1]);if(T.view==='2d'&&(w[0]<0||w[0]>V.w||w[1]<0||w[1]>V.h)){V.tx+=V.w/2-w[0];V.ty+=V.h/2-w[1]}}
    if(c.sel){T.sel={type:c.sel.type,id:c.sel.id}}render();return}
  const a=b.dataset.act;if(!a)return;
  const o=getSel();
  if(a==='del')delSel();
  else if(a==='rot')rotSel();
  else if(a==='dup')dupSel();
  else if(a==='pa'&&o){commit();o.pa=+b.dataset.v;changed()}
  else if(a==='flip'&&o){commit();o.side=-(o.side||1);changed()}
  else if(a==='hinge'&&o){commit();o.hinge=-(o.hinge||1);changed()}
  else if(a==='rev'&&o&&o.pts){commit();o.pts.reverse();changed()}
  else if(a==='lay-walls'){for(const k in U.vis)U.vis[k]=[...U.wallL,'COL','01COL'].includes(k);renderDock();render()}
  else if(a==='lay-def'){for(const k in U.vis)U.vis[k]=U.defVis.includes(k);renderDock();render()}
  else if(a==='lay-open'){$('#lfile').click()}
  else if(a==='lay-use'){const x=getLayouts()[b.dataset.id];if(x)useLayout(x.data)}
  else if(a==='lay-del'){const A=getLayouts();delete A[b.dataset.id];try{localStorage.setItem(LKEY,JSON.stringify(A))}catch(e){}renderDock()}
  else if(a==='bgrestore2'){commit();S.bgHidden=[];S.bgErase=[];rebuildUnderlay();changed();renderCtx()}
  else if(a==='lay-all'){for(const k in U.vis)U.vis[k]=true;renderDock();render()}
});
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const dock=$('#dock');
  if(T.tab===b.dataset.tab&&window.innerWidth<900)dock.classList.toggle('collapsed');else dock.classList.remove('collapsed');
  T.tab=b.dataset.tab;renderDock();resizeSoon()});
$('#tools').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const k=b.dataset.tool;
  if(k==='snap'){T.snap=!T.snap;renderTools();return}
  T.tool=k;T.poly=[];T.pend=null;T.meas=[];T.hover=null;T.fpts=[];T.dpts=[];T.bgHover=null;T.bgBox=null;if(T.view==='3d')setView('2d');renderTools();renderCtx();render()});
$('#ctx').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.lib){T.lib=LIB.find(l=>l.k===b.dataset.lib);renderCtx();render()}
  else if(b.dataset.door){T.door=DOORS.find(l=>l.k===b.dataset.door);renderCtx();render()}
  else if(b.dataset.rtype){T.rtype=b.dataset.rtype;renderCtx()}
  else if(b.dataset.flow){T.flow=FL(b.dataset.flow);renderCtx();render()}
  else if(b.dataset.act==='flowdone')finishFlow();
  else if(b.dataset.act==='flowundo'){T.fpts.pop();renderCtx();render()}
  else if(b.dataset.act==='group'){S.cfg.groupMove=S.cfg.groupMove===false;autosave();renderCtx();toast(S.cfg.groupMove?'ย้ายห้อง: เครื่องจักร ประตู เส้นทาง ในห้องย้ายตามไปด้วย':'ย้ายห้อง: ย้ายแค่ห้อง ของข้างในอยู่ที่เดิม')}
  else if(b.dataset.act==='bglock'){T.bgLock=!T.bgLock;T.bgHover=null;renderCtx();render()}
  else if(b.dataset.act==='bgmode'){T.bgMode=b.dataset.v;T.bgHover=null;renderCtx();render()}
  else if(b.dataset.act==='bgtile'){T.bgTile=!T.bgTile;renderCtx()}
  else if(b.dataset.act==='bgrestore'){if(!S.bgHidden.length&&!S.bgErase.length)return;commit();S.bgHidden=[];S.bgErase=[];rebuildUnderlay();changed();renderCtx();toast('คืนเส้นพื้นหลังทั้งหมดแล้ว')}
  else if(b.dataset.act==='polydone')finishPoly();
  else if(b.dataset.act==='polyundo'){T.poly.pop();renderCtx();render()}
  else if(b.dataset.c3){if(b.dataset.c3==='under')V3.under=!V3.under;else S.cfg.colorBy=b.dataset.c3;renderCtx();renderLegend();render()}});
function resizeSoon(){setTimeout(resize,30)}
function setView(v){T.view=v;$('#v2').setAttribute('aria-pressed',v==='2d');$('#v3').setAttribute('aria-pressed',v==='3d');
  c2.style.display=v==='2d'?'block':'none';c3.style.display=v==='3d'?'block':'none';renderCtx();render()}
$('#v2').onclick=()=>setView('2d');$('#v3').onclick=()=>setView('3d');
$('#undo').onclick=doUndo;$('#redo').onclick=doRedo;
$('#zin').onclick=()=>zoomBy(1.4);$('#zout').onclick=()=>zoomBy(1/1.4);$('#fit').onclick=()=>{if(T.view==='2d')fitView();else{V3.px=V3.py=0;fitView()}};
function zoomBy(k){if(T.view==='3d'){V3.s=clamp(V3.s*k,1,200);render();return}const w=s2w(V.w/2,V.h/2);V.s=clamp(V.s*k,0.5,400);V.tx=V.w/2-w[0]*V.s;V.ty=V.h/2+w[1]*V.s;render()}

/* ====================== export ====================== */
function dxfStr(){
  const [ox,oy]=U.origin;const L=[];const g=(c,v)=>L.push(String(c),String(v));
  const enc=s=>String(s).replace(/[^\x20-\x7e]/g,ch=>'\\U+'+ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
  const layers=[['PH-ROOM',5],['PH-ROOM-TEXT',7],['PH-MACHINE',5],['PH-CLEARANCE',3],['PH-DOOR',1],['PH-FLOW',4],['PH-DIM',3]];
  g(0,'SECTION');g(2,'HEADER');g(9,'$ACADVER');g(1,'AC1009');g(0,'ENDSEC');
  g(0,'SECTION');g(2,'TABLES');
  g(0,'TABLE');g(2,'LTYPE');g(70,1);g(0,'LTYPE');g(2,'CONTINUOUS');g(70,0);g(3,'Solid line');g(72,65);g(73,0);g(40,0);g(0,'ENDTAB');
  g(0,'TABLE');g(2,'LAYER');g(70,layers.length);for(const[n,c]of layers){g(0,'LAYER');g(2,n);g(70,0);g(62,c);g(6,'CONTINUOUS')}g(0,'ENDTAB');
  g(0,'ENDSEC');g(0,'SECTION');g(2,'ENTITIES');
  const line=(ly,a,b)=>{g(0,'LINE');g(8,ly);g(10,r2(a[0]+ox));g(20,r2(a[1]+oy));g(30,0);g(11,r2(b[0]+ox));g(21,r2(b[1]+oy));g(31,0)};
  const poly=(ly,p)=>{for(let i=0;i<p.length;i++)line(ly,p[i],p[(i+1)%p.length])};
  const text=(ly,x,y,h,s)=>{g(0,'TEXT');g(8,ly);g(10,r2(x+ox));g(20,r2(y+oy));g(30,0);g(40,h);g(1,enc(s))};
  for(const r of S.rooms){poly('PH-ROOM',r.pts);const c=centroid(r.pts);text('PH-ROOM-TEXT',c[0]-1.2,c[1]+0.2,0.35,r.name);text('PH-ROOM-TEXT',c[0]-1.2,c[1]-0.3,0.25,(r.grade==='ไม่จัดเกรด'?'':'Grade '+r.grade+' ')+r.pa+' Pa')}
  for(const m of S.machines){poly('PH-MACHINE',machinePoly(m));if(m.clear>0)poly('PH-CLEARANCE',machinePoly(m,m.clear));text('PH-ROOM-TEXT',m.x-m.w/2,m.y,0.2,m.name)}
  for(const d of S.doors){const gm=doorGeom(d);for(const l of gm.leaves){
    line('PH-DOOR',l.hinge,l.open);
    const a0=Math.atan2(l.closed[1]-l.hinge[1],l.closed[0]-l.hinge[0]),a1=Math.atan2(l.open[1]-l.hinge[1],l.open[0]-l.hinge[0]);let df=a1-a0;while(df>Math.PI)df-=2*Math.PI;while(df<-Math.PI)df+=2*Math.PI;
    const deg=a=>((a*180/Math.PI)%360+360)%360;const s=df>=0?a0:a1,e=df>=0?a1:a0;
    g(0,'ARC');g(8,'PH-DOOR');g(10,r2(l.hinge[0]+ox));g(20,r2(l.hinge[1]+oy));g(30,0);g(40,r2(l.r));g(50,r2(deg(s)));g(51,r2(deg(e)))}}
  for(const f of S.flows){for(let i=0;i+1<f.pts.length;i++)line('PH-FLOW',f.pts[i],f.pts[i+1]);
    const n=f.pts.length;if(n>1){const a=f.pts[n-2],b=f.pts[n-1],ang=Math.atan2(b[1]-a[1],b[0]-a[0]),s=0.35;for(const da of[0.42,-0.42])line('PH-FLOW',b,[b[0]-s*Math.cos(ang+da),b[1]-s*Math.sin(ang+da)])}
    text('PH-FLOW',f.pts[0][0],f.pts[0][1]+0.15,0.2,f.name)}
  for(const d of S.dims){line('PH-DIM',d.a,d.b);text('PH-DIM',(d.a[0]+d.b[0])/2,(d.a[1]+d.b[1])/2+0.1,0.25,String(Math.round(Math.hypot(d.b[0]-d.a[0],d.b[1]-d.a[1])*1000)))}
  g(0,'ENDSEC');g(0,'EOF');return L.join('\n')+'\n'}
function csvStr(){
  const q=v=>'"'+String(v).replace(/"/g,'""')+'"';const rows=[['ประเภท','ชื่อ','เกรด','ความดัน Pa','พื้นที่ ตร.ม.','กว้าง ม.','ลึก ม.','สูง ม.','อยู่ในห้อง']];
  for(const r of S.rooms)rows.push(['ห้อง ('+RT(r.type).n+')',r.name,r.grade,r.pa,fmt(areaOf(r),1),'','',r.h,'']);
  for(const m of S.machines){const rm=roomAt(m.x,m.y);rows.push(['เครื่องจักร',m.name,'','','',m.w,m.d,m.h,rm?rm.name:'']);}
  for(const d of S.doors)rows.push(['ประตู'+(d.interlock?' (interlock)':''),d.name||'','','','',d.w,'','','']);
  for(const f of S.flows)rows.push(['เส้นทาง '+FL(f.kind).n,f.name,'','','','','','','']);
  return'﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n')}
/* embed=true (files to carry to another computer): the background layout goes inside, so one file opens everything */
function projectJSON(embed){
  const o={app:'plant-layout-studio',v:PROJECT_FORMAT,appVersion:APP_VERSION,layoutRef:U.loaded?{id:U.id,name:U.name,origin:U.origin}:null,
    rooms:S.rooms,machines:S.machines,doors:S.doors,flows:S.flows,dims:S.dims,bgHidden:S.bgHidden,bgErase:S.bgErase,cfg:S.cfg,nextId};
  if(embed&&U.loaded)o.layout=U.raw;
  return JSON.stringify(o,null,embed?0:1)}
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
function zipBlob(files){
  const te=new TextEncoder(),parts=[],cd=[];let off=0;const now=new Date(),dt=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate(),tm=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  for(const f of files){const nm=te.encode(f.name),d=te.encode(f.text),crc=crc32(d);
    const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);lh.setUint16(10,tm,true);lh.setUint16(12,dt,true);lh.setUint32(14,crc,true);lh.setUint32(18,d.length,true);lh.setUint32(22,d.length,true);lh.setUint16(26,nm.length,true);lh.setUint16(28,0,true);
    parts.push(lh.buffer,nm,d);
    const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);ch.setUint16(12,tm,true);ch.setUint16(14,dt,true);ch.setUint32(16,crc,true);ch.setUint32(20,d.length,true);ch.setUint32(24,d.length,true);ch.setUint16(28,nm.length,true);ch.setUint32(42,off,true);
    cd.push(ch.buffer,nm);off+=30+nm.length+d.length}
  let cdLen=0;for(const p of cd)cdLen+=p.byteLength;
  const ed=new DataView(new ArrayBuffer(22));ed.setUint32(0,0x06054b50,true);ed.setUint16(8,files.length,true);ed.setUint16(10,files.length,true);ed.setUint32(12,cdLen,true);ed.setUint32(16,off,true);
  return new Blob([...parts,...cd,ed.buffer],{type:'application/zip'})}
let DL=null;
async function save(filename,data){
  if(DL){try{await DL.save({filename,data});toast('บันทึกแล้ว')}catch(e){if(e&&e.code==='declined')return;toast('บันทึกไม่สำเร็จ ('+(e&&e.code||'error')+')')}return}
  /* outside Claude (e.g. GitHub Pages or a local file): plain browser download */
  try{const blob=data instanceof Blob?data:new Blob([data],{type:'application/octet-stream'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000);toast('ดาวน์โหลด '+filename)}catch(e){toast('บันทึกไม่สำเร็จ')}}

/* ====================== layouts (background floor plans, *.layout.json) ======================
   A layout is NOT part of the design. It comes from the architect's DWG (see tools/), is opened from a file,
   and is remembered in this browser. Projects store layoutRef; project files also embed the layout. */
const LKEY='pls-layouts-v1',LCUR='pls-layout-cur';
function hashStr(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return(h>>>0).toString(36)}
function normLayout(d){if(!d||!d.paths)throw new Error('not a layout');const L=Object.assign({format:'pls-layout',v:1},d);
  if(!L.id)L.id='L'+hashStr(JSON.stringify(d.origin||[])+JSON.stringify(d.paths).slice(0,300000));L.name=L.name||'แบบพื้นหลัง';L.origin=L.origin||[0,0];return L}
function getLayouts(){try{return JSON.parse(localStorage.getItem(LKEY)||'{}')||{}}catch(e){return{}}}
function storeLayout(L){
  try{localStorage.setItem(LCUR,L.id)}catch(e){}
  const all=getLayouts();all[L.id]={name:L.name,ts:Date.now(),data:L};
  try{localStorage.setItem(LKEY,JSON.stringify(all));return true}catch(e){toast('จำแบบพื้นหลังไว้ในเบราว์เซอร์ไม่ได้ (พื้นที่เต็ม) ครั้งหน้าต้องเปิดไฟล์อีกครั้ง');return false}}
/* move the whole design when the new layout has a different origin, so it stays at the same DWG position */
function shiftProject(dx,dy){const mv=p=>[r2(p[0]+dx),r2(p[1]+dy)];
  for(const r of S.rooms)r.pts=r.pts.map(mv);for(const m of S.machines){m.x=r2(m.x+dx);m.y=r2(m.y+dy)}for(const d of S.doors){d.x=r2(d.x+dx);d.y=r2(d.y+dy)}
  for(const f of S.flows)f.pts=f.pts.map(mv);for(const d of S.dims){d.a=mv(d.a);d.b=mv(d.b)}
  const f2=v=>(+v).toFixed(2);
  S.bgHidden=S.bgHidden.map(k=>{const m=/^(.*)@([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),(\d+)$/.exec(k);return m?`${m[1]}@${f2(+m[2]+dx)},${f2(+m[3]+dy)},${f2(+m[4]+dx)},${f2(+m[5]+dy)},${m[6]}`:k});
  S.bgErase=S.bgErase.map(e=>[r2(e[0]+dx),r2(e[1]+dy),r2(e[2]+dx),r2(e[3]+dy)])}
function useLayout(raw,opt={}){
  let L;try{L=normLayout(raw)}catch(e){toast('ไฟล์นี้ไม่ใช่แบบพื้นหลัง');return false}
  const has=S.rooms.length||S.machines.length||S.doors.length||S.flows.length||S.dims.length;
  if(U.loaded&&opt.shift!==false&&has){const dx=U.origin[0]-L.origin[0],dy=U.origin[1]-L.origin[1];if(Math.abs(dx)>1e-9||Math.abs(dy)>1e-9)shiftProject(dx,dy)}
  prepUnderlay(L);if(opt.persist!==false)storeLayout(L);if(HIST.layout)HIST.layout(L);
  undo.length=0;redo.length=0;updHist();T.sel=null;fitView();changed();renderDock();
  if(!opt.quiet)toast('ใช้แบบพื้นหลัง “'+L.name+'”'+(has&&opt.shift!==false?' · ห้องและเครื่องที่วางไว้คงตำแหน่งเดิมตามพิกัด DWG':''));return true}
async function readJsonFile(f){return JSON.parse(await f.text())}

/* ====================== drafts (kept in this browser) & project files ====================== */
const DKEY='pls-drafts-v1';
const hhmm=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const fdate=ts=>{const d=new Date(ts);return d.toLocaleDateString('th-TH',{day:'numeric',month:'short'})+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
function getDrafts(){try{return JSON.parse(localStorage.getItem(DKEY)||'{}')||{}}catch(e){return{}}}
function putDrafts(o){try{localStorage.setItem(DKEY,JSON.stringify(o));return true}catch(e){toast('บันทึก draft ไม่สำเร็จ (พื้นที่เบราว์เซอร์เต็มหรือถูกปิดไว้) ให้บันทึกเป็นไฟล์แทน');return false}}
let curDraft=null;try{curDraft=JSON.parse(localStorage.getItem('pls-cur-draft')||'null')}catch(e){}
let FH=null,delArm=null;
function setCur(c){curDraft=c;try{localStorage.setItem('pls-cur-draft',JSON.stringify(c))}catch(e){}updTitle()}
function updTitle(extra){$('#src').textContent=(curDraft?'Draft: '+curDraft.name:'ยังไม่ได้บันทึกเป็น draft')+(extra?' · '+extra:'')}
function saveDraft(name,id){name=(name||'').trim()||('ผังชั้น 2 '+fdate(Date.now()));const D=getDrafts();id=id||('d'+Date.now().toString(36));
  D[id]={name,ts:Date.now(),data:JSON.parse(projectJSON())};if(putDrafts(D)){setCur({id,name});updTitle('บันทึกแล้ว '+hhmm());toast('บันทึก draft “'+name+'” แล้ว')}}
function openDraft(id){const x=getDrafts()[id];if(!x)return;layoutFor(x.data);commit();applyProj(x.data);nextId=Math.max(x.data.nextId||1,nextId);T.sel=null;changed();setCur({id,name:x.name});fitView();toast('เปิด “'+x.name+'” แล้ว')}
function quickSave(){if(curDraft&&getDrafts()[curDraft.id])saveDraft(curDraft.name,curDraft.id);else draftsDialog()}
const canFS=()=>!!(window.showSaveFilePicker&&window.self===window.top);
async function saveFile(as){
  const name=(curDraft?curDraft.name:'plant-layout').replace(/[\\/:*?"<>|]/g,'-')+'.json';
  if(canFS()){try{if(!FH||as)FH=await showSaveFilePicker({suggestedName:name,types:[{description:'Plant layout project',accept:{'application/json':['.json']}}]});
    const w=await FH.createWritable();await w.write(projectJSON(true));await w.close();updTitle('บันทึกลง '+FH.name+' '+hhmm());toast('บันทึกลงไฟล์ '+FH.name+' แล้ว');return}catch(e){if(e&&e.name==='AbortError')return;FH=null}}
  await save(name,projectJSON(true))}
async function openFile(){
  if(window.showOpenFilePicker&&window.self===window.top){try{const[h]=await showOpenFilePicker({types:[{description:'Plant layout project',accept:{'application/json':['.json']}}]});
    const o=JSON.parse(await (await h.getFile()).text());if(!o.rooms&&o.paths){useLayout(o);return}if(!o.rooms)throw 0;FH=h;loadProjObj(o,h.name.replace(/\.json$/i,''));return}catch(e){if(e&&e.name==='AbortError')return;toast('ไฟล์โครงการไม่ถูกต้อง');return}}
  $('#file').click()}
function layoutFor(o){
  if(o.layout){useLayout(o.layout,{shift:false});return}
  const ref=o.layoutRef;if(!ref||ref.id===U.id)return;
  const x=getLayouts()[ref.id];if(x){useLayout(x.data,{shift:false});return}
  toast(`งานนี้ใช้แบบพื้นหลัง “${ref.name||ref.id}” ซึ่งยังไม่ได้เปิดในเครื่องนี้ ให้เปิดไฟล์แบบนั้นก่อน`)}
function loadProjObj(o,label){layoutFor(o);commit();applyProj(o);nextId=Math.max(o.nextId||1,nextId);T.sel=null;changed();renderLegend();fitView();setCur(null);updTitle('เปิดจากไฟล์ '+label);toast('เปิดโครงการแล้ว')}
function draftsDialog(){
  const d=$('#dlg'),D=getDrafts(),ids=Object.keys(D).sort((a,b)=>D[b].ts-D[a].ts);delArm=null;
  d.innerHTML=`<h3 style="margin-top:0;font-size:16px">Draft และไฟล์โครงการ</h3>
  <div class="f"><label class="w">ชื่อ draft<input id="dname" value="${esc(curDraft?curDraft.name:'ผังชั้น 2 '+fdate(Date.now()))}"></label></div>
  <div class="row">${curDraft&&D[curDraft.id]?`<button class="btn pri" data-dr="save">บันทึกทับ “${esc(curDraft.name)}”</button><button class="btn" data-dr="savenew">บันทึกเป็น draft ใหม่</button>`:'<button class="btn pri" data-dr="savenew">บันทึก draft</button>'}</div>
  <h3>Draft ในเครื่องนี้ (${ids.length})</h3>
  ${ids.length?`<table>${ids.map(id=>`<tr><td>${esc(D[id].name)}${curDraft&&curDraft.id===id?' <span class="muted">(เปิดอยู่)</span>':''}<br><span class="muted">${fdate(D[id].ts)} · ${(D[id].data.rooms||[]).length} ห้อง${D[id].data.layoutRef?' · '+esc(D[id].data.layoutRef.name):''}</span></td><td style="text-align:right;white-space:nowrap"><button class="btn" data-dr="open" data-id="${id}">เปิด</button> <button class="btn dng" data-dr="del" data-id="${id}">ลบ</button></td></tr>`).join('')}</table>`:'<p class="muted">ยังไม่มี draft</p>'}
  <h3>ไฟล์ในคอมพิวเตอร์ (ใช้ย้ายไปเครื่องอื่น)</h3>
  <div class="row"><button class="btn" data-dr="file">${FH?'บันทึกทับไฟล์ '+esc(FH.name):'บันทึกเป็นไฟล์ .json'}</button>${FH?'<button class="btn" data-dr="fileas">บันทึกเป็นไฟล์ใหม่</button>':''}<button class="btn" data-dr="fileopen">เปิดไฟล์ .json</button></div>
  <p class="muted">Draft เก็บอยู่ในเบราว์เซอร์ของเครื่องนี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์จะหาย และเครื่องอื่นมองไม่เห็น ถ้าจะใช้ต่อที่เครื่องอื่น ให้บันทึกเป็นไฟล์ .json (มีแบบพื้นหลังอยู่ในไฟล์ด้วย) แล้วเปิดไฟล์นั้นที่เครื่องปลายทาง${canFS()?' (Chrome/Edge จะจำไฟล์ไว้ กดบันทึกครั้งต่อไปเขียนทับไฟล์เดิมได้เลย)':''}</p>
  <div class="row"><button class="btn" data-dr="close">ปิด</button></div>`;
  if(!d.open)d.showModal()}
$('#qsave').onclick=quickSave;
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&(e.code==='KeyS'||e.key.toLowerCase()==='s')){e.preventDefault();quickSave()}});
function openMenu(){
  const d=$('#dlg');
  d.innerHTML=`<h3 style="margin-top:0;font-size:16px">เมนู</h3>
  <div class="row" style="flex-direction:column">
  <button class="btn pri" data-m="drafts">Draft และไฟล์โครงการ…</button>
  <button class="btn" data-m="layout">เปิดแบบพื้นหลัง (.layout.json)…</button>
  <button class="btn" data-m="zip">ส่งออก ZIP (DXF + CSV + โครงการ)</button>
  <button class="btn" data-m="png">บันทึกภาพผัง PNG</button>
  <button class="btn" data-m="demo">ใส่ตัวอย่างห้องและเครื่อง</button>
  <button class="btn dng" data-m="clear">ล้างทั้งหมด</button>
  <button class="btn" data-m="close">ปิด</button></div>
  <p class="muted">เวอร์ชันโปรแกรม ${APP_VERSION}</p>
  <p class="muted">DXF ใช้พิกัดเดียวกับแบบเดิม เปิดซ้อนกับแบบของสถาปนิกได้ตรงตำแหน่ง ข้อความไทยใน DXF ให้ตรวจใน AutoCAD ก่อนใช้งานจริง</p>`;
  d.showModal()}
$('#menu').onclick=openMenu;
$('#dlg').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const m=b.dataset.m,d=$('#dlg');
  const r=b.dataset.dr;
  if(r){const nm=($('#dname')||{}).value;
    if(r==='close'){d.close();return}
    if(r==='save'){saveDraft(nm,curDraft&&curDraft.id);d.close();return}
    if(r==='savenew'){saveDraft(nm,null);d.close();return}
    if(r==='open'){d.close();openDraft(b.dataset.id);return}
    if(r==='del'){if(delArm!==b.dataset.id){delArm=b.dataset.id;b.textContent='ยืนยันลบ';return}const D=getDrafts();delete D[b.dataset.id];putDrafts(D);if(curDraft&&curDraft.id===b.dataset.id)setCur(null);draftsDialog();return}
    if(r==='file'){d.close();await saveFile(false);return}
    if(r==='fileas'){d.close();await saveFile(true);return}
    if(r==='fileopen'){d.close();await openFile();return}
    return}
  if(m==='close'){d.close();return}
  if(m==='drafts'){draftsDialog();return}
  if(m==='layout'){d.close();$('#lfile').click();return}
  d.close();
  if(m==='zip'){const blob=zipBlob([{name:'layout.dxf',text:dxfStr()},{name:'room-list.csv',text:csvStr()},{name:'project.json',text:projectJSON(true)}]);await save('plant-layout.zip',blob)}
  else if(m==='png'){c2.toBlob(async bl=>{if(bl)await save('plant-layout.png',bl)})}
  else if(m==='demo')loadDemo();
  else if(m==='clear'){commit();S.rooms=[];S.machines=[];S.doors=[];S.flows=[];S.dims=[];T.sel=null;FH=null;setCur(null);changed()}
});
$('#lfile').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const o=await readJsonFile(f);if(o.rooms){loadProjObj(o,f.name.replace(/\.json$/i,''));return}useLayout(o)}catch(err){toast('เปิดไฟล์ไม่ได้ ไม่ใช่ไฟล์แบบพื้นหลัง')}});
$('#file').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{const o=JSON.parse(await f.text());if(!o.rooms&&o.paths){useLayout(o);return}if(!o.rooms)throw 0;loadProjObj(o,f.name.replace(/\.json$/i,''))}catch(err){toast('ไฟล์โครงการไม่ถูกต้อง')}});

/* ====================== demo content ====================== */
function loadDemo(){
  if(!U.loaded){toast('เปิดแบบพื้นหลังก่อน');return}
  commit();const id=()=>nextId++;
  // hall bounds: left tiled hall region (found from the underlay), computed from column layer extents
  const b=hallBox();const [x0,y0,x1,y1]=b,w=x1-x0,h=y1-y0;
  const gx=(f)=>r2(x0+w*f),gy=(f)=>r2(y0+h*f);
  const mk=(name,grade,pa,a,b2,c,d2,type='process')=>({id:id(),name,type,grade,pa,h:S.cfg.wallH,pts:[[gx(a),gy(b2)],[gx(c),gy(b2)],[gx(c),gy(d2)],[gx(a),gy(d2)]]});
  S.rooms=[mk('Corridor','D',30,0.02,0.40,0.98,0.52,'corridor'),
    mk('Dispensing','D',15,0.02,0.52,0.30,0.98,'weighing'),mk('Granulation','D',15,0.30,0.52,0.64,0.98),mk('Compression 1','D',15,0.64,0.52,0.98,0.98),
    mk('Coating','D',15,0.02,0.02,0.34,0.40),mk('Packing','D',15,0.34,0.02,0.66,0.40),mk('Store','ไม่จัดเกรด',0,0.66,0.02,0.98,0.40,'store')];
  S.flows=[];S.dims=[];
  const rc=n=>S.rooms.find(r=>r.name===n);const cen=n=>centroid(rc(n).pts);
  const L=k=>LIB.find(l=>l.k===k);
  const mm=(k,x,y,rot=0,nm)=>{const l=L(k);return{id:id(),k,name:nm||l.n,x:r2(x),y:r2(y),w:l.w,d:l.d,h:l.h,clear:l.c,rot,col:l.col}};
  const c1=cen('Compression 1'),c2_=cen('Granulation'),c3_=cen('Dispensing'),c4=cen('Coating'),c5=cen('Packing');
  S.machines=[mm('press',c1[0]-2.2,c1[1]+1.2,0,'Press A'),mm('press',c1[0]+0.4,c1[1]+1.2,0,'Press B'),mm('dust',c1[0]+3.4,c1[1]-2.2),mm('ipc',c1[0]-2.5,c1[1]-2.4),
    mm('granulator',c2_[0],c2_[1]+1),mm('fbd',c2_[0],c2_[1]-3,0),mm('booth',c3_[0],c3_[1]+0.5),mm('coater',c4[0]-1.5,c4[1]),mm('blister',c5[0],c5[1]+1.5),mm('cartoner',c5[0],c5[1]-1.5)];
  const door=(x,y,ang,w2,side,dbl=false)=>({id:id(),name:'ประตู '+(S.doors.length+1),x:r2(x),y:r2(y),ang,w:w2,dbl,side,hinge:1});
  const cy=gy(0.52),cy2=gy(0.40);
  S.doors=[door(cen('Dispensing')[0],cy,0,0.9,-1),door(cen('Granulation')[0],cy,0,0.9,1),door(cen('Compression 1')[0]+1,cy,0,1.2,-1),
    door(cen('Coating')[0],cy2,0,0.9,1),door(cen('Packing')[0],cy2,0,1.2,1),door(cen('Store')[0],cy2,0,1.8,1,true)];
  S.doors.forEach((d,i)=>{d.name='ประตู '+(i+1);const n=doorGeom(d).n,rA=roomAt(d.x+n[0]*0.6,d.y+n[1]*0.6),rB=roomAt(d.x-n[0]*0.6,d.y-n[1]*0.6);if(rA&&rB)d.side=(+rA.pa||0)>=(+rB.pa||0)?1:-1});
  setSel(null);changed();fitView();renderLegend();toast('ใส่ตัวอย่างแล้ว แก้หรือลบได้ทั้งหมด')}
function hallBox(){
  /* a layout may give "demoBox" (interior of the main hall); otherwise use the middle of the drawing */
  if(U.meta&&U.meta.demoBox)return U.meta.demoBox;
  const b=fitBox(),w=b[2]-b[0],h=b[3]-b[1];return[b[0]+w*0.15,b[1]+h*0.15,b[2]-w*0.15,b[3]-h*0.15]}

/* ====================== init ====================== */
async function init(){
  try{if(window.claude&&claude.use)DL=await claude.use('downloads')}catch(e){DL=null}
  renderTools();renderCtx();renderLegend();renderDock();updHist();
  new ResizeObserver(()=>resize()).observe($('#stage'));resize();
  const had=loadAuto();
  /* background: embedded (special builds) → last layout used in this browser → dev URL → none (user opens a file) */
  let lay=window.__UNDERLAY||null;
  if(!lay){let cur=null;try{cur=localStorage.getItem(LCUR)}catch(e){}const x=cur&&getLayouts()[cur];if(x)lay=x.data}
  if(!lay&&window.UNDERLAY_URL){try{lay=await (await fetch(window.UNDERLAY_URL,{cache:'no-store'})).json()}catch(e){}}
  if(lay){try{prepUnderlay(normLayout(lay))}catch(e){toast('แบบพื้นหลังเสีย เปิดไฟล์ใหม่อีกครั้ง')}}
  fitView();runChecks();renderDock();renderLegend();updTitle();
  /* ?project=drafts/xxx.json opens a project file kept next to the page (e.g. in the same GitHub repo) */
  try{const qp=new URLSearchParams(location.search).get('project');if(qp){const o=await (await fetch(qp,{cache:'no-store'})).json();if(o&&o.rooms){layoutFor(o);applyProj(o);nextId=Math.max(o.nextId||1,nextId);changed();fitView();setCur(null);updTitle('เปิดจาก '+qp)}}}catch(e){toast('เปิดไฟล์โครงการจากลิงก์ไม่ได้')}
  if(!had&&!S.rooms.length){/* start empty with the underlay; demo is in the menu */}
  /* shared editing (collab.js) — only does anything inside a Claude artifact */
  setTimeout(()=>{if(typeof collabStart==='function')collabStart()},0);
}
window.__app={useLayout,getLayouts,normLayout,loadProjObj,saveDraft,openDraft,getDrafts,draftsDialog,quickSave,S,T,V,U,V3,findBg,boxBg,hideBg,finishFlow,tapTool,hitTest,doorHit,roomMembers,moveMembers,orthoPt,vtxPt,moveSnap,snapPt,eraseBg,gridNear,pieces,editVertexAt,MOD,resizeRoom,roomSize,cancelDraw,delSel,doUndo,rebuildUnderlay,sumHTML,propsHTML,commit,changed,runChecks,loadDemo,setView,fitView,doorGeom,machinePoly,dxfStr,csvStr,zipBlob,projectJSON,setSel,render};
init();
