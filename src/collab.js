/* Plant Layout Studio — collab.js
   Shared editing when the page runs as a Claude artifact (claude.ai). Outside Claude it does nothing.
   - Every room / machine / door / flow / dim is one db document (items/room-12 ...), plus items/cfg, items/bg
     (erased background lines) and items/layout (pointer to the background file stored as an artifact asset).
   - Local edits are found by diffing S against the last shared state (CO.base) each time changed() runs,
     and written per document (one write at a time per document, bursts coalesced).
   - Undo/redo is per person: each step remembers only the documents that person changed, and an item someone
     else changed since is left alone.
   - Who can edit comes from the artifact's sharing (Contributor and up edit, Viewer only looks).
   - Presence: everyone's cursor and selection are drawn on the plan. */
'use strict';
const CO={on:false,ready:false,db:null,room:null,user:null,assets:null,ro:false,isOwner:false,
  base:new Map(),remote:new Map(),pend:new Map(),inflight:new Set(),E:[],R:[],
  peers:[],prof:{},conn:false,layoutDoc:null,bgDirty:false,err:'',roT:0};
const COL='items';
const canon=v=>{if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
  if(Array.isArray(v))return'['+v.map(canon).join(',')+']';
  return'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

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
    coQueue(k,b)}
  if(back){if(CO.bgDirty&&U.loaded){CO.bgDirty=false;rebuildUnderlay()}if(T.sel&&!getSel())T.sel=null;render();
    if(Date.now()-CO.roT>3000){CO.roT=Date.now();toast('คุณมีสิทธิ์ดูอย่างเดียว ขอสิทธิ์ Contributor/Editor จากเจ้าของงานเพื่อแก้ไข')}}}

/* ---------- writing ---------- */
let pumpT=0;
function coQueue(k,v){CO.pend.set(k,v);coStatus();if(!pumpT)pumpT=setTimeout(coRun,150)}
function coRun(){pumpT=0;
  for(const[k,v]of[...CO.pend]){if(CO.inflight.has(k))continue;if(CO.inflight.size>=6)break;
    CO.pend.delete(k);CO.inflight.add(k);
    coWrite(k,v).then(ok=>{CO.inflight.delete(k);
      /* the store now holds what we wrote (a later write by someone else arrives as a snapshot) */
      if(ok){if(v==null)CO.remote.delete(k);else CO.remote.set(k,v)}
      coSettle(k);if(CO.pend.size&&!pumpT)pumpT=setTimeout(coRun,150);coStatus()})}}
async function coWrite(k,v){const ref=CO.db.collection(COL).doc(k);
  const go=()=>v==null?ref.delete():ref.set({o:JSON.parse(v)});
  try{await go();CO.err='';return true}catch(e){
    if(e&&e.code==='unavailable'){await sleep(400+Math.random()*800);try{await go();CO.err='';return true}catch(e2){e=e2}}
    coWriteErr(e);return false}}
function coWriteErr(e){const c=e&&e.code||'error';
  if(c==='invalid_argument'&&CO.canWrite!==true){CO.ro=true;toast('งานร่วมนี้คุณดูได้อย่างเดียว การแก้ไขไม่ถูกบันทึก')}
  else if(c==='quota_exceeded')toast('ที่เก็บงานร่วมเต็ม ลบรายการที่ไม่ใช้ก่อน');
  else if(c==='revoked'){CO.ro=true;CO.err='ถูกปิดสิทธิ์'}
  else{CO.err='บันทึกไม่สำเร็จ';toast('บันทึกงานร่วมไม่สำเร็จ ('+c+') จะลองใหม่เมื่อแก้ครั้งถัดไป')}}
/* after our write settles, take the shared value if it differs (someone else wrote, or our write failed) */
function coSettle(k){if(CO.pend.has(k)||CO.inflight.has(k))return;
  const r=CO.remote.has(k)?CO.remote.get(k):null,b=CO.base.has(k)?CO.base.get(k):null;
  if(r!==b){coApply(k,r);if(r==null)CO.base.delete(k);else CO.base.set(k,r);coRefresh()}}

