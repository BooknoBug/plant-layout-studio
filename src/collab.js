/* Plant Layout Studio — collab.js
   Shared editing when the page runs as a Claude artifact (claude.ai). Outside Claude it does nothing.
   - Several plants in one page, shown as tabs. Registry: db collection `plants`, one doc per plant
     {name, order, col}. Each plant keeps its work in its own collection `col` (the first plant uses `items`,
     new ones `plants/<id>/items`). Everyone who can open the page sees every plant.
   - In a plant collection every room / machine / door / flow / dim is one document (room-12 ...), plus cfg, bg
     (erased background lines) and layout (pointer to the background file stored as an artifact asset).
   - Local edits are found by diffing S against the last shared state (CO.base) each time changed() runs,
     and written per document (one write at a time per document, bursts coalesced).
   - Undo/redo is per person: each step remembers only the documents that person changed, and an item someone
     else changed since is left alone. Switching plant clears the undo history.
   - Who can edit comes from the artifact's sharing (Contributor and up edit, Viewer only looks).
   - Presence: cursors and selections of people on the same plant are drawn on the plan. */
'use strict';
const CO={on:false,ready:false,db:null,room:null,user:null,assets:null,ro:false,isOwner:false,
  base:new Map(),remote:new Map(),pend:new Map(),inflight:new Set(),E:[],R:[],
  peers:[],prof:{},conn:false,layoutDoc:null,bgDirty:false,err:'',roT:0,
  plants:[],pid:null,col:null,gen:0,unsub:null,cfg0:null};
