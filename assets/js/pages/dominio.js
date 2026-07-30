import {
  bootstrapPage,
  db,
  $,
  hasSubPermission,
  toast
} from "../admin-core.js?v=3.2.0";

import {
  applySiteButtonUrl,
  normalizeSiteButtonUrl
} from "../site-button.js?v=2.8.2";

import {
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js?v=3.2.0";

function showCurrentSiteButtonUrl(
  value
) {
  const link =
    $("currentSiteButtonLink");

  let url = "";

  try {
    url =
      normalizeSiteButtonUrl(value);
  } catch {
    url = "";
  }

  if (!url) {
    link.textContent =
      "Nenhum link configurado";

    link.href = "#";

    link.removeAttribute(
      "target"
    );

    link.setAttribute(
      "aria-disabled",
      "true"
    );

    return;
  }

  link.textContent = url;
  link.href = url;
  link.target = "_blank";
  link.rel =
    "noopener noreferrer";

  link.setAttribute(
    "aria-disabled",
    "false"
  );
}

function applyAccess() {
  const canEditDomains =
    hasSubPermission(
      "dominio",
      "editDomains"
    );

  const canEditSiteButton =
    hasSubPermission(
      "dominio",
      "editSiteButton"
    );

  [
    "publicDomain",
    "adminDomain"
  ].forEach(id => {
    $(id).disabled =
      !canEditDomains;
  });

  const domainSubmit =
    document.querySelector(
      '#domainForm button[type="submit"]'
    );

  if (domainSubmit) {
    domainSubmit.disabled =
      !canEditDomains;
  }

  $("siteButtonUrl").disabled =
    !canEditSiteButton;

  $("saveSiteButtonUrl").disabled =
    !canEditSiteButton;

  $("usePublicDomainButton").disabled =
    !canEditSiteButton;

  if (!canEditDomains) {
    $("domainForm")
      .setAttribute(
        "data-permission-blocked",
        "true"
      );
  }

  if (!canEditSiteButton) {
    $("siteButtonForm")
      .setAttribute(
        "data-permission-blocked",
        "true"
      );
  }
}

async function load() {
  const [
    domainSnapshot,
    publicSnapshot
  ] = await Promise.all([
    getDoc(
      doc(
        db,
        "configuracoes",
        "dominio"
      )
    ),

    getDoc(
      doc(
        db,
        "configuracoes",
        "publico"
      )
    )
  ]);

  const domainData =
    domainSnapshot.exists()
      ? domainSnapshot.data()
      : {};

  const publicData =
    publicSnapshot.exists()
      ? publicSnapshot.data()
      : {};

  $("publicDomain").value =
    domainData.publicDomain ||
    publicData.domain ||
    "";

  $("adminDomain").value =
    domainData.adminDomain || "";

  const configuredSiteButtonUrl =
    publicData.siteButtonUrl ||
    domainData.siteButtonUrl ||
    "";

  $("siteButtonUrl").value =
    configuredSiteButtonUrl;

  showCurrentSiteButtonUrl(
    configuredSiteButtonUrl
  );
}

async function saveDomains() {
  const publicDomain =
    $("publicDomain")
      .value
      .trim();

  const adminDomain =
    $("adminDomain")
      .value
      .trim();

  await setDoc(
    doc(
      db,
      "configuracoes",
      "dominio"
    ),
    {
      publicDomain,
      adminDomain,
      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  await setDoc(
    doc(
      db,
      "configuracoes",
      "publico"
    ),
    {
      domain:
        publicDomain,
      updatedAt:
        serverTimestamp()
    },
    {
      merge: true
    }
  );

  await tryRecordAdminLog({
    module:
      "configuracoes",
    action: "atualizado",
    recordId:
      "configuracoes/dominio",
    summary:
      "Domínios público e administrativo atualizados.",
    details: {
      publicDomain,
      adminDomain
    }
  });

  toast(
    "Domínios salvos"
  );
}

async function saveSiteButtonUrl() {
  const normalizedUrl =
    normalizeSiteButtonUrl(
      $("siteButtonUrl").value
    );

  if (!normalizedUrl) {
    throw new Error(
      "Informe o link que será aberto pelo botão Site."
    );
  }

  const batch =
    writeBatch(db);

  const updatedAt =
    serverTimestamp();

  batch.set(
    doc(
      db,
      "configuracoes",
      "dominio"
    ),
    {
      siteButtonUrl:
        normalizedUrl,
      updatedAt
    },
    {
      merge: true
    }
  );

  batch.set(
    doc(
      db,
      "configuracoes",
      "publico"
    ),
    {
      siteButtonUrl:
        normalizedUrl,
      updatedAt
    },
    {
      merge: true
    }
  );

  await batch.commit();

  $("siteButtonUrl").value =
    normalizedUrl;

  applySiteButtonUrl(
    normalizedUrl
  );

  showCurrentSiteButtonUrl(
    normalizedUrl
  );

  await tryRecordAdminLog({
    module:
      "configuracoes",
    action: "atualizado",
    recordId:
      "configuracoes/dominio",
    summary:
      "Link do botão Site atualizado.",
    details: {
      siteButtonUrl:
        normalizedUrl
    }
  });

  toast(
    "Link do botão Site salvo"
  );
}

function usePublicDomain() {
  const publicDomain =
    $("publicDomain")
      .value
      .trim();

  if (!publicDomain) {
    alert(
      "Primeiro informe o domínio oficial do site público."
    );

    return;
  }

  try {
    $("siteButtonUrl").value =
      normalizeSiteButtonUrl(
        publicDomain
      );
  } catch (error) {
    alert(error.message);
  }
}

function testSiteButtonUrl() {
  try {
    const url =
      normalizeSiteButtonUrl(
        $("siteButtonUrl").value
      );

    if (!url) {
      throw new Error(
        "Informe um link antes de realizar o teste."
      );
    }

    const openedWindow =
      window.open(
        url,
        "_blank",
        "noopener,noreferrer"
      );

    if (openedWindow) {
      openedWindow.opener =
        null;
    }
  } catch (error) {
    alert(error.message);
  }
}

bootstrapPage({
  permission: "dominio",

  onReady: async () => {
    await load();
    applyAccess();

    $("domainForm")
      .addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          if (
            !hasSubPermission(
              "dominio",
              "editDomains"
            )
          ) {
            return;
          }

          try {
            await saveDomains();
          } catch (error) {
            alert(
              error.message ||
              "Não foi possível salvar os domínios."
            );
          }
        }
      );

    $("siteButtonForm")
      .addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          if (
            !hasSubPermission(
              "dominio",
              "editSiteButton"
            )
          ) {
            return;
          }

          const button =
            $("saveSiteButtonUrl");

          button.disabled = true;

          try {
            await saveSiteButtonUrl();
          } catch (error) {
            alert(
              error.message ||
              "Não foi possível salvar o link do botão Site."
            );
          } finally {
            button.disabled = false;
          }
        }
      );

    $("usePublicDomainButton")
      .addEventListener(
        "click",
        usePublicDomain
      );

    $("testSiteButtonUrl")
      .addEventListener(
        "click",
        testSiteButtonUrl
      );
  }
});
