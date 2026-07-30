import {
  db,
  loginWithGoogle,
  completeRedirectLogin,
  observeAuth,
  logout
} from "./firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  PERMISSION_SCHEMA,
  PERMISSION_KEYS,
  NAV_PERMISSION_MAP,
  normalizePermissionState,
  permissionEnabled,
  subpermissionEnabled,
  fullPermissionState
} from "./permission-schema.js?v=3.2.0";

export {
  db,
  PERMISSION_SCHEMA,
  NAV_PERMISSION_MAP,
  normalizePermissionState,
  fullPermissionState
};

export const MASTER_EMAIL =
  "lindolfoandrew0@gmail.com";

export const PERMISSIONS =
  PERMISSION_KEYS;

export let currentUser = null;
export let currentAdmin = null;

export const $ = id =>
  document.getElementById(id);

export const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const money = value =>
  new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL"
    }
  ).format(Number(value || 0));

export const emailId = email =>
  String(email || "")
    .trim()
    .toLowerCase();

export function toast(message) {
  const element = $("toast");

  if (!element) return;

  element.textContent = message;
  element.classList.remove("hidden");

  window.setTimeout(
    () => element.classList.add("hidden"),
    3200
  );
}

export function hasPermission(
  permission
) {
  return permissionEnabled(
    currentAdmin,
    permission
  );
}

export function hasSubPermission(
  permission,
  action
) {
  return subpermissionEnabled(
    currentAdmin,
    permission,
    action
  );
}

export function requireSubPermission(
  permission,
  action,
  message = "Esta conta não possui permissão para realizar esta ação."
) {
  if (
    !hasSubPermission(
      permission,
      action
    )
  ) {
    throw new Error(message);
  }
}

export function canAccessAdminPage(
  page,
  admin = currentAdmin
) {
  const permission =
    NAV_PERMISSION_MAP[page] || page;

  if (!permission) return false;

  return permissionEnabled(
    admin,
    permission
  );
}

export function firstAllowedPage(
  admin = currentAdmin
) {
  for (
    const permission of PERMISSION_KEYS
  ) {
    if (
      permissionEnabled(
        admin,
        permission
      )
    ) {
      return (
        PERMISSION_SCHEMA[
          permission
        ].href
      );
    }
  }

  return "index.html";
}

function applyMenuAccessClasses(admin) {
  const root =
    document.documentElement;

  root.classList.remove(
    "admin-menu-session-ready",
    "admin-menu-master",
    ...Object.values(
      PERMISSION_SCHEMA
    ).map(
      definition =>
        `admin-page-${definition.navPage}`
    )
  );

  if (
    !admin ||
    admin.active !== true
  ) {
    return;
  }

  root.classList.add(
    "admin-menu-session-ready"
  );

  if (admin.role === "master") {
    root.classList.add(
      "admin-menu-master"
    );
  }

  PERMISSION_KEYS.forEach(permission => {
    if (
      permissionEnabled(
        admin,
        permission
      )
    ) {
      root.classList.add(
        `admin-page-${
          PERMISSION_SCHEMA[
            permission
          ].navPage
        }`
      );
    }
  });
}

export function applyAdminMenuPermissions(
  admin = currentAdmin
) {
  applyMenuAccessClasses(admin);

  document
    .querySelectorAll(
      "[data-nav-page]"
    )
    .forEach(link => {
      const allowed =
        canAccessAdminPage(
          link.dataset.navPage,
          admin
        );

      if (!allowed) {
        link.remove();
        return;
      }

      link.hidden = false;
      link.removeAttribute(
        "aria-hidden"
      );
    });
}

export async function ensureAdmin(user) {
  const email =
    emailId(user.email);

  const reference = doc(
    db,
    "administradores",
    email
  );

  let snapshot =
    await getDoc(reference);

  if (
    email === MASTER_EMAIL &&
    !snapshot.exists()
  ) {
    const fullAccess =
      fullPermissionState(
        "master"
      );

    await setDoc(reference, {
      email,
      name:
        user.displayName ||
        "Andrew",
      role: "master",
      ...fullAccess,
      active: true,
      createdAt:
        serverTimestamp(),
      updatedAt:
        serverTimestamp()
    });

    snapshot =
      await getDoc(reference);
  }

  if (
    !snapshot.exists() ||
    snapshot.data().active !== true
  ) {
    throw new Error(
      "Esta conta Google não está cadastrada como administradora."
    );
  }

  const data =
    snapshot.data();

  const normalized =
    normalizePermissionState(data);

  return {
    ...data,
    email:
      data.email || email,
    ...normalized
  };
}