/* ---------- reading ---------- */
function coSnap(snap){let touched=false;
  for(const ch of snap.docChanges()){const k=ch.doc.id,d=ch.type==='removed'?null:ch.doc.data();
    if(k==='layout'){CO.layoutDoc=d||null;if(CO.ready)coUseLayout();continue}
    const js=d&&d.o!==undefined?canon(d.o):null;
    if(js==null)CO.remote.delete(k);else CO.remote.set(k,js);
    if(!CO.ready||CO.pend.has(k)||CO.inflight.has(k))continue;
    const b=CO.base.has(k)?CO.base.get(k):null;if(b===js)continue;
    coApply(k,js);if(js==null)CO.base.delete(k);else CO.base.set(k,js);touched=true}
  if(!CO.ready&&!snap.metadata.fromCache)coFirst();
  else if(touched)coRefresh()}
async function coFirst(){
  CO.ready=true;clearTimeout(CO.loadT);
  const keys=[...CO.remote.keys()];
  if(!keys.length){
    /* nothing shared yet: the owner's work in this browser becomes the shared work; others start empty */
    if(CO.isOwner&&!CO.ro){CO.base=new Map();coFlush(false);if(U.loaded&&!CO.layoutDoc)coLayoutUp(U.raw)}
    else{S.rooms=[];S.machines=[];S.doors=[];S.flows=[];S.dims=[];S.bgHidden=[];S.bgErase=[];CO.bgDirty=true;CO.base=coLocal()}}
  else{
    S.rooms=[];S.machines=[];S.doors=[];S.flows=[];S.dims=[];
    if(!CO.remote.has('bg')){S.bgHidden=[];S.bgErase=[];CO.bgDirty=true}
    for(const k of keys)coApply(k,CO.remote.get(k));
    CO.base=coLocal();
    /* keys we hold locally but nobody shared yet (e.g. cfg) are not pushed until changed */
    for(const k of[...CO.base.keys()])if(!CO.remote.has(k))CO.base.delete(k)}
  nextId=Math.max(nextId,Date.now()*100+Math.floor(Math.random()*100));
  undo.length=0;redo.length=0;CO.E.length=0;CO.R.length=0;updHist();T.sel=null;
  await coUseLayout();
  coRefresh();fitView();renderDock();
  toast(keys.length?'เปิดงานร่วมแล้ว ทุกคนที่มีสิทธิ์เห็นการแก้ไขทันที':'งานร่วมยังว่าง');coStatus()}

/* ---------- background layout (stored once as an asset, pointer in items/layout) ---------- */
let layBusy=false;
async function coUseLayout(){const d=CO.layoutDoc;if(!d||!d.id||(U.loaded&&U.id===d.id)||layBusy)return;
  layBusy=true;
  try{let L=null;const x=getLayouts()[d.id];if(x)L=x.data;
    if(!L&&typeof d.asset==='string'&&/^[0-9a-f]{32}$/.test(d.asset)){const r=await fetch('/_blob/'+d.asset);if(!r.ok)throw 0;L=await r.json()}
    if(!L)throw 0;L=normLayout(L);prepUnderlay(L);try{localStorage.setItem(LCUR,L.id)}catch(e){}
    fitView();coRefresh();toast('ใช้แบบพื้นหลังของงานร่วม “'+L.name+'”')}
  catch(e){toast('โหลดแบบพื้นหลังของงานร่วมไม่ได้')}
  layBusy=false}
async function coLayoutUp(L){
  if(!CO.on||!L||(CO.layoutDoc&&CO.layoutDoc.id===L.id))return;
  if(!CO.assets){toast('เฉพาะ Editor/เจ้าของเปลี่ยนแบบพื้นหลังของงานร่วมได้ (เปลี่ยนแค่ในเครื่องนี้)');return}
  try{toast('กำลังอัปโหลดแบบพื้นหลังให้ทุกคน…');
    const a=await CO.assets.upload(new Blob([JSON.stringify(L)],{type:'application/json'}),{type:'application/json'});
    await CO.db.collection(COL).doc('layout').set({asset:a.id,id:L.id,name:String(L.name||''),origin:L.origin||[0,0]});
    toast('ทุกคนใช้แบบพื้นหลัง “'+L.name+'” แล้ว')}
  catch(e){toast('อัปโหลดแบบพื้นหลังไม่สำเร็จ ('+(e&&e.code||'error')+')')}}

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
function coOthers(){return CO.peers.filter(p=>!p.isMe&&p.kind==='viewer')}
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
  coStatus();render()}
function coPresence(patch){if(CO.room)CO.room.presence(patch).catch(()=>{})}

