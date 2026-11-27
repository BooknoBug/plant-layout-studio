# Developer guide

สำหรับคนหรือ AI ที่จะมาปรับปรุงโปรแกรมต่อ อ่านไฟล์นี้ก่อนแก้

## ภาพรวม
- เว็บแอปไฟล์เดียว ไม่มี framework ไม่มี dependency (canvas 2D + JS ล้วน)
- ซอร์สอยู่ใน `src/` · `tools/build.py` รวม `style.css` + `config.js` + `app.js` เป็น `index.html` (ไม่มีแบบพื้นหลังข้างใน)
- `python3 tools/build.py --embed layouts/X.layout.json --out dist/x.html` = รุ่นที่ฝังแบบไว้ (ใช้กับ Claude artifact)
- ทดสอบ: `node tests/smoke.mjs` (รัน `index.html` ใน Node ด้วย DOM จำลอง + แบบจำลองใน `tests/fixtures`) ไม่ได้ทดสอบหน้าจอจริง ให้เปิดเบราว์เซอร์ดูเองทุกครั้ง
- ระหว่างพัฒนา: `python3 -m http.server` ที่ root แล้วเปิด `http://localhost:8000/src/` (โหลด `layouts/PD2-floor2.layout.json` ถ้ามีในเครื่อง)

## หน่วยและพิกัด
- เมตร แกน y ชี้ขึ้น (เหมือน AutoCAD) พิกัดในโปรแกรม = พิกัด DWG − `origin` ของแบบพื้นหลัง
- แบบ PD2 ชั้น 2: origin = DWG (6140, 1354)
- ตาราง 1 ม.: x = n + 0.37, y = n + 0.09 · แนวเสา 6 ม. x = 7.37, 13.37, 19.37 … y = 16.09, 22.09, 28.09, 34.09, 42.09 (ช่วง 8 ม.), 48.09, 54.09, 60.09
- ส่งออก DXF บวก origin กลับ จึงซ้อนกับแบบสถาปนิกตรงตำแหน่ง

## ข้อมูลโครงการ (`S` ใน app.js) — สิ่งที่ถูกบันทึก
```
rooms    {id, name, type, grade, pa, h, pts:[[x,y]...]}
machines {id, k, name, x, y, w, d, h, clear, rot, col}
doors    {id, name, x, y, ang, w, dbl, side(±1), hinge(±1), interlock}
flows    {id, kind, name, pts}
dims     {id, a:[x,y], b:[x,y]}
bgHidden ["LAYER@x0,y0,x1,y1,nPts", ...]   เส้นพื้นหลังที่ลบ (จำด้วยตำแหน่ง)
layoutRef {id, name, origin}                แบบพื้นหลังที่งานนี้ใช้
cfg      {minAisle, minDP, wallH, colorBy, ach:{grade:n}, spec:{grade:text}}
```
- `projectJSON(embed)` มี `v` (= `PROJECT_FORMAT`), `appVersion`, `layoutRef` · `embed=true` (ไฟล์ที่บันทึกลงเครื่อง/ZIP) ใส่ทั้ง `layout` ไว้ในไฟล์ · draft ใน localStorage ไม่ฝัง
- เปิดงาน: `layoutFor(o)` ใช้ `o.layout` ถ้ามี ไม่งั้นหา `layoutRef.id` ในคลังแบบของเบราว์เซอร์
- **เพิ่ม field ที่ต้องบันทึก**: เพิ่มใน `snapState`, `applyProj`, `projectJSON` แล้วเพิ่ม `PROJECT_FORMAT` + ขั้นใน `migrateProject` ให้ไฟล์เก่ายังเปิดได้
- localStorage: `pls-project-v1` (งานล่าสุดอัตโนมัติ), `pls-drafts-v1` (draft), `pls-cur-draft`, `pls-layouts-v1` (คลังแบบพื้นหลังที่เคยเปิด), `pls-layout-cur`

## สูตรเพิ่มของที่ขอบ่อย
| อยากได้ | แก้ตรงไหน |
|---|---|
| เครื่องจักรใหม่ / แก้ขนาดตั้งต้น | `LIB` ใน `config.js` (`w` กว้าง, `d` ลึก, `h` สูง, `c` ระยะบริการ, ม.) |
| ประเภทห้อง / ความดันตั้งต้น | `RTYPES` ใน `config.js` |
| ชนิดเส้นทางไหล | `FLOWS` (`side`: `c` สะอาด, `d` สกปรก, `p` คน) |
| เกรด / ACH / สภาวะห้อง | `GRADES`, `GCOL`, `ACH_DEF`, `SPEC_DEF` |
| ชนิดประตู | `DOORS` |
| กฎตรวจใหม่ | `runChecks()` ใน app.js เรียก `add(sev, msg, at, sel)` (`sev` = err/warn/info, `at` = [x,y], `sel` = {type,id}) |
| เครื่องมือใหม่บนแถบ | `TOOLS` + `renderCtx()` + ตัวจัดการ pointer / `tapTool()` + วาดใน `draw2D()` |
| แท็บใหม่ใน dock | ปุ่มใน `src/index.html` + `renderDock()` + ฟังก์ชัน `xxxHTML()` |
| ส่งออกเพิ่ม | `dxfStr()`, `csvStr()` |
แก้แล้ว: เพิ่มเลข `APP_VERSION` ใน config.js + เขียน `CHANGELOG.md` → build → smoke test