const MAIN_COL='items';
const canon=v=>{if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
  if(Array.isArray(v))return'['+v.map(canon).join(',')+']';
  return'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PK=(col,k)=>col+'\u0001'+k;

/* ---------- local state <-> documents ---------- */
function coLocal(){const m=new Map();
  for(const t in LK)for(const o of S[LK[t]])m.set(t+'-'+o.id,canon(o));
  m.set('cfg',canon(S.cfg));m.set('bg',canon({h:S.bgHidden,e:S.bgErase}));return m}
function coApply(k,js){const v=js==null?null:JSON.parse(js);
  if(k==='cfg'){if(v){for(const x of Object.keys(S.cfg))if(!(x in v))delete S.cfg[x];Object.assign(S.cfg,v)}return}
  if(k==='bg'){S.bgHidden=v&&Array.isArray(v.h)?v.h:[];S.bgErase=v&&Array.isArray(v.e)?v.e:[];CO.bgDirty=true;return}
  const i=k.indexOf('-'),t=k.slice(0,i),id=+k.slice(i+1),arr=S[LK[t]];if(!arr||!isFinite(id))return;
  const j=arr.findIndex(o=>o.id===id);
  if(!v||typeof v!=='object'){if(j>=0)arr.splice(j,1);if(T.sel&&T.sel.type===t&&T.sel.id===id)T.sel=null;return}
  v.id=id;
  if(j>=0){const o=arr[j];for(const x of Object.keys(o))delete o[x];Object.assign(o,v)}else arr.push(v)}
function coRefresh(){
  if(CO.bgDirty&&U.loaded){CO.bgDirty=false;rebuildUnderlay()}
  if(T.sel&&!getSel())T.sel=null;
  autosave();runChecks();renderLegend();
  const ae=document.activeElement;if(!(ae&&ae.closest&&ae.closest('#pane,#dlg')))renderDock();
  render();coStatus()}

/* push local changes; record=true adds them to the open undo step */
function coFlush(record){
  if(!CO.on||!CO.ready)return;
  const cur=coLocal(),keys=new Set([...cur.keys(),...CO.base.keys()]);let back=0;
  for(const k of keys){const a=CO.base.has(k)?CO.base.get(k):null,b=cur.has(k)?cur.get(k):null;if(a===b)continue;
    if(CO.ro){coApply(k,a);back++;continue}
    if(record&&CO.E.length){const E=CO.E[CO.E.length-1];if(!(k in E.b))E.b[k]=a;E.a[k]=b}
    if(b==null)CO.base.delete(k);else CO.base.set(k,b);
    coQueue(CO.col,k,b)}
  if(back){if(CO.bgDirty&&U.loaded){CO.bgDirty=false;rebuildUnderlay()}if(T.sel&&!getSel())T.sel=null;render();
    if(Date.now()-CO.roT>3000){CO.roT=Date.now();toast('คุณมีสิทธิ์ดูอย่างเดียว ขอสิทธิ์ Contributor/Editor จากเจ้าของงานเพื่อแก้ไข')}}}

/* ---------- writing (queue entries remember their plant collection) ---------- */
let pumpT=0;
const busyHere=k=>CO.pend.has(PK(CO.col,k))||CO.inflight.has(PK(CO.col,k));
function coQueue(col,k,v){CO.pend.set(PK(col,k),{col,k,v});coStatus();if(!pumpT)pumpT=setTimeout(coRun,150)}
function coRun(){pumpT=0;
  for(const[pk,w]of[...CO.pend]){if(CO.inflight.has(pk))continue;if(CO.inflight.size>=6)break;
    CO.pend.delete(pk);CO.inflight.add(pk);
    coWrite(w).then(ok=>{CO.inflight.delete(pk);
      /* the store now holds what we wrote (a later write by someone else arrives as a snapshot) */
      if(w.col===CO.col){if(ok){if(w.v==null)CO.remote.delete(w.k);else CO.remote.set(w.k,w.v)}coSettle(w.k)}
      if(CO.pend.size&&!pumpT)pumpT=setTimeout(coRun,150);coStatus()})}}
async function coWrite(w){const ref=CO.db.collection(w.col).doc(w.k);
  const go=()=>w.v==null?ref.delete():ref.set({o:JSON.parse(w.v)});
  try{await go();CO.err='';return true}catch(e){
    if(e&&e.code==='unavailable'){await sleep(400+Math.random()*800);try{await go();CO.err='';return true}catch(e2){e=e2}}
    coWriteErr(e);return false}}
function coWriteErr(e){const c=e&&e.code||'error';
  if(c==='invalid_argument'&&CO.canWrite!==true){CO.ro=true;toast('งานร่วมนี้คุณดูได้อย่างเดียว การแก้ไขไม่ถูกบันทึก')}
  else if(c==='quota_exceeded')toast('ที่เก็บงานร่วมเต็ม ลบรายการที่ไม่ใช้ก่อน');
  else if(c==='revoked'){CO.ro=true;CO.err='ถูกปิดสิทธิ์'}
  else{CO.err='บันทึกไม่สำเร็จ';toast('บันทึกงานร่วมไม่สำเร็จ ('+c+') จะลองใหม่เมื่อแก้ครั้งถัดไป')}}
/* after our write settles, take the shared value if it differs (someone else wrote, or our write failed) */
function coSettle(k){if(busyHere(k))return;
  const r=CO.remote.has(k)?CO.remote.get(k):null,b=CO.base.has(k)?CO.base.get(k):null;
  if(r!==b){coApply(k,r);if(r==null)CO.base.delete(k);else CO.base.set(k,r);coRefresh()}}

/* ---------- reading the current plant ---------- */
function coSnap(snap){let touched=false;
  for(const ch of snap.docChanges()){const k=ch.doc.id,d=ch.type==='removed'?null:ch.doc.data();
    if(k==='layout'){CO.layoutDoc=d||null;if(CO.ready)coUseLayout();continue}
    const js=d&&d.o!==undefined?canon(d.o):null;
    if(js==null)CO.remote.delete(k);else CO.remote.set(k,js);
    if(!CO.ready||busyHere(k))continue;
    const b=CO.base.has(k)?CO.base.get(k):null;if(b===js)continue;
    coApply(k,js);if(js==null)CO.base.delete(k);else CO.base.set(k,js);touched=true}
  if(!CO.ready&&!snap.metadata.fromCache)coFirst();
  else if(touched)coRefresh()}
async function coFirst(){
  CO.ready=true;clearTimeout(CO.loadT);
  const keys=[...CO.remote.keys()];
  for(const k of keys)coApply(k,CO.remote.get(k));
  CO.base=coLocal();
  /* keys we hold locally but nobody shared yet (e.g. cfg of a new plant) are not pushed until changed */
  for(const k of[...CO.base.keys()])if(!CO.remote.has(k))CO.base.delete(k);
  nextId=Math.max(nextId,Date.now()*100+Math.floor(Math.random()*100));
  undo.length=0;redo.length=0;CO.E.length=0;CO.R.length=0;updHist();T.sel=null;
  await coUseLayout();
  coRefresh();fitView();renderDock();coTabs();coStatus()}

/* ---------- background layout (stored once as an asset, pointer in <col>/layout) ---------- */
let layBusy=false;
function coNoLayout(){U.loaded=false;U.paths={};U.texts=[];U.p2d={};U.cnt={};U.bb={};U.keys={};U.vis={};U.img=null;U.id=null;U.name='';U.meta=null;U.raw=null;U.grid=null;U.clip={};
  try{rebuildUnderlay()}catch(e){}}
async function coUseLayout(){const d=CO.layoutDoc,gen=CO.gen;
  if(!d||!d.id){if(U.loaded)coNoLayout();return}
  if((U.loaded&&U.id===d.id)||layBusy)return;
  layBusy=true;
  try{let L=null;const x=getLayouts()[d.id];if(x)L=x.data;
    if(!L&&typeof d.asset==='string'&&/^[0-9a-f]{32}$/.test(d.asset)){const r=await fetch('/_blob/'+d.asset);if(!r.ok)throw 0;L=await r.json()}
    if(!L)throw 0;if(gen!==CO.gen){layBusy=false;return}
    L=normLayout(L);prepUnderlay(L);try{localStorage.setItem(LCUR,L.id)}catch(e){}
    try{const all=getLayouts();if(!all[L.id])storeLayout(L)}catch(e){}
    fitView();coRefresh()}
  catch(e){toast('โหลดแบบพื้นหลังของ plant นี้ไม่ได้')}
  layBusy=false;
  if(gen===CO.gen&&CO.layoutDoc&&CO.layoutDoc.id!==U.id)coUseLayout()}
async function coLayoutUp(L){
  if(!CO.on||!L||(CO.layoutDoc&&CO.layoutDoc.id===L.id))return;
  if(!CO.assets){toast('เฉพาะ Editor/เจ้าของเปลี่ยนแบบพื้นหลังของงานร่วมได้ (เปลี่ยนแค่ในเครื่องนี้)');return}
  const col=CO.col;
  try{toast('กำลังอัปโหลดแบบพื้นหลังให้ทุกคน…');
    const a=await CO.assets.upload(new Blob([JSON.stringify(L)],{type:'application/json'}),{type:'application/json'});
    await CO.db.collection(col).doc('layout').set({asset:a.id,id:L.id,name:String(L.name||''),origin:L.origin||[0,0]});
    toast('ทุกคนใช้แบบพื้นหลัง “'+L.name+'” แล้ว')}
  catch(e){toast('อัปโหลดแบบพื้นหลังไม่สำเร็จ ('+(e&&e.code||'error')+')')}}

/* ---------- plants (tabs) ---------- */
const plantOf=id=>CO.plants.find(p=>p.id===id);
function coPlantsSnap(snap){
  const list=[];for(const d of snap.docs){const v=d.data()||{};
    const col=typeof v.col==='string'&&/^(items|plants\/[A-Za-z0-9_-]{1,40}\/items)$/.test(v.col)?v.col:null;if(!col)continue;
    list.push({id:d.id,name:String(v.name||'Plant').slice(0,60),order:+v.order||0,col})}
  /* an artifact without a registry yet: its work is in `items` */
  if(!list.length)list.push({id:'main',name:'Plant 1',order:0,col:MAIN_COL,implicit:true});
  list.sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));
  CO.plants=list;
  if(!CO.pid){let want=null;try{want=localStorage.getItem('pls-plant')}catch(e){}
    switchPlant(plantOf(want)?want:list[0].id)}
  else if(!plantOf(CO.pid))switchPlant(list[0].id);
  coTabs()}