function restoreCachedUser() {
  try {
    const cached = JSON.parse(
      sessionStorage.getItem(
        "adminShellUser"
      ) || "null"
    );

    if (!cached) return;

    if ($("userName")) {
      $("userName").textContent =
        cached.name ||
        "Administrador";
    }

    if ($("userEmail")) {
      $("userEmail").textContent =
        cached.email || "";
    }

    if ($("userPhoto")) {
      $("userPhoto").src =
        cached.photo ||
        "assets/img/monograma.png";
    }
  } catch {
    sessionStorage.removeItem(
      "adminShellUser"
    );

    sessionStorage.removeItem(
      "adminShellAccess"
    );
  }
}

function beginPageNavigation(
  destination
) {
  const app = $("adminApp");

  if (!app) {
    location.href = destination;
    return;
  }

  app.classList.add(
    "admin-page-leaving"
  );

  app.setAttribute(
    "aria-busy",
    "true"
  );

  if ($("pageLoaderText")) {
    $("pageLoaderText").textContent =
      "Carregando página...";
  }

  window.setTimeout(
    () => {
      location.href = destination;
    },
    70
  );
}

function setupShell() {
  const page =
    document.body.dataset.page;

  restoreCachedUser();

  document
    .querySelectorAll(
      "[data-nav-page]"
    )
    .forEach(link => {
      link.classList.toggle(
        "active",
        link.dataset.navPage === page
      );
    });

  const sidebar =
    $("adminSidebar");

  $("menuToggle")
    ?.addEventListener(
      "click",
      () =>
        sidebar?.classList.toggle(
          "open"
        )
    );

  document
    .querySelectorAll(
      ".admin-nav a, .admin-brand, .quick-card"
    )
    .forEach(link => {
      link.addEventListener(
        "click",
        event => {
          sidebar?.classList.remove(
            "open"
          );

          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey ||
            link.target === "_blank" ||
            link.hasAttribute(
              "download"
            )
          ) {
            return;
          }

          const target =
            new URL(
              link.href,
              location.href
            );

          if (
            target.origin !==
              location.origin ||
            target.href ===
              location.href
          ) {
            return;
          }

          event.preventDefault();

          beginPageNavigation(
            target.href
          );
        }
      );
    });

  $("logoutButton")
    ?.addEventListener(
      "click",
      async () => {
        sessionStorage.removeItem(
          "adminShellUser"
        );

        sessionStorage.removeItem(
          "adminShellAccess"
        );

        await logout();
        location.href =
          "login.html";
      }
    );
}

function fillUser(
  user,
  admin
) {
  const shellUser = {
    name:
      user.displayName ||
      admin.name ||
      "Administrador",

    email:
      user.email || "",

    photo:
      user.photoURL ||
      "assets/img/monograma.png"
  };

  if ($("userName")) {
    $("userName").textContent =
      shellUser.name;
  }

  if ($("userEmail")) {
    $("userEmail").textContent =
      shellUser.email;
  }

  if ($("userPhoto")) {
    $("userPhoto").src =
      shellUser.photo;
  }

  sessionStorage.setItem(
    "adminShellUser",
    JSON.stringify(shellUser)
  );

  sessionStorage.setItem(
    "adminShellAccess",
    JSON.stringify({
      email:
        emailId(user.email),

      role:
        admin.role || "admin",

      active:
        admin.active === true,

      permissionVersion:
        admin.permissionVersion || 2,

      permissions:
        admin.permissions || {},

      subpermissions:
        admin.subpermissions || {}
    })
  );
}

function revealPage() {
  const app = $("adminApp");

  if (!app) return;

  app.classList.remove(
    "hidden",
    "admin-auth-pending",
    "admin-page-leaving"
  );

  app.setAttribute(
    "aria-busy",
    "false"
  );
}

function showAccessDenied() {
  const main =
    document.querySelector(
      ".admin-main"
    );

  if (!main) return;

  const destination =
    firstAllowedPage();

  main.innerHTML = `
    <div class="page-card access-denied">
      <p class="eyebrow">
        Acesso negado
      </p>

      <h1
        style="font-family:var(--title-font);font-weight:400"
      >
        Sem permissão
      </h1>

      <p>
        Esta conta não possui acesso a este módulo.
      </p>

      <a
        class="btn btn-primary"
        href="${esc(destination)}"
      >
        Abrir página permitida
      </a>
    </div>
  `;
}

