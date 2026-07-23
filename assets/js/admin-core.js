import { db, loginWithGoogle, completeRedirectLogin, observeAuth, logout } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export { db };
export const MASTER_EMAIL = "lindolfoandrew0@gmail.com";
export const PERMISSIONS = ["confirmacoes","presentes","reservas","pix","configuracoes","administradores","exportacoes","logs"];

export const NAV_PERMISSION_MAP = Object.freeze({
  dashboard: null,
  confirmacoes: "confirmacoes",
  presentes: "presentes",
  reservas: "reservas",
  pix: "pix",
  "pagina-inicial": "configuracoes",
  entrega: "configuracoes",
  dominio: "configuracoes",
  administradores: "administradores",
  exportacoes: "exportacoes",
  logs: "logs"
});
export let currentUser = null;
export let currentAdmin = null;

export const $ = id => document.getElementById(id);
export const esc = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
export const money = value => new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(Number(value || 0));
export const emailId = email => String(email || "").trim().toLowerCase();

export function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  window.setTimeout(() => el.classList.add("hidden"), 3200);
}

export function hasPermission(permission) {
  return currentAdmin?.role === "master" || currentAdmin?.permissions?.[permission] === true;
}

export function canAccessAdminPage(page, admin = currentAdmin) {
  if (!page || page === "dashboard") return true;
  if (!admin || admin.active !== true) return false;
  if (admin.role === "master") return true;

  /*
   * O gerenciamento de administradores permanece exclusivo de Master,
   * mesmo que um cadastro antigo tenha essa permissão marcada.
   */
  if (page === "administradores") return false;

  const permission = NAV_PERMISSION_MAP[page];
  return Boolean(permission && admin.permissions?.[permission] === true);
}

function applyMenuAccessClasses(admin) {
  const root = document.documentElement;

  root.classList.remove(
    "admin-menu-session-ready",
    "admin-menu-master",
    ...PERMISSIONS.map(permission => `admin-perm-${permission}`)
  );

  if (!admin || admin.active !== true) {
    return;
  }

  root.classList.add("admin-menu-session-ready");

  if (admin.role === "master") {
    root.classList.add("admin-menu-master");
    return;
  }

  PERMISSIONS.forEach(permission => {
    if (admin.permissions?.[permission] === true) {
      root.classList.add(`admin-perm-${permission}`);
    }
  });
}

export function applyAdminMenuPermissions(admin = currentAdmin) {
  /*
   * Primeiro atualiza as classes do menu. Os links permitidos que já
   * estavam visíveis pela sessão permanecem no mesmo lugar, sem piscar.
   */
  applyMenuAccessClasses(admin);

  document.querySelectorAll("[data-nav-page]").forEach(link => {
    const allowed = canAccessAdminPage(
      link.dataset.navPage,
      admin
    );

    if (!allowed) {
      link.remove();
      return;
    }

    link.hidden = false;
    link.removeAttribute("aria-hidden");
  });
}

