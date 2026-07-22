import { bootstrapPage, db, $, esc, toast } from "../admin-core.js";
import { collection, getDocs, query, orderBy, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

async function load(){
 const area=$("tableArea"); area.innerHTML='<div class="loading">Carregando...</div>';
 try{const snap=await getDocs(query(collection(db,"confirmacoes"),orderBy("updatedAt","desc")));
 area.innerHTML=`<table><thead><tr><th>Responsável</th><th>WhatsApp</th><th>Cônjuge</th><th>Filhos</th><th>Adultos</th><th>Crianças</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead><tbody>${snap.docs.map(d=>{const x=d.data(), children=(x.children||[]).map(c=>`${esc(c.name)} (${c.age})`).join(', ')||'—';return `<tr><td><strong>${esc(x.responsibleName)}</strong></td><td>${esc(x.whatsapp)}</td><td>${esc(x.spouseName||'—')}</td><td>${children}</td><td>${x.counts?.adults||0}</td><td>${x.counts?.children||0}</td><td>${x.counts?.total||0}</td><td><span class="status ${x.status==='confirmada'?'ok':'bad'}">${esc(x.status)}</span></td><td><button class="btn btn-small ${x.status==='confirmada'?'btn-danger':'btn-primary'}" data-toggle="${d.id}" data-status="${x.status}">${x.status==='confirmada'?'Cancelar':'Restaurar'}</button></td></tr>`}).join('')||'<tr><td colspan="9">Nenhuma confirmação.</td></tr>'}</tbody></table>`;
 area.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{await updateDoc(doc(db,'confirmacoes',b.dataset.toggle),{status:b.dataset.status==='confirmada'?'cancelada':'confirmada',updatedAt:serverTimestamp()});toast('Confirmação atualizada');load();});
 }catch(error){area.innerHTML=`<div class="notice danger">${esc(error.message)}</div>`;}}
bootstrapPage({permission:'confirmacoes',onReady:async()=>{await load();$("reloadButton").onclick=load;}});