async function switchPlant(pid){const P=plantOf(pid);if(!P)return;
  if(CO.pid===pid&&CO.ready)return;
  coFlush(true);
  CO.gen++;if(CO.unsub){try{CO.unsub()}catch(e){}CO.unsub=null}
  CO.pid=pid;CO.col=P.col;try{localStorage.setItem('pls-plant',pid)}catch(e){}
  CO.ready=false;CO.base=new Map();CO.remote=new Map();CO.E.length=0;CO.R.length=0;CO.layoutDoc=null;
  /* start the plant from an empty state */
  S.rooms=[];S.machines=[];S.doors=[];S.flows=[];S.dims=[];S.bgHidden=[];S.bgErase=[];
  if(CO.cfg0){const c=JSON.parse(CO.cfg0);for(const x of Object.keys(S.cfg))delete S.cfg[x];Object.assign(S.cfg,c)}
  undo.length=0;redo.length=0;updHist();T.sel=null;T.poly=[];T.pend=null;T.fpts=[];T.dpts=[];T.meas=[];
  if(U.loaded)coNoLayout();
  coTabs();coStatus();renderDock();render();
  coPresence({plant:pid,sel:null});
  const gen=CO.gen;
  clearTimeout(CO.loadT);CO.loadT=setTimeout(()=>{if(gen===CO.gen&&!CO.ready){CO.err='ยังเชื่อมงานร่วมไม่ได้';coStatus()}},10000);
  const sub=()=>{if(gen!==CO.gen)return;CO.unsub=CO.db.collection(P.col).onSnapshot(s=>{if(gen===CO.gen)coSnap(s)},e=>{
    if(gen!==CO.gen)return;if(e&&e.code==='unavailable'){setTimeout(sub,3000);return}
    CO.err='ขาดการเชื่อมต่อ';coStatus()})};
  sub()}