## แบบพื้นหลัง (layout) — ทำแบบใหม่ เช่น ชั้นอื่น หรือสถาปนิกส่งแบบแก้
ไฟล์ `.layout.json`:
```
{format:'pls-layout', v:1, id, name, floor, building, source, note, created, units:'m',
 origin:[dwgX,dwgY], bbox, paths:{LAYER:[[[x,y]...]...]}, texts:[[layer,text,x,y,h,rot]...],
 wallLayers?, snapLayers?, defaultVisible?, demoBox?}
```
1. `dwgread -O JSON -o plan.json แบบ.dwg` (LibreDWG 0.13.3 build จากซอร์ส รองรับ AC1032)
2. `python3 tools/extract_sheet.py plan.json --box X0 Y0 X1 Y1 --out source/<ชื่อ>_raw.json`
   (`--box` = กรอบแผ่นผังในพิกัด DWG หน่วยเมตร · ใช้ `--origin` เดิมถ้าต้องการให้งานที่วาดไว้ตรงตำแหน่ง)
3. คัดลอก `tools/layouts/pd2_floor2.py` เป็นสูตรใหม่ แก้ตัด/ตีตาราง/`META`/`LAYOUT_ID` → `layouts/<NAME>.layout.json`
4. ส่งไฟล์ให้ผู้ใช้เปิดในโปรแกรม (ไม่ commit) · ถ้าเลเยอร์ผนังชื่อต่างจากเดิม ใส่ `wallLayers` ในไฟล์
- รุ่นแก้ของแบบเดิม: เพิ่ม `LAYOUT_ID` (r2, r3 …) · ถ้า origin เปลี่ยน โปรแกรมเลื่อนงานที่วาดไว้ให้อยู่ตำแหน่ง DWG เดิมเอง (`shiftProject`)
- อ่าน DWG JSON แบบ UTF-8 errors='replace' (ภาษาไทยถูก) · entity ใน model space = ตัวที่ไม่มี `ownerhandle`

## แก้ไขพร้อมกัน (collab.js)
- ทำงานเฉพาะเมื่อ `claude.use('db')` ได้ (หน้า Claude artifact) นอกนั้น `collabStart()` ออกทันที
- publish: `python3 tools/build.py --out dist/plant-layout-studio.html` แล้ว publish ไฟล์นี้เป็น artifact เดิม (URL เดิม)
  capabilities `{db:{}, user:{scopes:["profile"]}, room:{}, assets:{}, downloads:true}` · ห้ามใช้ `--embed` (แบบพื้นหลังอยู่ใน asset)
- db collection `items`: `room-<id>`, `machine-<id>`, `door-<id>`, `flow-<id>`, `dim-<id>` = `{o:<object>}` · `cfg` · `bg` `{o:{h:bgHidden,e:bgErase}}`
  · `layout` `{asset,id,name,origin}` (ไฟล์ .layout.json เป็น asset, โหลดจาก `/_blob/<asset>`)
- จับการแก้โดย diff `S` กับ `CO.base` ทุกครั้งที่ `changed()` (hook `HIST` ใน app.js) → เขียนทีละ doc ครั้งละ 1 ต่อ doc
  เพิ่มชนิดของใหม่ใน `LK` แล้วซิงก์ให้เอง · field ใหม่ใน cfg ก็ซิงก์เอง
- undo ในโหมดนี้: ทุก `commit()` เปิดขั้น `{b,a}` เก็บเฉพาะ doc ที่คนนั้นแก้ (ไม่ใช่ snapshot ทั้งงาน)
- id ใหม่เริ่มที่ `Date.now()*100` กันชนกันระหว่างเครื่อง
- ทดสอบได้ด้วย `claude` ปลอม (iframe 2 อันแชร์ db ในหน้าเดียว) — ยังไม่มีใน smoke test

## ข้อจำกัดที่รู้
- งานหนึ่งไฟล์ = แบบพื้นหลังหนึ่งชุด (หนึ่งชั้น) ยังไม่รองรับหลายชั้นในไฟล์เดียว
- 3 มิติใช้ painter's algorithm อาจซ้อนผิดลำดับในบางมุม
- กฎตรวจเป็นหลักทั่วไป ไม่ครอบคลุมทุกข้อ GMP และไม่แทนการทบทวนโดย QA / ผู้ออกแบบ
- DXF เป็น R12 ข้อความไทยเข้ารหัส `\U+xxxx` ตรวจใน AutoCAD ก่อนใช้
- ใน Claude artifact ใช้ capability `downloads` ส่งออกไฟล์ นอก Claude ใช้ดาวน์โหลดปกติ

## ขอให้ Claude ปรับปรุงต่อในแชตใหม่
แนบ repo นี้ (หรือ zip) แล้วพิมพ์เช่น “อ่าน docs/DEVELOPER.md แล้วเพิ่ม …” Claude จะแก้ `src/`, build, รัน smoke test และอัปเดต CHANGELOG