export async function ensureAdmin(user) {
  const email = emailId(user.email);
  const ref = doc(db, "administradores", email);
  let snap = await getDoc(ref);

  if (email === MASTER_EMAIL && !snap.exists()) {
    await setDoc(ref, {
      email,
      name: user.displayName || "Andrew",
      role: "master",
      permissions: Object.fromEntries(PERMISSIONS.map(item => [item, true])),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    snap = await getDoc(ref);
  }

  if (!snap.exists() || snap.data().active !== true) {
    throw new Error("Esta conta Google não está cadastrada como administradora.");
  }
  return snap.data();
}

function restoreCachedUser() {
  try {
    const cached = JSON.parse(sessionStorage.getItem("adminShellUser") || "null");
    if (!cached) return;
    if ($("userName")) $("userName").textContent = cached.name || "Administrador";
    if ($("userEmail")) $("userEmail").textContent = cached.email || "";
    if ($("userPhoto")) $("userPhoto").src = cached.photo || "assets/img/monograma.png";

    /*
     * Nome, e-mail e foto podem vir do cache para evitar piscada.
     * As permissões nunca vêm do cache: elas são confirmadas novamente
     * no Firestore antes de o menu ser exibido.
     */
  } catch {
    sessionStorage.removeItem("adminShellUser");
    sessionStorage.removeItem("adminShellAccess");
  }
}

function beginPageNavigation(destination) {
  const app = $("adminApp");
  if (!app) {
    location.href = destination;
    return;
  }

  /*
   * As permissões permanecem no elemento <html> durante a navegação.
   * Assim o menu autorizado não desaparece antes da próxima página.
   */
  app.classList.add("admin-page-leaving");
  app.setAttribute("aria-busy", "true");
  if ($("pageLoaderText")) $("pageLoaderText").textContent = "Carregando página...";

  // Dá tempo para o navegador exibir o carregador apenas no conteúdo.
  window.setTimeout(() => {
    location.href = destination;
  }, 70);
}

function setupShell() {
  const page = document.body.dataset.page;
  restoreCachedUser();

  document.querySelectorAll("[data-nav-page]").forEach(link => {
    link.classList.toggle("active", link.dataset.navPage === page);
  });

  const sidebar = $("adminSidebar");
  $("menuToggle")?.addEventListener("click", () => sidebar?.classList.toggle("open"));

  document.querySelectorAll(".admin-nav a, .admin-brand, .quick-card").forEach(link => {
    link.addEventListener("click", event => {
      sidebar?.classList.remove("open");

      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      ) {
        return;
      }

      const target = new URL(link.href, location.href);
      if (target.origin !== location.origin || target.href === location.href) return;

      event.preventDefault();
      beginPageNavigation(target.href);
    });
  });

  $("logoutButton")?.addEventListener("click", async () => {
    sessionStorage.removeItem("adminShellUser");
    sessionStorage.removeItem("adminShellAccess");
    await logout();
    location.href = "login.html";
  });
}

function fillUser(user, admin) {
  const shellUser = {
    name: user.displayName || admin.name || "Administrador",
    email: user.email || "",
    photo: user.photoURL || "assets/img/monograma.png"
  };

  if ($("userName")) $("userName").textContent = shellUser.name;
  if ($("userEmail")) $("userEmail").textContent = shellUser.email;
  if ($("userPhoto")) $("userPhoto").src = shellUser.photo;

  sessionStorage.setItem("adminShellUser", JSON.stringify(shellUser));
  sessionStorage.setItem(
    "adminShellAccess",
    JSON.stringify({
      email: emailId(user.email),
      role: admin.role || "admin",
      active: admin.active === true,
      permissions: admin.permissions || {}
    })
  );
}

function revealPage() {
  const app = $("adminApp");
  if (!app) return;
  app.classList.remove("hidden", "admin-auth-pending", "admin-page-leaving");
  app.setAttribute("aria-busy", "false");
}

function showAccessDenied() {
  const main = document.querySelector(".admin-main");
  if (!main) return;
  main.innerHTML = `<div class="page-card access-denied"><p class="eyebrow">Acesso negado</p><h1 style="font-family:var(--title-font);font-weight:400">Sem permissão</h1><p>Esta conta não possui acesso a este módulo.</p><a class="btn btn-primary" href="index.html">Voltar à visão geral</a></div>`;
}

export async function bootstrapPage({ permission = null, onReady = async () => {} } = {}) {
  setupShell();
  await completeRedirectLogin().catch(console.error);

  observeAuth(async user => {
    if (!user) {
      sessionStorage.removeItem("adminShellUser");
      sessionStorage.removeItem("adminShellAccess");
      location.href = "login.html";
      return;
    }

    try {
      currentUser = user;
      currentAdmin = await ensureAdmin(user);
      fillUser(user, currentAdmin);
      applyAdminMenuPermissions(currentAdmin);

      if (permission && !hasPermission(permission)) {
        showAccessDenied();
        revealPage();
        return;
      }

      // Mantém somente a área de conteúdo carregando até o módulo terminar.
      await onReady({ user, admin: currentAdmin });
      revealPage();
    } catch (error) {
      console.error(error);
      sessionStorage.setItem("adminLoginError", error.message);
      sessionStorage.removeItem("adminShellUser");
      sessionStorage.removeItem("adminShellAccess");
      await logout();
      location.href = "login.html";
    }
  });
}

export async function initializeFirebaseProject() {
  const response = await fetch("assets/data/presentes.json");
  if (!response.ok) throw new Error("Não foi possível carregar a lista de presentes.");
  const items = await response.json();
  const batch = writeBatch(db);

  batch.set(doc(db, "configuracoes", "publico"), {
    siteName: "Mislaine & Emerson",
    pageTitle: "Casamento de Mislaine & Emerson",
    introText: "Estamos preparando este momento com muito carinho. Neste espaço você poderá confirmar sua presença e escolher uma forma especial de nos presentear.",
    weddingDate: Timestamp.fromDate(new Date("2026-09-06T17:00:00-04:00")),
    confirmationDeadline: Timestamp.fromDate(new Date("2026-09-01T17:00:00-04:00")),
    venueName: "CATRE",
    venueAddress: "Av. Brasília, 5373 - Boa Esperança, Rolim de Moura - RO",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=CATRE%20Av.%20Bras%C3%ADlia%205373%20Boa%20Esperan%C3%A7a%20Rolim%20de%20Moura%20RO",
    childMaxAge: 12,
    reservationHours: 24,
    domain: "",
    updatedAt: serverTimestamp()
  }, { merge:true });

  batch.set(doc(db, "configuracoes", "entregaPublica"), {
    recipient: "", phone: "", zipCode: "76954-000", street: "Rua Santa Catarina", number: "3832",
    complement: "", neighborhood: "Centro", city: "Alta Floresta D'Oeste", state: "RO",
    reference: "", active: true, updatedAt: serverTimestamp()
  }, { merge:true });

  batch.set(doc(db, "configuracoes", "dominio"), {
    publicDomain: "", adminDomain: "", updatedAt: serverTimestamp()
  }, { merge:true });

  for (const item of items) {
    batch.set(doc(db, "presentes", item.id), {
      ...item,
      purchaseStatus: "disponivel",
      pixStatus: "sem_contribuicao",
      pixConfirmedTotal: 0,
      pixOverflowTotal: 0,
      visivelPublico: true,
      reservationId: null,
      reservedByUid: null,
      reservationExpiresAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge:true });
  }
  await batch.commit();
  return items.length;
}

export async function startLoginPage() {
  const message = $("loginMessage");
  const storedError = sessionStorage.getItem("adminLoginError");
  if (storedError) {
    message.textContent = storedError;
    message.className = "notice danger";
    sessionStorage.removeItem("adminLoginError");
  }

  await completeRedirectLogin().catch(error => {
    message.textContent = error.message;
    message.className = "notice danger";
  });

  observeAuth(async user => {
    if (!user) return;
    try {
      const admin = await ensureAdmin(user);
      fillUser(user, admin);
      location.href = "index.html";
    } catch (error) {
      message.textContent = error.message;
      message.className = "notice danger";
      await logout();
    }
  });

  $("loginButton").addEventListener("click", async () => {
    const button = $("loginButton");
    button.disabled = true;
    try {
      await loginWithGoogle();
    } catch (error) {
      message.textContent = error.message;
      message.className = "notice danger";
    } finally {
      button.disabled = false;
    }
  });
}