function coTabs(){const el=$('#plants');if(!el||!CO.on)return;el.hidden=false;
  const cnt={};for(const p of coOthers(true)){const pl=p.presence&&p.presence.plant;if(typeof pl==='string')cnt[pl]=(cnt[pl]||0)+1}
  el.innerHTML=CO.plants.map(p=>`<button class="ptab" role="tab" data-plant="${esc(p.id)}" aria-selected="${p.id===CO.pid}">${esc(p.name)}${cnt[p.id]?` <span class="pc" title="คนอื่นที่เปิด plant นี้อยู่">👤${cnt[p.id]}</span>`:''}</button>`).join('')+
    `<button class="ptab add" data-plant-add title="สร้าง plant ใหม่ (ทุกคนในงานร่วมเห็น)">+ Plant ใหม่</button>`+
    `<button class="ptab ed" data-plant-ren title="เปลี่ยนชื่อ plant นี้">✎</button>`+
    (CO.canEdit&&CO.plants.length>1?`<button class="ptab ed del" data-plant-del title="ลบ plant นี้ (แท็บที่เปิดอยู่)">🗑</button>`:'')}
/* delete the open plant: its registry entry and every document in its collection. Editors/owner only; not undoable. */
async function deletePlant(){const P=plantOf(CO.pid);if(!P)return;
  if(!CO.canEdit){toast('ลบ plant ได้เฉพาะเจ้าของหรือ Editor');return}
  if(CO.plants.length<2){toast('ต้องเหลืออย่างน้อย 1 plant');return}
  const who=new Set(coOthers(true).filter(p=>p.presence&&p.presence.plant===P.id).map(p=>p.by||p.peer)).size;
  const a=await askDlg('ลบ plant “'+P.name+'”?',`แท็บนี้มี ห้อง ${S.rooms.length} · เครื่องจักร ${S.machines.length} · ประตู ${S.doors.length} จะถูกลบสำหรับทุกคน <b>และย้อนกลับไม่ได้</b> (Ctrl+Z ใช้ไม่ได้)${who?` · ตอนนี้มีคนอื่นเปิดแท็บนี้อยู่ ${who} คน`:''}<br><span class="muted">ถ้าอยากเก็บไว้ ให้กดยกเลิก แล้วบันทึกเป็นไฟล์ .json ก่อน (เมนู ⋯ → Draft และไฟล์โครงการ)</span>`,['ลบ plant นี้','ยกเลิก']);
  if(a!==0)return;
  const rest=CO.plants.filter(p=>p.id!==P.id),col=P.col;
  try{toast('กำลังลบ “'+P.name+'”…');
    await CO.db.collection('plants').doc(P.implicit?'main':P.id).delete();
    CO.plants=rest;switchPlant(rest[0].id);
    const snap=await CO.db.collection(col).get();
    for(const d of snap.docs){try{await CO.db.collection(col).doc(d.id).delete()}catch(e){}}
    toast('ลบ “'+P.name+'” แล้ว')}
  catch(e){toast('ลบไม่สำเร็จ ('+(e&&e.code||'error')+')')}}
