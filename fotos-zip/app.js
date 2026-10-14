'use strict';
/* Fotos a ZIP — app instal·lable. Tot es fa al mòbil: res es puja a cap servidor. */

const items = []; // {file, url, selected, el}
const $ = id => document.getElementById(id);
const grid = $('grid'), statusEl = $('status');
let busy = false, nameTouched = false, lastParts = null, firstItem = null; // firstItem = foto del rètol

/* ---------- utilitats ---------- */
function fmtSize(b){ if(b<1024*1024) return Math.max(1,Math.round(b/1024))+' KB'; return (b/1024/1024).toFixed(1).replace('.',',')+' MB'; }
function setStatus(t,err){ statusEl.textContent=t; statusEl.classList.toggle('err',!!err); }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function cleanName(s){ return s.replace(/[\\/:*?"<>|]+/g,'-').trim(); }
function jpgName(n){ const d=n.lastIndexOf('.'); return (d>0?n.slice(0,d):n)+'.jpg'; }
function uniqueName(name, used){
  if(!used.has(name)){ used.add(name); return name; }
  const dot=name.lastIndexOf('.'); const base=dot>0?name.slice(0,dot):name, ext=dot>0?name.slice(dot):'';
  let n=2; while(used.has(`${base} (${n})${ext}`)) n++;
  const out=`${base} (${n})${ext}`; used.add(out); return out;
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ---------- creador de ZIP propi (sense compressió: les fotos ja estan comprimides) ---------- */
const CRC_TABLE = (()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(buf){ let c=0xFFFFFFFF; for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c^buf[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function dosTime(d){ return ((d.getHours()<<11)|(d.getMinutes()<<5)|(Math.floor(d.getSeconds()/2)))&0xFFFF; }
function dosDate(d){ return (((Math.max(1980,d.getFullYear())-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF; }

async function makeZip(entries, onProgress){
  const enc=new TextEncoder(), parts=[], central=[]; let offset=0;
  for(let i=0;i<entries.length;i++){
    const e=entries[i];
    const data=new Uint8Array(await e.data.arrayBuffer());
    const name=enc.encode(e.name), crc=crc32(data), t=dosTime(e.date), d=dosDate(e.date);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,0,true);
    lh.setUint16(10,t,true); lh.setUint16(12,d,true); lh.setUint32(14,crc,true);
    lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true); lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
    parts.push(lh.buffer,name,data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
    ch.setUint16(12,t,true); ch.setUint16(14,d,true); ch.setUint32(16,crc,true); ch.setUint32(20,data.length,true); ch.setUint32(24,data.length,true);
    ch.setUint16(28,name.length,true); ch.setUint32(42,offset,true);
    central.push(ch.buffer,name);
    offset += 30+name.length+data.length;
    onProgress && onProgress((i+1)/entries.length);
    if(i%5===4) await sleep(0);
  }
  const cdSize=central.reduce((a,p)=>a+(p.byteLength??p.length),0);
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,entries.length,true); end.setUint16(10,entries.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.buffer],{type:'application/zip'});
}

/* ---------- reducció de fotos ---------- */
const PRESETS={mid:{max:1920,q:0.85,target:450*1024},small:{max:1280,q:0.75,target:200*1024}};
async function shrink(file,p){
  if(!file.type.startsWith('image/')||file.type==='image/gif') return null; // vídeos i GIF tal qual
  let bmp;
  try{ bmp=await createImageBitmap(file,{imageOrientation:'from-image'}); }
  catch(e){ try{ bmp=await createImageBitmap(file); }catch(e2){ return null; } }
  const s=Math.min(1,p.max/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
  const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(bmp,0,0,c.width,c.height);
  bmp.close&&bmp.close();
  const enc=q=>new Promise(r=>c.toBlob(r,'image/jpeg',q));
  let q=p.q, blob=await enc(q);
  while(blob && blob.size>p.target && q>0.45){ q=Math.round((q-0.07)*100)/100; blob=await enc(q); }
  let tries=0;
  while(blob && blob.size>p.target && tries<3){
    tries++; const w2=Math.round(c.width*0.85), h2=Math.round(c.height*0.85);
    const c2=document.createElement('canvas'); c2.width=w2; c2.height=h2;
    c2.getContext('2d').drawImage(c,0,0,w2,h2); c.width=w2; c.height=h2; c.getContext('2d').drawImage(c2,0,0); c2.width=c2.height=0;
    blob=await enc(q);
  }
  c.width=c.height=0;
  if(!blob||blob.size>=file.size) return null;
  return blob;
}

/* ---------- graella de fotos ---------- */
function refresh(){
  const sel=items.filter(i=>i.selected);
  const bytes=sel.reduce((a,i)=>a+i.file.size,0);
  $('count').textContent=`${sel.length} de ${items.length} seleccionades`+(sel.length?` · ${fmtSize(bytes)}`:'');
  $('toolbar').hidden=items.length===0;
  $('empty').hidden=items.length>0;
  $('clearAll').hidden=items.length===0;
  if(!busy){ $('makeZip').disabled=sel.length===0; $('sendMail').disabled=sel.length===0; }
  renderFirst();
  autoName();
}
// La primera foto (rètol del local): la triada amb ★, o si no, la primera seleccionada
function getFirst(){ return (firstItem&&firstItem.selected&&items.includes(firstItem)) ? firstItem : items.find(i=>i.selected)||null; }
function orderedSelection(){ const f=getFirst(); const rest=items.filter(i=>i.selected&&i!==f); return f?[f,...rest]:rest; }
function setFirst(item){
  firstItem=item;
  if(!item.selected){ item.selected=true; item.el.setAttribute('aria-pressed','true'); }
  clearParts(); refresh();
  setStatus(`Primera foto: ${item.file.name}`);
}
function renderFirst(){
  const f=getFirst();
  items.forEach(i=>i.cell.classList.toggle('is-first',i===f));
  const box=$('firstBox');
  if(!f){ box.hidden=true; return; }
  box.hidden=false;
  const img=$('firstImg');
  if(img.dataset.src!==f.url){
    img.dataset.src=f.url;
    if(f.file.type.startsWith('video/')){ img.removeAttribute('src'); img.alt='(vídeo)'; } else { img.src=f.url; img.alt=f.file.name; }
  }
  $('firstName').textContent=f.file.name;
  $('firstHint').textContent = (firstItem===f) ? 'Triada per tu. Anirà la primera del ZIP.' : 'Per defecte és la primera. Toca ★ a la foto del rètol per canviar-la.';
}
function autoName(){
  if(nameTouched) return;
  const first=getFirst();
  if(!first){ $('zipName').value=''; $('zipName').placeholder=`fotos_${todayStr()}`; return; }
  const n=first.file.name, d=n.lastIndexOf('.');
  $('zipName').value=cleanName(d>0?n.slice(0,d):n)+`_${todayStr()}`;
}
function addFiles(list){
  const seen=new Set(items.map(i=>i.file.name+'|'+i.file.size+'|'+i.file.lastModified));
  for(const file of list){
    const key=file.name+'|'+file.size+'|'+file.lastModified;
    if(seen.has(key)) continue; seen.add(key);
    const url=URL.createObjectURL(file);
    const btn=document.createElement('button');
    btn.type='button'; btn.className='frame'; btn.setAttribute('aria-pressed','true'); btn.title=file.name;
    const isVideo=file.type.startsWith('video/');
    const media=document.createElement(isVideo?'video':'img');
    media.src=url; if(isVideo){ media.muted=true; media.preload='metadata'; } else { media.alt=file.name; media.loading='lazy'; media.decoding='async'; }
    btn.appendChild(media);
    btn.insertAdjacentHTML('beforeend','<span class="tick"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></span>');
    if(isVideo) btn.insertAdjacentHTML('beforeend','<span class="badge">VÍDEO</span>');
    const cell=document.createElement('div'); cell.className='cell';
    const star=document.createElement('button');
    star.type='button'; star.className='star'; star.setAttribute('aria-label',`Fer primera (rètol): ${file.name}`); star.textContent='★';
    btn.insertAdjacentHTML('beforeend','<span class="first-badge">1 · RÈTOL</span>');
    cell.append(btn,star);
    const item={file,url,selected:true,el:btn,cell};
    btn.addEventListener('click',()=>{ item.selected=!item.selected; btn.setAttribute('aria-pressed',String(item.selected)); clearParts(); refresh(); });
    star.addEventListener('click',()=>setFirst(item));
    items.push(item); grid.appendChild(cell);
  }
  setStatus(''); clearParts(); refresh();
}
function isMedia(x){ return /^(image|video)\//.test(x.type)||/\.(jpe?g|png|heic|heif|webp|gif|mp4|mov)$/i.test(x.name); }
function onPick(e){
  const all=[...(e.target.files||[])], f=all.filter(isMedia);
  if(f.length) addFiles(f); else if(all.length) setStatus('Els arxius triats no són fotos ni vídeos.',true);
  e.target.value='';
}
$('pickPhotos').addEventListener('change',onPick);
$('pickFiles').addEventListener('change',onPick);
$('selAll').onclick=()=>{ items.forEach(i=>{ i.selected=true; i.el.setAttribute('aria-pressed','true'); }); clearParts(); refresh(); };
$('selNone').onclick=()=>{ items.forEach(i=>{ i.selected=false; i.el.setAttribute('aria-pressed','false'); }); clearParts(); refresh(); };
$('clearAll').onclick=()=>{ items.forEach(i=>URL.revokeObjectURL(i.url)); items.length=0; firstItem=null; grid.textContent=''; clearParts(); refresh(); };
$('zipName').addEventListener('input',()=>{ nameTouched=$('zipName').value.trim()!==''; clearParts(); });
document.querySelectorAll('input[name=q]').forEach(r=>r.addEventListener('change',clearParts));
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>{ e.preventDefault(); const f=[...(e.dataTransfer?.files||[])].filter(isMedia); if(f.length) addFiles(f); });

/* ---------- Pas 1: reduir · Pas 2: repartir en ZIP de com a màxim 18 MB ---------- */
// Mida màxima de cada ZIP: amb l'enviament del club (Vercel) com a màxim ~4,3 MB per petició;
// amb l'script de Google, 15 MB (el correu admet 25 MB i l'adjunt creix un 33 % en enviar-se)
const SERVER='https://cartell-cbm.vercel.app/api/fotos';
let server=null; // {ok, from, to, maxBytes} quan l'enviament del club està disponible
function partLimit(){ return server&&server.ok ? Math.min(server.maxBytes, 4.4*1024*1024)-150*1024 : 15*1024*1024; }
function baseName(){
  let b=cleanName(($('zipName').value||'fotos').replace(/\.zip$/i,''))||'fotos';
  if(!b.includes(todayStr())) b+=`_${todayStr()}`;
  return b;
}
function setBusy(b){ busy=b; const none=items.every(i=>!i.selected); $('makeZip').disabled=b||none; $('sendMail').disabled=b||none; $('prog').hidden=!b; }

async function buildParts(){
  const sel=orderedSelection(), first=sel[0], prog=$('prog'); prog.value=0;
  const preset=PRESETS[document.querySelector('input[name=q]:checked').value];
  const ready=[]; let before=0, after=0, n=0;
  for(const i of sel){
    n++; before+=i.file.size;
    let data=i.file, fname=i.file.name;
    if(preset){
      setStatus(`Pas 1 de 2 · Reduint fotos… ${n} de ${sel.length}`); prog.value=Math.round(n/sel.length*70);
      const small=await shrink(i.file,preset);
      if(small){ data=small; fname=jpgName(fname); }
    }
    if(i===first) fname='00_RETOL_'+fname; // surt la primera en qualsevol visor de ZIP
    after+=data.size; ready.push({data,fname,date:new Date(i.file.lastModified||Date.now())});
  }
  const groups=[[]]; let acc=0;
  for(const r of ready){
    const sz=r.data.size+120;
    if(acc+sz>partLimit() && groups[groups.length-1].length){ groups.push([]); acc=0; }
    groups[groups.length-1].push(r); acc+=sz;
  }
  const base=baseName(), parts=[];
  for(let g=0;g<groups.length;g++){
    setStatus(`Pas 2 de 2 · Creant ZIP ${g+1} de ${groups.length}…`);
    const used=new Set();
    const blob=await makeZip(groups[g].map(r=>({name:uniqueName(r.fname,used),data:r.data,date:r.date})), f=>{ prog.value=70+((g+f)/groups.length)*30; });
    const name=groups.length===1?`${base}.zip`:`${base}_${g+1}.zip`;
    parts.push({blob,name,count:groups[g].length,index:g+1,file:new File([blob],name,{type:'application/zip'}),saved:false,mailed:false});
  }
  if(parts[0]&&ready[0]) parts[0].retol=ready[0].fname;
  return {parts,before,after,reduced:!!preset&&before>after,firstName:ready[0]?ready[0].fname:''};
}
function summary(r){ return (r.reduced?`Fotos reduïdes de ${fmtSize(r.before)} a ${fmtSize(r.after)}. `:'')+r.parts.map(p=>`${p.name} (${p.count} fotos, ${fmtSize(p.blob.size)})`).join(' · '); }

function saveFile(p){
  const a=document.createElement('a'); a.href=URL.createObjectURL(p.blob); a.download=p.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  p.saved=true;
}

/* ---------- Descarregar ---------- */
$('makeZip').addEventListener('click', async ()=>{
  if(busy||!items.some(i=>i.selected)) return;
  setBusy(true);
  try{
    const r=await buildParts();
    for(const p of r.parts){ saveFile(p); await sleep(700); }
    setStatus(`Desat a Descàrregues. ${summary(r)}`);
  }catch(e){ setStatus('Error en crear el ZIP. Si són moltes fotos, prova-ho en tandes més petites.',true); }
  finally{ setBusy(false); }
});

/* ---------- Enviar per correu ---------- */
function mailInfo(p,N){
  // Assumpte = nom del local (el mateix nom que el ZIP); si hi ha més d'un correu: «part 1/2»
  const to=$('mailTo').value.trim(), subj0=$('mailSubject').value.trim()||baseName();
  const subject=N>1?`${subj0} - part ${p.index}/${N}`:subj0;
  const body=N>1
    ? `Hola,\n\nT'envio les fotos en ${N} correus perquè no cabien en un de sol. Aquesta és la part ${p.index}/${N}: ${p.name}, amb ${p.count} fotos (${fmtSize(p.blob.size)}).\n`
    : `Hola,\n\nT'envio ${p.count} ${p.count===1?'foto':'fotos'} en un arxiu ZIP: ${p.name} (${fmtSize(p.blob.size)}).\n`;
  const retol=p.retol?`\nLa primera foto (${p.retol}) és la del rètol del local.\n`:'';
  return {to,subject,body:body+retol};
}
function canShareZip(p){ try{ return !!(navigator.canShare && navigator.canShare({files:[p.file]})); }catch(e){ return false; } }

function clearParts(){ lastParts=null; $('parts').hidden=true; $('partsList').textContent=''; }
function renderParts(r){
  $('partsHelp').textContent="Per a cada ZIP: desa'l i obre el correu. L'adreça i l'assumpte ja hi seran; només cal adjuntar el ZIP de Descàrregues i prémer Enviar."+(autoOn()?'':' Per enviar-los sols, configura «Enviament automàtic» a dalt.');
  lastParts=r; const N=r.parts.length, list=$('partsList'); list.textContent='';
  $('partsTitle').textContent = N>1 ? `${N} correus per enviar` : '1 correu per enviar';
  for(const p of r.parts){
    const li=document.createElement('li'); li.className='part';
    const share=canShareZip(p);
    li.innerHTML=`<div class="part-head"><span class="part-n">${N>1?`${p.index}/${N}`:'ZIP'}</span><span class="part-name"></span><span class="part-size">${p.count} fotos · ${fmtSize(p.blob.size)}</span></div><div class="part-actions"></div>`;
    li.querySelector('.part-name').textContent=p.name;
    const act=li.querySelector('.part-actions');
    if(share){
      const b=document.createElement('button'); b.type='button'; b.className='btn primary'; b.textContent='Enviar amb el correu';
      b.onclick=async()=>{
        const m=mailInfo(p,N);
        try{ await navigator.share({files:[p.file],title:m.subject,text:`Per a: ${m.to}\n\n${m.body}`}); p.mailed=true; li.classList.add('done'); setStatus(`Correu ${p.index} de ${N} preparat. Recorda posar ${m.to} com a destinatari.`); }
        catch(e){ if(e.name!=='AbortError') setStatus("No s'ha pogut obrir el correu. Prova amb «Desar» i «Obrir correu».",true); }
      };
      act.appendChild(b);
    }
    const s=document.createElement('button'); s.type='button'; s.className='btn'+(share?' small':''); s.textContent=share?'Desar':'1. Desar el ZIP';
    s.onclick=()=>{ saveFile(p); li.classList.add('saved'); setStatus(`${p.name} desat a Descàrregues. Ara toca «Obrir correu».`); };
    const m=document.createElement('a'); m.className='btn'+(share?' small':' primary'); m.textContent=share?'Obrir correu':'2. Obrir correu';
    const info=mailInfo(p,N);
    m.href=`mailto:${encodeURIComponent(info.to)}?subject=${encodeURIComponent(info.subject)}&body=${encodeURIComponent(info.body+`\n(Adjunta l'arxiu ${p.name} de la carpeta Descàrregues.)\n`)}`;
    m.addEventListener('click',()=>{ p.mailed=true; li.classList.add('done'); setStatus(`Al correu, toca el clip 📎 i adjunta ${p.name} de Descàrregues.`); });
    act.appendChild(s); act.appendChild(m);
    list.appendChild(li);
  }
  $('parts').hidden=false;
  $('parts').scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------- enviament automàtic amb Google Apps Script ---------- */
const store={ get(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }, set(k,v){ try{ v?localStorage.setItem(k,v):localStorage.removeItem(k); }catch(e){} } };
function secretKey(){
  let k=store.get('fz_key');
  if(!k){ const a=new Uint8Array(18); crypto.getRandomValues(a); k=[...a].map(b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join(''); store.set('fz_key',k); }
  return k;
}
function scriptCode(){
  return `// Fotos a ZIP — enviador de correus. Enganxa tot aquest codi a script.google.com
// i implementa'l com a Aplicació web (Executa com a: Jo · Qui hi té accés: Qualsevol usuari).
const CLAU = '${secretKey()}';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.clau !== CLAU) return resposta({ ok: false, error: 'clau' });
    const zip = Utilities.newBlob(Utilities.base64Decode(d.zip), 'application/zip', d.nom);
    MailApp.sendEmail({ to: d.per, subject: d.assumpte, body: d.text, attachments: [zip], name: 'Fotos a ZIP' });
    return resposta({ ok: true, queden: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return resposta({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.clau !== CLAU) return resposta({ ok: false, error: 'clau' });
  return resposta({ ok: true, queden: MailApp.getRemainingDailyQuota(), compte: Session.getEffectiveUser().getEmail() });
}

function resposta(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
const autoOn=()=>!!(server&&server.ok)||!!store.get('fz_url');
function renderSetup(){
  const on=autoOn();
  const club=!!(server&&server.ok);
  $('clubInfo').hidden=!club; $('scriptSetup').hidden=club;
  if(club){ $('clubFrom').textContent=server.from; $('clubTo').textContent=server.to; $('mailTo').value=server.to; $('mailTo').readOnly=true; }
  $('autoChip').textContent=on?'Activat':'No configurat'; $('autoChip').title=on&&store.get('fz_from')?`Envia des de ${store.get('fz_from')}`:''; $('autoChip').classList.toggle('on',on);
  $('scriptUrl').value=store.get('fz_url');
  $('resetScript').hidden=!on;
  $('scriptCode').value=scriptCode();
}
function setupMsg(t,err){ $('setupMsg').textContent=t; $('setupMsg').style.color=err?'var(--warn)':''; }

$('copyScript').addEventListener('click', async ()=>{
  const code=scriptCode();
  try{ await navigator.clipboard.writeText(code); setupMsg('Codi copiat. Ara obre script.google.com i enganxa\'l.'); }
  catch(e){ const t=$('scriptCode'); t.hidden=false; t.focus(); t.select(); setupMsg('Mantén premut el text i tria «Copia».'); }
});

async function testScript(url){
  const res=await fetch(`${url}?clau=${encodeURIComponent(secretKey())}`,{redirect:'follow'});
  return res.json();
}
$('saveScript').addEventListener('click', async ()=>{
  const url=$('scriptUrl').value.trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)){ setupMsg("L'URL no és correcta. Ha de començar per https://script.google.com/macros/s/ i acabar en /exec.",true); return; }
  setupMsg('Provant…');
  try{
    const j=await testScript(url);
    if(j.ok){ store.set('fz_url',url); renderSetup(); setupMsg(`Funciona. Els correus sortiran de ${j.compte||'el teu compte de Google'}. Avui encara se'n poden enviar ${j.queden}.`); store.set('fz_from',j.compte||''); $('setup').open=false; setStatus('Enviament automàtic activat.'); }
    else if(j.error==='clau') setupMsg("L'script respon però la clau no coincideix. Torna a copiar el codi, enganxa'l a l'script i fes Implementa → Gestiona les implementacions → editar → Versió nova.",true);
    else setupMsg('Error de l\'script: '+j.error,true);
  }catch(e){ setupMsg("No s'ha pogut connectar amb l'script. Revisa l'URL i que a «Qui hi té accés» hi posi «Qualsevol usuari».",true); }
});
$('resetScript').addEventListener('click',()=>{ store.set('fz_url',''); renderSetup(); setupMsg('Enviament automàtic desactivat.'); });

async function sendViaServer(p,N){
  const m=mailInfo(p,N);
  const qs=new URLSearchParams({nom:p.name,assumpte:m.subject,text:m.body});
  const res=await fetch(`${SERVER}?${qs}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:p.blob});
  let j={}; try{ j=await res.json(); }catch(e){}
  if(!res.ok||!j.ok){ const err=new Error(j.error||`http_${res.status}`); throw err; }
  return j;
}
let wakeLock=null;
async function keepAwake(on){
  try{
    if(on&&'wakeLock' in navigator){ wakeLock=await navigator.wakeLock.request('screen'); }
    else if(!on&&wakeLock){ await wakeLock.release(); wakeLock=null; }
  }catch(e){}
}
async function sendViaScript(p,N){
  const m=mailInfo(p,N);
  const zip=await toBase64(p.blob);
  const res=await fetch(store.get('fz_url'),{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({clau:secretKey(),per:m.to,assumpte:m.subject,text:m.body,nom:p.name,zip})});
  const j=await res.json();
  if(!j.ok) throw new Error(j.error==='clau'?'clau':j.error||'error');
  return j;
}
function toBase64(blob){
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.onerror=()=>rej(r.error); r.readAsDataURL(blob); });
}

$('sendMail').addEventListener('click', async ()=>{
  if(busy||!items.some(i=>i.selected)) return;
  const to=$('mailTo').value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){ setStatus("L'adreça de correu no és vàlida. Revisa-la.",true); $('mailTo').focus(); return; }
  store.set('fz_to',to);
  setBusy(true); keepAwake(true);
  let r;
  try{ r=await buildParts(); }
  catch(e){ setStatus('Error en crear el ZIP. Si són moltes fotos, prova-ho en tandes més petites.',true); setBusy(false); keepAwake(false); return; }

  if(!autoOn()){
    renderParts(r); setStatus(summary(r)); setBusy(false); keepAwake(false); return;
  }
  const N=r.parts.length; let sent=0, last=null;
  for(const p of r.parts){
    setStatus(`Enviant correu ${p.index} de ${N}: ${p.name} (${fmtSize(p.blob.size)})…`);
    $('prog').value=(p.index-1)/N*100;
    try{ last=await (server&&server.ok ? sendViaServer(p,N) : sendViaScript(p,N)); p.mailed=true; sent++; }
    catch(e){
      const why = ({
        clau:"la clau de l'script no coincideix (torna a copiar el codi a l'script)",
        auth:"el Gmail del club no accepta la contrasenya d'aplicació (cal revisar-la a Vercel)",
        not_configured:"l'enviament del club no està configurat a Vercel",
        too_large:"el ZIP és massa gran", bad_zip:"el ZIP no és vàlid", send_failed:"Gmail no ha pogut enviar el correu"
      })[e.message] || (e instanceof TypeError ? 'no hi ha connexió a internet' : e.message);
      const pending={...r,parts:r.parts.filter(x=>!x.mailed)};
      renderParts(pending);
      $('partsHelp').textContent="Aquests no s'han pogut enviar sols. Pots tornar-ho a provar amb «Enviar per correu» o enviar-los a mà: desa'l i obre el correu.";
      setStatus(`S'han enviat ${sent} de ${N} correus. Error: ${why}.`,true);
      setBusy(false); keepAwake(false); return;
    }
  }
  setStatus(`Fet! ${N>1?`${N} correus enviats`:'Correu enviat'} a ${to}. ${summary(r)}`+(last&&typeof last.queden==='number'?` · Avui en queden ${last.queden}.`:''));
  setBusy(false); keepAwake(false);
});

/* ---------- fotos compartides des de la Galeria (Compartir → Fotos a ZIP) ---------- */
async function loadShared(){
  if(!location.search.includes('shared=1') || !('caches' in window)) return;
  try{
    const cache=await caches.open('fz-shared'); const keys=await cache.keys(); const files=[];
    for(const k of keys){
      const res=await cache.match(k); const blob=await res.blob();
      files.push(new File([blob],decodeURIComponent(res.headers.get('x-name')||'foto.jpg'),{type:blob.type,lastModified:+res.headers.get('x-modified')||Date.now()}));
      await cache.delete(k);
    }
    history.replaceState(null,'',location.pathname);
    if(files.length){ addFiles(files.filter(isMedia)); setStatus(`${files.length} fotos rebudes de la Galeria.`); }
  }catch(e){}
}

/* ---------- inici ---------- */
try{ const t=localStorage.getItem('fz_to'); if(t) $('mailTo').value=t; }catch(e){}
renderSetup();
if(!autoOn()) $('setup').open=true;
async function checkServer(){
  try{
    const j=await (await fetch(SERVER,{cache:'no-store'})).json();
    server=j; renderSetup(); if(j.ok) $('setup').open=false; else if(!autoOn()) $('setup').open=true;
  }catch(e){ /* sense connexió: es mantindrà l'script si n'hi ha */ }
}
checkServer();
$('zipName').value='';
refresh();
loadShared();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
