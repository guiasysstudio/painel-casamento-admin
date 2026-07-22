import { bootstrapPage, db, $, initializeFirebaseProject, toast } from "../admin-core.js";
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

async function loadDashboard() {
  const [c,g,r,p] = await Promise.all([
    getDocs(query(collection(db,"confirmacoes"),where("status","==","confirmada"))),
    getDocs(query(collection(db,"presentes"),where("ativo","==",true),where("visivelPublico","==",true))),
    getDocs(query(collection(db,"reservas"),where("status","==","reservado"))),
    getDocs(query(collection(db,"pixInformados"),where("status","==","aguardando_confirmacao")))
  ]);
  $("statFamilies").textContent=c.size;
  $("statAdults").textContent=c.docs.reduce((s,d)=>s+(d.data().counts?.adults||0),0);
  $("statChildren").textContent=c.docs.reduce((s,d)=>s+(d.data().counts?.children||0),0);
  $("statGifts").textContent=g.size;
  $("statReservations").textContent=r.docs.filter(d=>d.data().expiresAt?.toMillis?.()>Date.now()).length;
  $("statPixPending").textContent=p.size;
}

bootstrapPage({ onReady: async () => {
  const snap=await getDoc(doc(db,"configuracoes","publico"));
  $("setupArea").classList.toggle("hidden",snap.exists());
  $("initializeButton").addEventListener("click",async()=>{
    const btn=$("initializeButton"), msg=$("setupMessage"); btn.disabled=true;
    try { const total=await initializeFirebaseProject(); msg.className="notice success"; msg.textContent=`Projeto inicializado com ${total} presentes.`; $("setupArea").classList.add("hidden"); toast("Firebase inicializado"); await loadDashboard(); }
    catch(error){ msg.className="notice danger"; msg.textContent=error.message; }
    finally { btn.disabled=false; }
  });
  if(snap.exists()) await loadDashboard();
}});
