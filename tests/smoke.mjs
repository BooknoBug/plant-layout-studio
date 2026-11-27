// Smoke test: runs the built index.html in Node with a stub DOM and checks the core features.
// Run:  python3 tools/build.py && node tests/smoke.mjs      (Node 18+)
// Uses a small synthetic layout (tests/fixtures) so no company drawing is needed.
import fs from 'fs'; import vm from 'vm'; import assert from 'assert';
const noop=()=>{};
const ctx=new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):noop,set:()=>true});
const els={};const el=id=>{if(id&&els[id])return els[id];const e={style:{},dataset:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},addEventListener:noop,setAttribute:noop,getContext:()=>ctx,getBoundingClientRect:()=>({width:800,height:600,left:0,top:0}),setPointerCapture:noop,querySelector:()=>el(),closest:()=>null,showModal:noop,close:noop,toBlob:noop,innerHTML:'',textContent:'',width:0,height:0,click:noop,value:''};if(id)els[id]=e;return e};
Object.assign(globalThis,{document:{querySelector:s=>el(s),querySelectorAll:()=>[],documentElement:{}},location:{search:''},
  getComputedStyle:()=>({getPropertyValue:()=>'#123456'}),requestAnimationFrame:()=>0,ResizeObserver:class{observe(){}},Path2D:class{moveTo(){}lineTo(){}}});
globalThis.window=globalThis;Object.assign(window,{innerWidth:1200,devicePixelRatio:1,addEventListener:noop,self:window,top:window});
const LS={};globalThis.localStorage={getItem:k=>LS[k]??null,setItem:(k,v)=>{LS[k]=String(v)}};
const fx=n=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+n,import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInThisContext(m[1]);
await new Promise(r=>setTimeout(r,300));
const A=window.__app,S=A.S,T=A.T;let ok=0;const t=(name,f)=>{f();ok++;console.log('✓',name)};
t('starts without a layout',()=>assert(!A.U.loaded));
t('open layout file',()=>{assert(A.useLayout(fx('test-hall.layout.json')));assert(A.U.loaded&&A.U.id==='test-hall'&&A.U.cnt['TILE-GRID']>50)});
t('layout remembered in this browser',()=>assert(LS['pls-layout-cur']==='test-hall'&&A.getLayouts()['test-hall']));
t('demo layout',()=>{A.loadDemo();assert.equal(S.rooms.length,7);assert(S.machines.length>5)});
t('pressure cascade demo has no door warnings',()=>assert(!T.checks.some(c=>c.sev!=='info'&&/ประตู/.test(c.msg))));
t('erase background line',()=>{T.bgLock=false;const h=A.findBg(0.15,15,0.3);assert(h&&h.k==='WALL');const n=A.U.cnt.WALL;A.hideBg([A.U.keys[h.k][h.i]]);assert.equal(A.U.cnt.WALL,n-1)});
t('dirty/clean flow crossing is flagged',()=>{S.flows.push({id:9001,kind:'material',name:'m',pts:[[2,15],[38,15]]},{id:9002,kind:'waste',name:'w',pts:[[20,13],[20,17]]});A.changed();assert(T.checks.some(c=>/สะอาดกับสกปรก/.test(c.msg)))});
t('draft save/open keeps layoutRef',()=>{A.saveDraft('smoke');const id=Object.keys(A.getDrafts())[0];assert.equal(A.getDrafts()[id].data.layoutRef.id,'test-hall');S.rooms=[];A.openDraft(id);assert.equal(S.rooms.length,7)});
t('project file embeds the layout',()=>{const o=JSON.parse(A.projectJSON(true));assert(o.v>=3&&o.layout&&o.layout.id==='test-hall'&&o.bgHidden.length===1)});
let saved;
t('new layout with other origin keeps design at same DWG position',()=>{saved=JSON.parse(A.projectJSON(true));const r0=S.rooms[0].pts[0].slice();
  A.useLayout(fx('test-hall-r2.layout.json'));const r1=S.rooms[0].pts[0];assert(Math.abs(r1[0]-(r0[0]+5))<1e-6&&Math.abs(r1[1]-(r0[1]+10))<1e-6);
  assert.equal(A.U.cnt.WALL,1,'hidden wall line still hidden after the shift')});
t('opening a project file restores its own layout',()=>{A.loadProjObj(saved,'x');assert.equal(A.U.id,'test-hall');assert.equal(S.rooms.length,7)});
t('poly: nearly-straight segment locks ortho, ignores off-line point',()=>{A.T.snap=true;A.V.s=20;
  const p=A.orthoPt([10,15],18,15.3,0.7,{free:false});assert(p.ortho&&p.y===15,'locked horizontal');
  const f=A.orthoPt([10,15],18,15.3,0.7,{free:true});assert(!f.ortho&&f.y===15.3,'Shift = free, no snap');
  const d=A.orthoPt([10,15],14,18,0.7,{free:false});assert(!d.ortho,'real diagonal stays free')});
