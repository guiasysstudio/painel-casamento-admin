import { db } from "./firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const CACHE_KEY = "casamento.admin.siteButtonUrl";

export function normalizeSiteButtonUrl(value) {
  let url = String(value || "").trim();

  if (!url) return "";

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Informe um domínio ou link válido para o site público."
    );
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      "O link do site precisa começar com http:// ou https://."
    );
  }

  if (!parsed.hostname) {
    throw new Error(
      "Informe um domínio válido para o site público."
    );
  }

  return parsed.href;
}

function readCachedUrl() {
  try {
    return localStorage.getItem(CACHE_KEY) || "";
  } catch {
    return "";
  }
}

function writeCachedUrl(url) {
  try {
    if (url) {
      localStorage.setItem(CACHE_KEY, url);
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // O botão continua funcionando mesmo sem armazenamento local.
  }
}

export function applySiteButtonUrl(value, {
  updateCache = true
} = {}) {
  let url = "";

  try {
    url = normalizeSiteButtonUrl(value);
  } catch {
    url = "";
  }

  document.querySelectorAll(
    "[data-site-button], .sidebar-site-button"
  ).forEach(button => {
    button.dataset.siteButton = "true";

    if (url) {
      button.href = url;
      button.target = "_blank";
      button.rel = "noopener noreferrer";
      button.setAttribute("aria-disabled", "false");
      button.classList.remove("is-disabled");
      button.title = "Abrir site público";
      button.setAttribute("aria-label", "Abrir site público");
      return;
    }

    button.href = "#";
    button.removeAttribute("target");
    button.removeAttribute("rel");
    button.setAttribute("aria-disabled", "true");
    button.classList.add("is-disabled");
    button.title =
      "Configure o endereço do botão Site na página Domínio";
    button.setAttribute(
      "aria-label",
      "Botão Site sem endereço configurado"
    );
  });

  if (updateCache) {
    writeCachedUrl(url);
  }

  return url;
}

export async function refreshSiteButtonUrl() {
  const cachedUrl = readCachedUrl();

  if (cachedUrl) {
    applySiteButtonUrl(cachedUrl, {
      updateCache: false
    });
  } else {
    applySiteButtonUrl("", {
      updateCache: false
    });
  }

  try {
    const snapshot = await getDoc(
      doc(db, "configuracoes", "publico")
    );

    const configuredUrl = snapshot.exists()
      ? snapshot.data().siteButtonUrl || ""
      : "";

    return applySiteButtonUrl(configuredUrl);
  } catch (error) {
    console.warn(
      "Não foi possível carregar o link do botão Site.",
      error
    );

    return cachedUrl
      ? applySiteButtonUrl(cachedUrl, {
          updateCache: false
        })
      : applySiteButtonUrl("", {
          updateCache: false
        });
  }
}

function preventDisabledButtonClick(event) {
  const button = event.target.closest(
    "[data-site-button], .sidebar-site-button"
  );

  if (
    button &&
    button.getAttribute("aria-disabled") === "true"
  ) {
    event.preventDefault();
  }
}

function start() {
  document.addEventListener(
    "click",
    preventDisabledButtonClick
  );

  refreshSiteButtonUrl();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    start,
    { once: true }
  );
} else {
  start();
}
