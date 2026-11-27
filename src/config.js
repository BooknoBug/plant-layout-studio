/* Plant Layout Studio — config.js
   Everything a user is likely to want to change lives here: machine library, door types,
   room types (default grade / pressure), flow types, cleanliness grades, ACH and room-condition defaults,
   and which background layers count as walls. Values are planning defaults, not regulatory limits. */
'use strict';
const APP_VERSION='1.18.0';
const LIB=[
 {k:'press',n:'เครื่องตอกเม็ด',w:1.5,d:1.3,h:2.2,c:0.8,col:'#3b5bdb'},
 {k:'blender',n:'เครื่องผสมแห้ง',w:2.0,d:1.6,h:2.5,c:0.8,col:'#3b5bdb'},
 {k:'granulator',n:'เครื่องทำแกรนูล',w:2.2,d:1.8,h:2.8,c:1.0,col:'#3b5bdb'},
 {k:'fbd',n:'เครื่องอบ FBD',w:2.5,d:1.8,h:3.0,c:1.0,col:'#3b5bdb'},
 {k:'sifter',n:'เครื่องร่อน',w:1.0,d:1.0,h:1.8,c:0.6,col:'#3b5bdb'},
 {k:'coater',n:'เครื่องเคลือบ',w:2.5,d:1.8,h:2.4,c:1.0,col:'#3b5bdb'},
 {k:'blister',n:'เครื่องบรรจุแผง',w:4.0,d:1.4,h:1.9,c:0.8,col:'#3b5bdb'},
 {k:'cartoner',n:'เครื่องบรรจุกล่อง',w:3.5,d:1.3,h:1.9,c:0.8,col:'#3b5bdb'},
 {k:'booth',n:'ตู้ชั่ง/จ่ายวัตถุดิบ',w:2.4,d:2.0,h:2.4,c:0.8,col:'#0c8f82'},
 {k:'passbox',n:'Pass box',w:0.6,d:0.6,h:0.8,c:0.5,col:'#0c8f82'},
 {k:'dust',n:'เครื่องดูดฝุ่น',w:0.8,d:0.8,h:2.0,c:0.5,col:'#7a8594'},
 {k:'ipc',n:'โต๊ะ IPC',w:1.8,d:0.8,h:0.9,c:0.6,col:'#7a8594'},
 {k:'wash',n:'อ่างล้าง',w:1.5,d:0.8,h:0.9,c:0.6,col:'#7a8594'},
 {k:'rack',n:'ชั้นวางพาเลท',w:2.7,d:1.1,h:4.0,c:1.0,col:'#7a8594'},
 {k:'panel',n:'ตู้ควบคุม',w:0.8,d:0.4,h:2.0,c:0.8,col:'#7a8594'},
 {k:'lift',n:'ลิฟต์',w:2.1,d:2.4,h:3.5,c:1.2,col:'#e8590c'},
 {k:'stair_up',n:'บันไดขึ้น',w:1.4,d:5.0,h:3.5,c:1.2,col:'#e8590c'},
 {k:'stair_dn',n:'บันไดลง',w:1.4,d:5.0,h:3.5,c:1.2,col:'#e8590c'},
 {k:'stair_fire',n:'บันไดหนีไฟ',w:2.4,d:5.5,h:3.5,c:1.2,col:'#e8590c'},
 {k:'bin',n:'ถัง IBC / Bin',w:1.2,d:1.2,h:1.8,c:0.6,col:'#3b5bdb'},
 {k:'lifter',n:'Bin lifter',w:1.6,d:1.6,h:3.5,c:1.0,col:'#3b5bdb'},
 {k:'mill',n:'เครื่องบด (Mill)',w:1.0,d:0.8,h:1.6,c:0.8,col:'#3b5bdb'},
 {k:'dedust',n:'Deduster',w:0.6,d:0.5,h:1.2,c:0.5,col:'#3b5bdb'},
 {k:'metal',n:'Metal detector',w:0.6,d:0.6,h:1.2,c:0.5,col:'#3b5bdb'},
 {k:'airshower',n:'Air shower',w:1.4,d:1.2,h:2.2,c:0.5,col:'#0c8f82'},
 {k:'rag',n:'ช่องลมกลับ (Return)',w:0.6,d:0.25,h:0.6,c:0,col:'#c92a2a'},
 {k:'wastebin',n:'ถังขยะ',w:0.6,d:0.6,h:0.9,c:0.3,col:'#c92a2a'},
 {k:'custom',n:'กำหนดเอง',w:1.0,d:1.0,h:1.0,c:0.8,col:'#7a8594'}
];
const DOORS=[
 {k:'s90',n:'บานเดี่ยว 0.9',w:0.9,dbl:false},
 {k:'s120',n:'บานเดี่ยว 1.2 (วัสดุ)',w:1.2,dbl:false},
 {k:'d150',n:'บานคู่ 1.5',w:1.5,dbl:true},
 {k:'d180',n:'บานคู่ 1.8',w:1.8,dbl:true}
];
const GRADES=['A','B','C','D','CNC','ไม่จัดเกรด'];
const GCOL={'A':'#d6336c','B':'#7048e8','C':'#1c7ed6','D':'#0c8f82','CNC':'#e67700','ไม่จัดเกรด':'#868e96'};
/* room types: default grade/pressure follow the old PTOC 2nd-floor cleanroom layout (corridor 30, process 15, cleaned equipment 45) */
const RTYPES=[
 {k:'process',n:'ห้องผลิต',grade:'D',pa:15},
 {k:'corridor',n:'ทางเดิน',grade:'D',pa:30},
 {k:'clean_eq',n:'เก็บอุปกรณ์สะอาด',grade:'D',pa:45},
 {k:'washing',n:'ห้องล้าง',grade:'D',pa:15},
 {k:'airlock',n:'Airlock',grade:'D',pa:15},
 {k:'gowning',n:'ห้องเปลี่ยนชุด',grade:'D',pa:15},
 {k:'janitor',n:'Janitor',grade:'D',pa:15},
 {k:'weighing',n:'ห้องชั่ง/IPC',grade:'D',pa:15},
 {k:'office',n:'สำนักงาน',grade:'CNC',pa:0},
 {k:'store',n:'คลัง',grade:'ไม่จัดเกรด',pa:0},
 {k:'other',n:'อื่นๆ',grade:'D',pa:15}];