t('box room lines up with a room drawn earlier (edges exactly in line), Shift = no snap',()=>{T.snap=true;A.V.s=20;const r={id:9300,name:'A',type:'other',grade:'D',pa:15,h:3,pts:[[200,200],[210,200],[210,206],[200,206]]};S.rooms.push(r);
  const a=A.snapPt(230,200.3,0.7);assert(a.k==='ax'&&a.y===200&&a.x===230,'y lines up with far room corner');
  const c=A.snapPt(210.2,206.2,0.7);assert(c.k==='pt'&&c.x===210&&c.y===206,'corner snaps');
  const n=A.snapPt(230,200.3,0.7,{mod:{free:true}});assert(n.k===null&&n.y===200.3,'Shift = no snap');
  const b={id:9301,pts:[[211,190],[220,190],[220,199.8],[211,199.8]]};const[dx,dy]=A.moveSnap(b,b.pts.map(q=>q.slice()),-0.8,0.1,{free:false});
  assert(Math.abs(b.pts[3][0]+dx-210)<1e-9&&Math.abs(b.pts[3][1]+dy-200)<1e-9,'moved room corner lands on the other room corner');
  S.rooms=S.rooms.filter(q=>q!==r)});
t('double-click room edge adds a corner, corner removes it',()=>{const r={id:9100,name:'L',type:'other',grade:'D',pa:15,h:3,pts:[[100,100],[110,100],[110,106],[100,106]]};S.rooms.push(r);A.V.s=20;A.V.tx=0;A.V.ty=0;
  const sp=w=>[w[0]*A.V.s+A.V.tx,-w[1]*A.V.s+A.V.ty];
  assert(A.editVertexAt(105,100,sp([105,100])));assert.equal(r.pts.length,5);assert.deepEqual(r.pts[1],[105,100]);
  assert(A.editVertexAt(105,100,sp([105,100])));assert.equal(r.pts.length,4);
  const v=A.vtxPt({pts:[[100,100],[105,100.02],[105,105]]},1,105.1,100.1,{free:false});assert(v.x===105&&v.y===100,'corner lines up with neighbours');
  S.rooms=S.rooms.filter(q=>q!==r)});
t('room width/length resize keeps left/bottom edge, refuses to cross an L notch',()=>{
  const r={id:9200,name:'R',type:'other',grade:'D',pa:15,h:3,pts:[[0,0],[10,0],[10,4],[6,4],[6,8],[0,8]]};S.rooms.push(r);
  assert.deepEqual(A.roomSize(r),[10,8]);assert(A.resizeRoom(r,0,12));assert.deepEqual(A.roomSize(r),[12,8]);assert.equal(r.pts[0][0],0);
  assert(A.resizeRoom(r,1,9));assert.deepEqual(r.pts[4],[6,9]);
  assert(!A.resizeRoom(r,0,5),'would cross the notch');assert.equal(A.roomSize(r)[0],12);S.rooms=S.rooms.filter(q=>q!==r)});
t('delete then undo brings the room back · cancel clears a half-drawn room',()=>{const n=S.rooms.length;A.setSel('room',S.rooms[0].id);A.delSel();assert.equal(S.rooms.length,n-1);A.doUndo();assert.equal(S.rooms.length,n);
  T.poly=[[1,1],[2,1]];assert(A.cancelDraw());assert.equal(T.poly.length,0);assert(!A.cancelDraw(),'nothing left to cancel')});
t('1 m grid worked out from the layout; crossings snap',()=>{const G=A.U.grid;assert(G&&G.step===1&&G.ox===0.5&&G.oy===0.5,JSON.stringify(G));
  A.V.s=20;T.snap=true;const s=A.snapPt(10.52,12.48,0.1);assert(s.k==='pt'&&s.x===10.5&&s.y===12.5,JSON.stringify(s));assert.equal(A.gridNear(-5,-5),null)});
t('eraser cuts only the part inside the box, keeps the grid, saved in the file, undo restores',()=>{
  const i=A.U.paths.WALL.findIndex((p,j)=>!A.U.hidden.has(A.U.keys.WALL[j]));assert.equal(A.pieces('WALL',i).length,1);const nT=A.U.cnt['TILE-GRID'];
  assert(A.eraseBg([10,0],[12,1]));const pc=A.pieces('WALL',i);assert.equal(pc.length,2);
  assert(pc.every(p=>p.every(v=>!(v[0]>10.001&&v[0]<11.999&&v[1]<1))),'nothing left inside the box');assert.equal(A.U.cnt['TILE-GRID'],nT,'grid untouched');
  const o=JSON.parse(A.projectJSON(false));assert.equal(o.v,4);assert.deepEqual(o.bgErase,[[10,0,12,1]]);
  A.doUndo();assert.equal(A.pieces('WALL',i).length,1);assert.equal(S.bgErase.length,0)});
t('door is picked by its leaf / swing area, ahead of the room under it',()=>{const d={id:9400,name:'D',x:105,y:105,ang:0,w:0.9,dbl:false,side:1,hinge:1};
  const r={id:9401,name:'R',type:'other',grade:'D',pa:15,h:3,pts:[[100,100],[110,100],[110,110],[100,110]]};S.doors.push(d);S.rooms.push(r);A.V.s=40;
  assert(A.doorHit(d,104.8,105.5,0.1),'inside swing');assert(!A.doorHit(d,104.8,104.5,0.1),'other side of wall');assert(!A.doorHit(d,106,107,0.1),'far away');
  const h=A.hitTest(104.8,105.5);assert(h&&h.type==='door'&&h.obj===d);S.doors=S.doors.filter(q=>q!==d);S.rooms=S.rooms.filter(q=>q!==r)});
t('DXF has entities',()=>{const d=A.dxfStr();assert(d.includes('PH-ROOM')&&d.trim().endsWith('EOF'))});
console.log(`${ok} checks passed`);
