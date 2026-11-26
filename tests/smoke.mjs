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
  const p=A.orthoPt([10,15],18,15.3,0.7,{shift:false,free:false});assert(p.ortho&&p.y===15,'locked horizontal');
  const f=A.orthoPt([10,15],18,15.3,0.7,{shift:false,free:true});assert(!f.ortho,'Ctrl = free');
  const d=A.orthoPt([10,15],14,18,0.7,{shift:false,free:false});assert(!d.ortho,'real diagonal stays free');
  const s=A.orthoPt([10,15],12,18,0.7,{shift:true,free:false});assert(s.ortho&&s.x===10,'Shift forces vertical')});
t('double-click room edge adds a corner, corner removes it',()=>{const r={id:9100,name:'L',type:'other',grade:'D',pa:15,h:3,pts:[[100,100],[110,100],[110,106],[100,106]]};S.rooms.push(r);A.V.s=20;A.V.tx=0;A.V.ty=0;
  const sp=w=>[w[0]*A.V.s+A.V.tx,-w[1]*A.V.s+A.V.ty];
  assert(A.editVertexAt(105,100,sp([105,100])));assert.equal(r.pts.length,5);assert.deepEqual(r.pts[1],[105,100]);
  assert(A.editVertexAt(105,100,sp([105,100])));assert.equal(r.pts.length,4);
  const v=A.vtxPt({pts:[[0,0],[5,0.02],[5,5]]},1,5.1,0.1,{free:false});assert(v.x===5&&v.y===0,'corner lines up with neighbours');
  S.rooms=S.rooms.filter(q=>q!==r)});
t('DXF has entities',()=>{const d=A.dxfStr();assert(d.includes('PH-ROOM')&&d.trim().endsWith('EOF'))});
console.log(`${ok} checks passed`);
