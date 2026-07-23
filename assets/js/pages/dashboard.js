import {
  bootstrapPage,
  db,
  $,
  initializeFirebaseProject,
  toast,
  hasPermission
} from "../admin-core.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

function setCardVisible(valueId, visible) {
  const value = $(valueId);
  const card = value?.closest(".dashboard-card");

  if (card) {
    card.hidden = !visible;
  }
}

function filterQuickLinks() {
  const permissionsByPage = {
    "confirmacoes.html": "confirmacoes",
    "presentes.html": "presentes",
    "pix.html": "pix"
  };

  document.querySelectorAll(".quick-card").forEach(link => {
    const file = new URL(link.href, location.href)
      .pathname
      .split("/")
      .pop();

    const permission = permissionsByPage[file];

    if (permission && !hasPermission(permission)) {
      link.remove();
    }
  });
}

function showEmptyDashboardIfNeeded() {
  const dashboard = document.querySelector(".dashboard-grid");
  const quickGrid = document.querySelector(".quick-grid");

  const visibleCards = dashboard
    ? [...dashboard.children].filter(item => !item.hidden)
    : [];

  if (!visibleCards.length && dashboard) {
    dashboard.innerHTML = `
      <article class="page-card" style="grid-column:1/-1">
        <p class="eyebrow">Acesso limitado</p>
        <h2 style="font-family:var(--title-font);font-weight:400;margin:0 0 8px">
          Nenhum módulo liberado
        </h2>
        <p style="margin:0">
          Solicite ao administrador Master a liberação das permissões necessárias.
        </p>
      </article>
    `;
  }

  if (quickGrid && !quickGrid.children.length) {
    quickGrid.remove();
  }
}

async function loadConfirmations() {
  const snapshot = await getDocs(
    query(
      collection(db, "confirmacoes"),
      where("status", "==", "confirmada")
    )
  );

  $("statFamilies").textContent = snapshot.size;
  $("statAdults").textContent = snapshot.docs.reduce(
    (sum, item) => sum + (item.data().counts?.adults || 0),
    0
  );
  $("statChildren").textContent = snapshot.docs.reduce(
    (sum, item) => sum + (item.data().counts?.children || 0),
    0
  );
}

async function loadGifts() {
  const snapshot = await getDocs(
    query(
      collection(db, "presentes"),
      where("ativo", "==", true),
      where("visivelPublico", "==", true)
    )
  );

  $("statGifts").textContent = snapshot.size;
}

async function loadReservations() {
  const snapshot = await getDocs(
    query(
      collection(db, "reservas"),
      where("status", "==", "reservado")
    )
  );

  $("statReservations").textContent = snapshot.docs.filter(
    item => item.data().expiresAt?.toMillis?.() > Date.now()
  ).length;
}

async function loadPix() {
  const snapshot = await getDocs(
    query(
      collection(db, "pixInformados"),
      where("status", "==", "aguardando_confirmacao")
    )
  );

  $("statPixPending").textContent = snapshot.size;
}

async function loadDashboard() {
  const tasks = [];

  const confirmationAccess = hasPermission("confirmacoes");
  setCardVisible("statFamilies", confirmationAccess);
  setCardVisible("statAdults", confirmationAccess);
  setCardVisible("statChildren", confirmationAccess);

  if (confirmationAccess) {
    tasks.push(loadConfirmations());
  }

  const giftAccess = hasPermission("presentes");
  setCardVisible("statGifts", giftAccess);

  if (giftAccess) {
    tasks.push(loadGifts());
  }

  const reservationAccess = hasPermission("reservas");
  setCardVisible("statReservations", reservationAccess);

  if (reservationAccess) {
    tasks.push(loadReservations());
  }

  const pixAccess = hasPermission("pix");
  setCardVisible("statPixPending", pixAccess);

  if (pixAccess) {
    tasks.push(loadPix());
  }

  filterQuickLinks();
  showEmptyDashboardIfNeeded();

  await Promise.all(tasks);
}

bootstrapPage({
  onReady: async ({ admin }) => {
    const setupArea = $("setupArea");
    const initializeButton = $("initializeButton");

    /*
     * Inicialização completa do Firebase fica disponível somente ao Master.
     */
    if (admin.role !== "master") {
      setupArea?.remove();
    } else {
      const snapshot = await getDoc(
        doc(db, "configuracoes", "publico")
      );

      setupArea?.classList.toggle("hidden", snapshot.exists());

      initializeButton?.addEventListener("click", async () => {
        const message = $("setupMessage");
        initializeButton.disabled = true;

        try {
          const total = await initializeFirebaseProject();

          message.className = "notice success";
          message.textContent =
            `Projeto inicializado com ${total} presentes.`;

          setupArea.classList.add("hidden");
          toast("Firebase inicializado");
          await loadDashboard();
        } catch (error) {
          message.className = "notice danger";
          message.textContent = error.message;
        } finally {
          initializeButton.disabled = false;
        }
      });
    }

    await loadDashboard();
  }
});
