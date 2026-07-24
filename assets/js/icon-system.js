(() => {
  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();

  const navIcons = {
    dashboard: "dashboard",
    confirmacoes: "confirmations",
    presentes: "gifts",
    reservas: "reservations",
    pix: "pix",
    "pagina-inicial": "home-edit",
    entrega: "delivery",
    administradores: "admins",
    dominio: "domain",
    exportacoes: "export",
    logs: "logs"
  };

  const buttonRules = [
    [/^entrar com google$/, "user"],
    [/^sair$/, "logout"],
    [/^atualizar$/, "refresh"],
    [/^novo presente$/, "add"],
    [/^cadastrar administrador$/, "add"],
    [/^salvar/, "save"],
    [/^gerar arquivo excel$/, "export"],
    [/^exportar/, "export"],
    [/^editar$/, "edit"],
    [/^excluir$/, "delete"],
    [/^ativar$/, "enable"],
    [/^desativar$/, "disable"],
    [/^confirmar compra$/, "confirm"],
    [/^confirmar$/, "confirm"],
    [/^desconfirmar$/, "unconfirm"],
    [/^recusar$/, "reject"],
    [/^voltar para aguardando$/, "reopen"],
    [/^liberar presente$/, "release"],
    [/^restaurar$/, "restore"],
    [/^restaurar original$/, "restore"],
    [/^cancelar$/, "close"],
    [/^cancelar edicao$/, "close"],
    [/^configuracao pix$/, "settings"],
    [/^testar configuracao$/, "qrcode"],
    [/^processar imagem$/, "image-fit"],
    [/^inicializar projeto no firebase$/, "settings"],
    [/^voltar ao painel$/, "dashboard"],
    [/^(salvando|carregando|processando|consultando|gerando|registrando)/, "loading-sequence"]
  ];

  const idIcons = {
    reloadButton: "refresh",
    newGiftButton: "add",
    initializeButton: "settings",
    processImageUrlButton: "link",
    restoreOriginalImageButton: "restore",
    openPixConfigButton: "settings",
    testPixConfigButton: "qrcode",
    savePixConfigButton: "save",
    saveAdminButton: "save",
    exportButton: "export",
    loginButton: "user"
  };

  function icon(name, extraClass = "") {
    const span = document.createElement("span");
    const loadingClass =
      name === "loading-sequence"
        ? " icon-loading-1 loading-icon-sequence"
        : "";

    span.className =
      `ui-icon icon-${name}${loadingClass}${extraClass ? ` ${extraClass}` : ""}`;
    span.setAttribute("aria-hidden", "true");
    span.dataset.generatedIcon = "true";
    return span;
  }

  function leadingIcon(element, name) {
    if (!element || !name) return;

    const current = element.querySelector(":scope > .ui-icon");

    if (
      current?.classList.contains(`icon-${name}`) ||
      (
        name === "loading-sequence" &&
        current?.classList.contains("loading-icon-sequence")
      )
    ) {
      return;
    }

    current?.remove();

    element.prepend(icon(name));
  }

  function iconNameForText(text) {
    const normalized = normalize(text);

    for (const [pattern, name] of buttonRules) {
      if (pattern.test(normalized)) return name;
    }

    return "";
  }

  function scanNavigation(root) {
    root.querySelectorAll?.(".admin-nav a[data-nav-page]")
      .forEach(link => {
        const name = navIcons[link.dataset.navPage];
        if (!name) return;

        let holder = link.querySelector(":scope > .nav-icon");

        if (!holder) {
          holder = document.createElement("span");
          holder.className = "nav-icon";
          link.prepend(holder);
        }

        holder.textContent = "";
        holder.className = `nav-icon ui-icon icon-${name}`;
        holder.setAttribute("aria-hidden", "true");
      });
  }

  function scanFixedControls(root) {
    root.querySelectorAll?.("#menuToggle, .menu-toggle")
      .forEach(button => {
        const current = button.querySelector(":scope > .icon-menu");

        if (current && button.children.length === 1) return;
        button.replaceChildren(icon("menu"));
      });

    root.querySelectorAll?.(".modal-close")
      .forEach(button => {
        const current = button.querySelector(":scope > .icon-close");

        if (current && button.children.length === 1) return;
        button.replaceChildren(icon("close"));
      });

    root.querySelectorAll?.(".page-loader-spinner")
      .forEach(spinner => {
        spinner.textContent = "";
        spinner.classList.add("loading-icon-sequence");
      });
  }

  function scanButtons(root) {
    root.querySelectorAll?.("button, a.btn")
      .forEach(element => {
        if (
          element.matches(
            ".menu-toggle, .modal-close, .btn-icon-only"
          )
        ) {
          return;
        }

        const dataIcon =
          element.dataset.icon ||
          idIcons[element.id] ||
          (
            element.hasAttribute("data-confirm")
              ? "confirm"
              : element.hasAttribute("data-release")
                ? "release"
                : element.hasAttribute("data-edit")
                  ? "edit"
                  : element.hasAttribute("data-delete") ||
                    element.hasAttribute("data-delete-pix")
                    ? "delete"
                    : element.hasAttribute("data-unconfirm")
                      ? "unconfirm"
                      : element.hasAttribute("data-reject")
                        ? "reject"
                        : element.hasAttribute("data-reopen")
                          ? "reopen"
                          : element.hasAttribute("data-toggle")
                            ? iconNameForText(element.textContent)
                            : ""
          ) ||
          iconNameForText(element.textContent);

        if (dataIcon) leadingIcon(element, dataIcon);
      });
  }

  function scanLoading(root) {
    root.querySelectorAll?.(".loading")
      .forEach(element => {
        if (!element.querySelector(".loading-icon-sequence")) {
          element.prepend(icon("loading-sequence", "loading-icon-sequence"));
        }
      });
  }

  function scanStatuses(root) {
    root.querySelectorAll?.(".status")
      .forEach(status => {
        if (status.querySelector(":scope > .ui-icon")) return;

        const name = status.classList.contains("ok")
          ? "check"
          : status.classList.contains("bad")
            ? "error"
            : status.classList.contains("warn")
              ? "warning"
              : "";

        if (name) status.prepend(icon(name));
      });
  }

  function scanDashboard(root) {
    root.querySelectorAll?.(".dashboard-card")
      .forEach(card => {
        let holder = card.querySelector(
          ":scope > .dashboard-icon, :scope > .dashboard-card-icon"
        );

        const label = normalize(
          card.querySelector("small, span:not(.dashboard-icon)")?.textContent
        );

        let name = "dashboard";

        if (label.includes("familia")) name = "family";
        else if (label.includes("adulto")) name = "adult";
        else if (label.includes("crianca")) name = "child";
        else if (label.includes("presente")) name = "gifts";
        else if (label.includes("reserva")) name = "reservations";
        else if (label.includes("pix confirmado")) name = "check";
        else if (label.includes("pix pendente") || label.includes("aguardando")) name = "pix";
        else if (label.includes("dinheiro")) name = "money";
        else if (label.includes("recusado")) name = "reject";

        if (!holder) {
          holder = document.createElement("span");
          holder.className = "dashboard-card-icon";
          card.prepend(holder);
        }

        holder.textContent = "";
        holder.className = `dashboard-icon ui-icon icon-${name}`;
        holder.setAttribute("aria-hidden", "true");
      });

    root.querySelectorAll?.(".quick-card")
      .forEach(card => {
        if (card.querySelector(":scope > .quick-card-icon")) return;

        const href = card.getAttribute("href") || "";
        const name = href.includes("confirmacoes")
          ? "confirmations"
          : href.includes("presentes")
            ? "gifts"
            : href.includes("pix")
              ? "pix"
              : "dashboard";

        const holder = icon(name, "quick-card-icon");
        card.prepend(holder);
      });
  }

  let scheduled = false;

  function scan(root = document) {
    scanNavigation(root);
    scanFixedControls(root);
    scanButtons(root);
    scanLoading(root);
    scanStatuses(root);
    scanDashboard(root);
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      scan(document);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    scan(document);

    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
})();