function plantDialog(mode){const d=$('#dlg'),P=plantOf(CO.pid);
  if(CO.ro){toast('คุณมีสิทธิ์ดูอย่างเดียว สร้าง/เปลี่ยนชื่อ plant ไม่ได้');return}
  const isNew=mode==='new';
  d.innerHTML=`<h3 style="margin-top:0;font-size:16px">${isNew?'สร้าง plant ใหม่':'เปลี่ยนชื่อ plant'}</h3>
  <div class="f"><label class="w">ชื่อ plant<input id="plantName" maxlength="60" value="${isNew?'':esc(P?P.name:'')}" placeholder="เช่น PD2 ชั้น 3"></label></div>
  ${isNew?'<p class="muted">plant ใหม่เริ่มว่าง แล้วเปิดแบบพื้นหลังจากแท็บ “แบบพื้นหลัง” หรือเมนู ⋯ · ทุกคนที่มีลิงก์นี้จะเห็นแท็บใหม่ทันที</p>':''}
  <div class="row"><button class="btn pri" type="button" id="plantOk">${isNew?'สร้าง':'บันทึกชื่อ'}</button><button class="btn" type="button" data-m="close">ยกเลิก</button></div>`;
  if(!d.open)d.showModal();
  const inp=$('#plantName');setTimeout(()=>{if(inp){inp.focus();inp.select()}},30);
  const ok=$('#plantOk');
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();ok.click()}});
  ok.onclick=async e=>{e.stopPropagation();const name=inp.value.trim().slice(0,60);if(!name){inp.focus();return}d.close();
    try{if(isNew){const id='p'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);
        const order=Math.max(0,...CO.plants.map(p=>p.order))+1;
        await coEnsureMain();
        await CO.db.collection('plants').doc(id).set({name,order,col:'plants/'+id+'/items'});
        CO.plants.push({id,name,order,col:'plants/'+id+'/items'});switchPlant(id);toast('สร้าง “'+name+'” แล้ว เปิดแบบพื้นหลังได้ที่แท็บ “แบบพื้นหลัง”')}
      else if(P){await coEnsureMain();await CO.db.collection('plants').doc(P.implicit?'main':P.id).set({name,order:P.order,col:P.col});toast('เปลี่ยนชื่อแล้ว')}}
    catch(err){toast('บันทึกไม่สำเร็จ ('+(err&&err.code||'error')+')')}}}
/* the first plant lives in `items` without a registry entry until someone names it or adds another plant */
async function coEnsureMain(){const M=CO.plants.find(p=>p.implicit);if(!M)return;
  await CO.db.collection('plants').doc('main').set({name:M.name,order:0,col:MAIN_COL});M.implicit=false}

/* ---------- per-person undo ---------- */
function coRevert(E,from,to){let skip=0;
  for(const k of Object.keys(E[from])){const cur=CO.base.has(k)?CO.base.get(k):null;
    if(cur!==E[to][k]){skip++;continue}coApply(k,E[from][k])}
  coFlush(false);if(CO.bgDirty&&U.loaded){CO.bgDirty=false;rebuildUnderlay()}
  if(skip)toast(`มี ${skip} รายการที่คนอื่นแก้ต่อแล้ว จึงไม่ย้อนรายการนั้น`)}
function coHooks(){
  HIST.changed=()=>coFlush(true);
  HIST.commit=()=>{coFlush(true);CO.E.push({b:{},a:{}});CO.R.length=0};
  HIST.sync=()=>{if(CO.E.length>undo.length)CO.E.splice(0,CO.E.length-undo.length);if(CO.R.length>redo.length)CO.R.splice(0,CO.R.length-redo.length)};
  HIST.undo=()=>{coFlush(true);if(!undo.length)return;redo.push(undo.pop());const E=CO.E.pop();
    if(E){coRevert(E,'b','a');CO.R.push(E)}T.sel=null;changed();updHist()};
  HIST.redo=()=>{coFlush(true);if(!redo.length)return;undo.push(redo.pop());const E=CO.R.pop();
    if(E){coRevert(E,'a','b');CO.E.push(E)}T.sel=null;changed();updHist()};
  HIST.revert=()=>{coFlush(true);if(!undo.length)return;undo.pop();const E=CO.E.pop();if(E)coRevert(E,'b','a');changed(true);updHist()};
  HIST.layout=L=>{if(CO.ready)coLayoutUp(L)};
  HIST.draw=coDraw}