const RT=k=>RTYPES.find(t=>t.k===k)||RTYPES[RTYPES.length-1];
const FLOWS=[
 {k:'person',n:'คน',col:'#1c7ed6',side:'p'},
 {k:'material',n:'วัตถุดิบ',col:'#2b8a3e',side:'c'},
 {k:'product',n:'ผลิตภัณฑ์',col:'#7048e8',side:'c'},
 {k:'clean_eq',n:'อุปกรณ์สะอาด',col:'#0c8599',side:'c'},
 {k:'dirty_eq',n:'อุปกรณ์สกปรก',col:'#e8590c',side:'d',dash:true},
 {k:'waste',n:'ของเสีย',col:'#c92a2a',side:'d',dash:true}];
const FL=k=>FLOWS.find(f=>f.k===k)||FLOWS[0];
const ACH_DEF={A:0,B:40,C:20,D:15,CNC:6,'ไม่จัดเกรด':0};
const SPEC_DEF={A:'',B:'',C:'',D:'22±2 °C · 50±10 %RH',CNC:'23±2 °C · RH ไม่ควบคุม','ไม่จัดเกรด':'23±2 °C · RH ไม่ควบคุม'};
const LK={room:'rooms',machine:'machines',door:'doors',flow:'flows',dim:'dims'};
const PA_PRESETS=[-15,0,15,30,45];
const WALL_LAYERS=['AR-WALL','AR WALL','$0$AR-WALL','wall-1','AR-SYMBOL WALL','A-Wall','WALL','hat-wall'];
const SNAP_LAYERS=[...WALL_LAYERS,'COL','01COL','AR-LIFT-COR','ST'];
const DEF_VIS=['AR-WALL','AR WALL','$0$AR-WALL','wall-1','AR-SYMBOL WALL','A-Wall','WALL','COL','01COL','AR-DOOR','ST','AR-WINDOWS','AR-GRID LINES','AR-LIFT-COR','AR-DOOR&WINDOW','door','AR-SANITARY FUR','AR-FUR_WC','TILE-GRID'];