/* ---------- status chip ---------- */
function coStatus(){const el=$('#collab');if(!el||!CO.on)return;el.hidden=false;
  const people=new Set(coOthers().map(p=>p.by||p.peer)).size;
  let st;if(!CO.ready)st='กำลังเชื่อม…';else if(CO.ro)st='ดูอย่างเดียว';else if(CO.err)st=CO.err;else if(CO.pend.size||CO.inflight.size)st='กำลังบันทึก…';else st='บันทึกแล้ว';
  el.textContent=`👥 ${people+1} · ${st}`;el.classList.toggle('busy',st==='กำลังบันทึก…'||st==='กำลังเชื่อม…');el.classList.toggle('bad',!!CO.err||st==='ดูอย่างเดียว')}
function coDialog(){const d=$('#dlg'),o=coOthers();
  d.innerHTML=`<h3 style="margin-top:0;font-size:16px">งานร่วม (แก้ไขพร้อมกัน)</h3>
  <p>เปิดอยู่ตอนนี้ ${o.length+1} คน (รวมคุณ)</p>
  <ul>${o.map(p=>`<li><span class="sw" style="background:${esc(coColor(p))}"></span> ${esc(coName(p))}${p.guest?' (ภายนอก)':''}</li>`).join('')||'<li class="muted">มีแค่คุณ</li>'}</ul>
  <p class="muted">ทุกการแก้ไขบันทึกขึ้นงานร่วมทันที คนที่มีสิทธิ์เปิดลิงก์นี้เห็นเหมือนกัน · สิทธิ์ตั้งที่ปุ่ม Share ของ Claude: Contributor/Editor แก้ได้ Viewer ดูอย่างเดียว · เปลี่ยนแบบพื้นหลังได้เฉพาะ Editor/เจ้าของ
  · Ctrl+Z ย้อนเฉพาะสิ่งที่คุณแก้เอง ถ้าคนอื่นแก้รายการนั้นต่อแล้วจะไม่ย้อนทับ · ถ้าสองคนแก้รายการเดียวกันพร้อมกัน ค่าที่บันทึกทีหลังจะถูกใช้
  · Draft และไฟล์ .json ยังใช้ได้ (เก็บสำเนาไว้เอง) · เปิดไฟล์โครงการหรือ draft = แทนที่งานร่วมของทุกคน (กด Ctrl+Z ย้อนได้)</p>
  <div class="row"><button class="btn" data-m="close">ปิด</button></div>`;
  if(!d.open)d.showModal()}

/* ---------- start ---------- */
async function collabStart(){
  if(!(window.claude&&typeof claude.use==='function'))return;
  let db=null;try{db=await claude.use('db')}catch(e){db=null}
  if(!db)return;
  CO.db=db;CO.on=true;
  try{CO.user=await claude.use('user')}catch(e){CO.user=null}
  try{CO.assets=await claude.use('assets')}catch(e){CO.assets=null}
  try{CO.room=await claude.use('room')}catch(e){CO.room=null}
  if(CO.user){try{CO.isOwner=!!(await CO.user.isOwner())}catch(e){}
    try{const w=await CO.user.can('data.write');CO.canWrite=w;if(w===false)CO.ro=true}catch(e){}}
  coHooks();
  const el=$('#collab');if(el){el.onclick=coDialog}
  coStatus();
  CO.loadT=setTimeout(()=>{if(!CO.ready){CO.err='ยังเชื่อมงานร่วมไม่ได้';coStatus()}},10000);
  const sub=()=>{CO.unsub=db.collection(COL).onSnapshot(coSnap,e=>{
    if(e&&e.code==='unavailable'){setTimeout(sub,3000);return}
    CO.err='ขาดการเชื่อมต่อ';coStatus()})};
  sub();
  if(CO.room){
    CO.room.onPeers(coPeers,()=>{});
    CO.room.onConnection(c=>{CO.conn=c;coStatus()},()=>{});
    try{const uid=CO.user?await CO.user.id():null;const me=CO.user?await CO.user.me():null;
      coPresence({uid:uid||null,who:me&&me.color?{c:me.color,t:Date.now()}:null})}catch(e){}
    let last=0;
    c2.addEventListener('pointermove',e=>{const now=Date.now();if(now-last<40)return;last=now;const sp=pt(e),w=s2w(sp[0],sp[1]);coPresence({c:[r2(w[0]),r2(w[1])]})});
    c2.addEventListener('pointerleave',()=>coPresence({c:null}));
    let lastSel='';setInterval(()=>{const s=T.sel?T.sel.type+'-'+T.sel.id:'';if(s!==lastSel){lastSel=s;coPresence({sel:s||null})}},300);
    setInterval(()=>{if(coOthers().length)render()},15000)}
}