/* ---------- presence ---------- */
const coName=p=>{const id=p.by||(p.presence&&typeof p.presence.uid==='string'?p.presence.uid:null);const pr=id&&CO.prof[id];return(pr&&pr.name)||'ผู้ใช้'};
const coColor=p=>{const id=p.by||(p.presence&&p.presence.uid);const pr=id&&CO.prof[id];const c=(pr&&pr.color)||(p.presence&&p.presence.who&&p.presence.who.c);return typeof c==='string'?c:'#e8590c'};
/* other people; all=false keeps only those on the plant shown here */
function coOthers(all){return CO.peers.filter(p=>!p.isMe&&p.kind==='viewer'&&(all||!p.presence||p.presence.plant===undefined||p.presence.plant===CO.pid))}
function coDraw(ctx){
  for(const p of coOthers()){const pr=p.presence||{};const col=coColor(p);ctx.save();
    if(Date.now()-p.updatedAt>90000)ctx.globalAlpha=0.45;
    if(typeof pr.sel==='string'){const i=pr.sel.indexOf('-'),t=pr.sel.slice(0,i),id=+pr.sel.slice(i+1),o=(S[LK[t]]||[]).find(q=>q.id===id);
      let poly=null;if(o&&t==='room')poly=o.pts;else if(o&&t==='machine')poly=machinePoly(o);
      if(poly){ctx.strokeStyle=col;ctx.lineWidth=2.5;ctx.setLineDash([7,4]);ctx.beginPath();poly.forEach((v,j)=>{const s=w2s(v[0],v[1]);j?ctx.lineTo(s[0],s[1]):ctx.moveTo(s[0],s[1])});ctx.closePath();ctx.stroke();ctx.setLineDash([])}}
    if(Array.isArray(pr.c)&&isFinite(pr.c[0])&&isFinite(pr.c[1])){const s=w2s(+pr.c[0],+pr.c[1]);
      ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[0]+4,s[1]+15);ctx.lineTo(s[0]+7.5,s[1]+9);ctx.lineTo(s[0]+14,s[1]+8);ctx.closePath();ctx.fill();
      const nm=coName(p);ctx.font=`500 12px ${css('--font')}`;const w=ctx.measureText(nm).width+10;
      ctx.fillRect(s[0]+12,s[1]+12,w,18);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(nm,s[0]+17,s[1]+21)}
    ctx.restore()}}
let profT=0;
function coPeers(ch){CO.peers=ch.peers||[];
  const ids=[...new Set(CO.peers.map(p=>p.by||(p.presence&&p.presence.uid)).filter(x=>typeof x==='string'))];
  if(CO.user&&ids.length&&!profT){profT=setTimeout(()=>{profT=0;CO.user.profiles(ids).then(ps=>{CO.prof=Object.assign(CO.prof,ps||{});coStatus();render()}).catch(()=>{})},50)}
  coStatus();coTabs();render()}
function coPresence(patch){if(CO.room)CO.room.presence(patch).catch(()=>{})}

/* ---------- status chip ---------- */
function coStatus(){const el=$('#collab');if(!el||!CO.on)return;el.hidden=false;
  const people=new Set(coOthers(true).map(p=>p.by||p.peer)).size;
  let st;if(!CO.ready)st='กำลังเชื่อม…';else if(CO.ro)st='ดูอย่างเดียว';else if(CO.err)st=CO.err;else if(CO.pend.size||CO.inflight.size)st='กำลังบันทึก…';else st='บันทึกแล้ว';
  el.textContent=`👥 ${people+1} · ${st}`;el.classList.toggle('busy',st==='กำลังบันทึก…'||st==='กำลังเชื่อม…');el.classList.toggle('bad',!!CO.err||st==='ดูอย่างเดียว')}