export async function bootstrapPage({
  permission = null,
  onReady = async () => {}
} = {}) {
  setupShell();

  await completeRedirectLogin()
    .catch(console.error);

  observeAuth(async user => {
    if (!user) {
      sessionStorage.removeItem(
        "adminShellUser"
      );

      sessionStorage.removeItem(
        "adminShellAccess"
      );

      location.href =
        "login.html";

      return;
    }

    try {
      currentUser = user;
      currentAdmin =
        await ensureAdmin(user);

      fillUser(
        user,
        currentAdmin
      );

      applyAdminMenuPermissions(
        currentAdmin
      );

      const pagePermission =
        permission ||
        NAV_PERMISSION_MAP[
          document.body.dataset.page
        ];

      if (
        pagePermission &&
        !hasPermission(
          pagePermission
        )
      ) {
        showAccessDenied();
        revealPage();
        return;
      }

      await onReady({
        user,
        admin: currentAdmin
      });

      revealPage();
    } catch (error) {
      console.error(error);

      sessionStorage.setItem(
        "adminLoginError",
        error.message
      );

      sessionStorage.removeItem(
        "adminShellUser"
      );

      sessionStorage.removeItem(
        "adminShellAccess"
      );

      await logout();

      location.href =
        "login.html";
    }
  });
}

export async function initializeFirebaseProject() {
  const response = await fetch(
    "assets/data/presentes.json"
  );

  if (!response.ok) {
    throw new Error(
      "Não foi possível carregar a lista de presentes."
    );
  }

  const items =
    await response.json();

  const batch =
    writeBatch(db);

  batch.set(
    doc(
      db,
      "configuracoes",
      "publico"
    ),
    {
      siteName:
        "Mislaine & Emerson",

      pageTitle:
        "Casamento de Mislaine & Emerson",

      introText:
        "Estamos preparando este momento com muito carinho. Neste espaço você poderá confirmar sua presença e escolher uma forma especial de nos presentear.",

      weddingDate:
        Timestamp.fromDate(
          new Date(
            "2026-09-06T17:00:00-04:00"
          )
        ),

      confirmationDeadline:
        Timestamp.fromDate(
          new Date(
            "2026-09-01T17:00:00-04:00"
          )
        ),

      venueName:
        "CATRE",

      venueAddress:
        "Av. Brasília, 5373 - Boa Esperança, Rolim de Moura - RO",

      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=CATRE%20Av.%20Bras%C3%ADlia%205373%20Boa%20Esperan%C3%A7a%20Rolim%20de%20Moura%20RO",

      childMaxAge: 12,
      reservationHours: 24,
      domain: "",
      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  batch.set(
    doc(
      db,
      "configuracoes",
      "entregaPublica"
    ),
    {
      recipient: "",
      phone: "",
      zipCode: "76954-000",
      street:
        "Rua Santa Catarina",
      number: "3832",
      complement: "",
      neighborhood: "Centro",
      city:
        "Alta Floresta D'Oeste",
      state: "RO",
      reference: "",
      active: true,
      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  batch.set(
    doc(
      db,
      "configuracoes",
      "dominio"
    ),
    {
      publicDomain: "",
      adminDomain: "",
      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  for (const item of items) {
    batch.set(
      doc(
        db,
        "presentes",
        item.id
      ),
      {
        ...item,
        purchaseStatus:
          "disponivel",
        pixStatus:
          "sem_contribuicao",
        pixConfirmedTotal: 0,
        pixOverflowTotal: 0,
        visivelPublico: true,
        reservationId: null,
        reservedByUid: null,
        reservationExpiresAt: null,
        createdAt:
          serverTimestamp(),
        updatedAt:
          serverTimestamp()
      },
      {
        merge: true
      }
    );
  }

  await batch.commit();

  return items.length;
}

export async function startLoginPage() {
  const message =
    $("loginMessage");

  const storedError =
    sessionStorage.getItem(
      "adminLoginError"
    );

  if (storedError) {
    message.textContent =
      storedError;

    message.className =
      "notice danger";

    sessionStorage.removeItem(
      "adminLoginError"
    );
  }

  await completeRedirectLogin()
    .catch(error => {
      message.textContent =
        error.message;

      message.className =
        "notice danger";
    });

  observeAuth(async user => {
    if (!user) return;

    try {
      const admin =
        await ensureAdmin(user);

      fillUser(user, admin);

      location.href =
        firstAllowedPage(admin);
    } catch (error) {
      message.textContent =
        error.message;

      message.className =
        "notice danger";

      await logout();
    }
  });

  $("loginButton").addEventListener(
    "click",
    async () => {
      const button =
        $("loginButton");

      button.disabled = true;

      try {
        await loginWithGoogle();
      } catch (error) {
        message.textContent =
          error.message;

        message.className =
          "notice danger";
      } finally {
        button.disabled = false;
      }
    }
  );
}