function coDialog(){const d=$('#dlg'),o=coOthers(true);
  const where=p=>{const pl=plantOf(p.presence&&p.presence.plant);return pl?' · '+esc(pl.name):''};
  d.innerHTML=`<h3 style="margin-top:0;font-size:16px">งานร่วม (แก้ไขพร้อมกัน)</h3>
  <p>เปิดอยู่ตอนนี้ ${o.length+1} คน (รวมคุณ)</p>
  <ul>${o.map(p=>`<li><span class="sw" style="background:${esc(coColor(p))}"></span> ${esc(coName(p))}${p.guest?' (ภายนอก)':''}<span class="muted">${where(p)}</span></li>`).join('')||'<li class="muted">มีแค่คุณ</li>'}</ul>
  <p class="muted">ทุกการแก้ไขบันทึกขึ้นงานร่วมทันที คนที่มีสิทธิ์เปิดลิงก์นี้เห็นทุก plant (แท็บด้านบน) · สิทธิ์ตั้งที่ปุ่ม Share ของ Claude: Contributor/Editor แก้ได้ Viewer ดูอย่างเดียว · เปลี่ยนแบบพื้นหลังได้เฉพาะ Editor/เจ้าของ
  · Ctrl+Z ย้อนเฉพาะสิ่งที่คุณแก้เอง ถ้าคนอื่นแก้รายการนั้นต่อแล้วจะไม่ย้อนทับ · ถ้าสองคนแก้รายการเดียวกันพร้อมกัน ค่าที่บันทึกทีหลังจะถูกใช้
  · Draft และไฟล์ .json ยังใช้ได้ (เก็บสำเนาไว้เอง) · เปิดไฟล์โครงการหรือ draft = แทนที่งานของ plant ที่เปิดอยู่ สำหรับทุกคน (กด Ctrl+Z ย้อนได้)</p>
  <div class="row"><button class="btn" data-m="close">ปิด</button></div>`;
  if(!d.open)d.showModal()}

/* ---------- start ---------- */
let coStarted=false;
async function collabStart(){
  if(coStarted)return;coStarted=true;
  if(!(window.claude&&typeof claude.use==='function'))return;
  let db=null;try{db=await claude.use('db')}catch(e){db=null}
  if(!db)return;
  CO.db=db;CO.on=true;
  CO.cfg0=JSON.stringify({minAisle:1.2,minDP:5,wallH:3.5,colorBy:'pa',groupMove:true,ach:{...ACH_DEF},spec:{...SPEC_DEF}});
  try{CO.user=await claude.use('user')}catch(e){CO.user=null}
  try{CO.assets=await claude.use('assets')}catch(e){CO.assets=null}
  try{CO.room=await claude.use('room')}catch(e){CO.room=null}
  if(CO.user){try{CO.isOwner=!!(await CO.user.isOwner())}catch(e){}
    try{CO.canEdit=!!(await CO.user.canEdit())}catch(e){}
    try{const w=await CO.user.can('data.write');CO.canWrite=w;if(w===false)CO.ro=true}catch(e){}}
  coHooks();
  const el=$('#collab');if(el){el.onclick=coDialog}
  const tabs=$('#plants');
  if(tabs)tabs.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.plant){if(b.dataset.plant!==CO.pid){switchPlant(b.dataset.plant)}return}
    if(b.dataset.plantAdd!==undefined){plantDialog('new');return}
    if(b.dataset.plantRen!==undefined){plantDialog('rename');return}
    if(b.dataset.plantDel!==undefined)deletePlant()});
  coStatus();
  /* plant registry; until it answers (or if it cannot), show the first plant */
  let regOk=false;
  const regSub=()=>db.collection('plants').onSnapshot(s=>{if(s.metadata.fromCache&&!s.docs.length&&!regOk)return;regOk=true;coPlantsSnap(s)},e=>{
    if(e&&e.code==='unavailable'){setTimeout(regSub,3000);return}
    if(!regOk){regOk=true;coPlantsSnap({docs:[]})}});
  regSub();
  setTimeout(()=>{if(!regOk){regOk=true;coPlantsSnap({docs:[]})}},6000);
  if(CO.room){
    CO.room.onPeers(coPeers,()=>{});
    CO.room.onConnection(c=>{CO.conn=c;coStatus()},()=>{});
    try{const uid=CO.user?await CO.user.id():null;const me=CO.user?await CO.user.me():null;
      coPresence({uid:uid||null,who:me&&me.color?{c:me.color,t:Date.now()}:null,plant:CO.pid||null})}catch(e){}
    let last=0;
    c2.addEventListener('pointermove',e=>{const now=Date.now();if(now-last<40)return;last=now;const sp=pt(e),w=s2w(sp[0],sp[1]);coPresence({c:[r2(w[0]),r2(w[1])]})});
    c2.addEventListener('pointerleave',()=>coPresence({c:null}));
    let lastSel='';setInterval(()=>{const s=T.sel?T.sel.type+'-'+T.sel.id:'';if(s!==lastSel){lastSel=s;coPresence({sel:s||null})}},300);
    setInterval(()=>{if(coOthers().length)render()},15000)}
}
/* app init may already have finished before this script ran */
if(window.__appReady)collabStart();
