import {
  bootstrapPage,
  db,
  $,
  esc,
  money,
  currentUser,
  toast
} from "../admin-core.js";

import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  normalizePixConfig,
  buildPixPayload,
  validatePixPayload,
  formatPixKey
} from "../pix-brcode.js";

import {
  renderQrToCanvas
} from "../qr-local.js";

let pixEntries = [];
let pixConfiguration = null;

function pixMirrorRef(pix, pixId) {
  if (!pix?.profileId) return null;

  return doc(
    db,
    "perfisPix",
    pix.profileId,
    "pix",
    pixId
  );
}

function timestampMillis(value) {
  return value?.toMillis?.() ||
    value?.toDate?.().getTime?.() ||
    0;
}

function formatDate(value) {
  const milliseconds = timestampMillis(value);

  if (!milliseconds) return "Data indisponível";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(milliseconds));
}

function statusLabel(status) {
  return ({
    aguardando_confirmacao: "Aguardando",
    confirmado: "Confirmado",
    recusado: "Recusado"
  })[status] || status || "Desconhecido";
}

function statusClass(status) {
  return status === "confirmado"
    ? "ok"
    : status === "recusado"
      ? "bad"
      : "warn";
}

function destinationLabel(entry) {
  return entry.destinationType === "cash" ||
    entry.giftId === "presente-dinheiro"
    ? "Presente em dinheiro"
    : entry.giftName || "Produto";
}

function filteredEntries() {
  const term = $("pixSearch").value
    .trim()
    .toLocaleLowerCase("pt-BR");

  const selectedStatus = $("pixStatusFilter").value;

  return pixEntries.filter(entry => {
    const haystack = [
      entry.guestName,
      entry.whatsapp,
      entry.giftName,
      entry.txid
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR");

    return (
      (!term || haystack.includes(term)) &&
      (!selectedStatus || entry.status === selectedStatus)
    );
  });
}

function updateStatistics() {
  const pending = pixEntries.filter(
    item => item.status === "aguardando_confirmacao"
  );

  const confirmed = pixEntries.filter(
    item => item.status === "confirmado"
  );

  const cash = confirmed.filter(
    item =>
      item.destinationType === "cash" ||
      item.giftId === "presente-dinheiro"
  );

  const rejected = pixEntries.filter(
    item => item.status === "recusado"
  );

  const sum = items => items.reduce(
    (total, item) => total + Number(item.value || 0),
    0
  );

  $("pixPendingCount").textContent = pending.length;
  $("pixPendingValue").textContent = money(sum(pending));

  $("pixConfirmedCount").textContent = confirmed.length;
  $("pixConfirmedValue").textContent = money(sum(confirmed));

  $("pixCashCount").textContent = cash.length;
  $("pixCashValue").textContent = money(sum(cash));

  $("pixRejectedCount").textContent = rejected.length;
  $("pixRejectedValue").textContent = money(sum(rejected));
}

function renderTable() {
  const area = $("tableArea");
  const list = filteredEntries();

  area.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Convidado</th>
          <th>Destino</th>
          <th>Valor</th>
          <th>Status</th>
          <th>Ações</th>
        </tr>
      </thead>

      <tbody>
        ${
          list.map(entry => `
            <tr>
              <td class="pix-date">
                ${esc(formatDate(entry.createdAt))}
                <small class="pix-txid" title="${esc(entry.txid || "")}">
                  TXID: ${esc(entry.txid || "não informado")}
                </small>
              </td>

              <td>
                <strong>${esc(entry.guestName || "Sem nome")}</strong>
                <br>
                <small>${esc(entry.whatsapp || "")}</small>
              </td>

              <td>
                <div class="pix-destination">
                  <strong>${esc(destinationLabel(entry))}</strong>
                  ${
                    entry.status === "confirmado" &&
                    Number(entry.overflowValue || 0) > 0
                      ? `
                        <small>
                          Excedente em dinheiro:
                          ${money(entry.overflowValue)}
                        </small>
                      `
                      : ""
                  }
                </div>
              </td>

              <td><strong>${money(entry.value)}</strong></td>

              <td>
                <span class="status ${statusClass(entry.status)}">
                  ${esc(statusLabel(entry.status))}
                </span>
              </td>

              <td>
                <div class="pix-status-actions">
                  ${
                    entry.status === "aguardando_confirmacao"
                      ? `
                        <button
                          class="btn btn-small btn-primary"
                          type="button"
                          data-confirm="${entry.id}"
                        >
                          Confirmar
                        </button>

                        <button
                          class="btn btn-small btn-secondary"
                          type="button"
                          data-reject="${entry.id}"
                        >
                          Recusar
                        </button>
                      `
                      : ""
                  }

                  ${
                    entry.status === "confirmado"
                      ? `
                        <button
                          class="btn btn-small btn-unconfirm"
                          type="button"
                          data-unconfirm="${entry.id}"
                        >
                          Desconfirmar
                        </button>
                      `
                      : ""
                  }

                  ${
                    entry.status === "recusado"
                      ? `
                        <button
                          class="btn btn-small btn-secondary"
                          type="button"
                          data-reopen="${entry.id}"
                        >
                          Voltar para aguardando
                        </button>
                      `
                      : ""
                  }

                  <button
                    class="btn btn-small btn-danger"
                    type="button"
                    data-delete-pix="${entry.id}"
                  >
                    Excluir
                  </button>
                </div>
              </td>
            </tr>
          `).join("") ||
          `
            <tr>
              <td colspan="6">
                Nenhum PIX encontrado para os filtros selecionados.
              </td>
            </tr>
          `
        }
      </tbody>
    </table>
  `;

  area.querySelectorAll("[data-confirm]").forEach(button => {
    button.addEventListener("click", () => {
      confirmPix(button.dataset.confirm);
    });
  });

  area.querySelectorAll("[data-reject]").forEach(button => {
    button.addEventListener("click", () => {
      rejectPix(button.dataset.reject);
    });
  });

  area.querySelectorAll("[data-reopen]").forEach(button => {
    button.addEventListener("click", () => {
      reopenPix(button.dataset.reopen);
    });
  });

  area.querySelectorAll("[data-unconfirm]").forEach(button => {
    button.addEventListener("click", () => {
      unconfirmPix(button.dataset.unconfirm);
    });
  });

  area.querySelectorAll("[data-delete-pix]").forEach(button => {
    button.addEventListener("click", () => {
      deletePixEntry(button.dataset.deletePix);
    });
  });
}

async function loadEntries() {
  const area = $("tableArea");
  area.innerHTML =
    '<div class="loading">Carregando contribuições PIX...</div>';

  try {
    const snapshot = await getDocs(
      collection(db, "pixInformados")
    );

    pixEntries = snapshot.docs
      .map(documentSnapshot => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data()
      }))
      .sort(
        (a, b) =>
          timestampMillis(b.createdAt) -
          timestampMillis(a.createdAt)
      );

    updateStatistics();
    renderTable();
  } catch (error) {
    area.innerHTML = `
      <div class="notice danger">
        ${esc(
          error.message ||
          "Não foi possível carregar os PIX informados."
        )}
      </div>
    `;
  }
}

async function confirmPix(id) {
  const entry = pixEntries.find(item => item.id === id);

  if (!entry) return;

  const confirmed = confirm(
    `Confirma que o PIX de ${money(entry.value)} enviado por ` +
    `${entry.guestName || "este convidado"} foi recebido no banco?`
  );

  if (!confirmed) return;

  try {
    await runTransaction(db, async transaction => {
      const pixRef = doc(db, "pixInformados", id);
      const pixSnapshot = await transaction.get(pixRef);

      if (!pixSnapshot.exists()) {
        throw new Error("O registro PIX não foi encontrado.");
      }

      const pix = pixSnapshot.data();

      if (pix.status !== "aguardando_confirmacao") {
        throw new Error("Este PIX já foi processado.");
      }

      const value = Number(pix.value || 0);
      let appliedToGift = 0;
      let overflowValue = value;
      let visibilityBeforePix = null;

      if (
        pix.destinationType !== "cash" &&
        pix.giftId !== "presente-dinheiro"
      ) {
        const giftRef = doc(db, "presentes", pix.giftId);
        const giftSnapshot = await transaction.get(giftRef);

        if (!giftSnapshot.exists()) {
          throw new Error(
            "O presente relacionado a este PIX não foi encontrado."
          );
        }

        const gift = giftSnapshot.data();
        const price = Number(gift.valorEstimado || 0);
        const previousApplied = Number(
          gift.pixConfirmedTotal || 0
        );

        const remaining = Math.max(
          0,
          price - previousApplied
        );

        appliedToGift = Math.min(value, remaining);
        overflowValue = Math.max(0, value - appliedToGift);

        const newApplied = previousApplied + appliedToGift;
        const newOverflow =
          Number(gift.pixOverflowTotal || 0) +
          overflowValue;

        const completed =
          price > 0 && newApplied >= price;

        visibilityBeforePix =
          gift.visivelPublico === true;

        transaction.update(giftRef, {
          pixConfirmedTotal: newApplied,
          pixOverflowTotal: newOverflow,
          pixStatus:
            completed
              ? "concluido"
              : newApplied > 0
                ? "parcial"
                : "sem_contribuicao",
          visivelPublico:
            completed
              ? false
              : gift.visivelPublico,
          updatedAt: serverTimestamp()
        });
      }

      transaction.update(pixRef, {
        status: "confirmado",
        appliedToGift,
        overflowValue,
        giftVisibilityBeforePix: visibilityBeforePix,
        giftHiddenByPix:
          appliedToGift > 0 &&
          visibilityBeforePix === true,
        confirmedAt: serverTimestamp(),
        confirmedBy: currentUser.email,
        updatedAt: serverTimestamp()
      });


      const mirrorRef = pixMirrorRef(pix, id);

      if (mirrorRef) {
        transaction.set(
          mirrorRef,
          {
            status: "confirmado",
            appliedToGift,
            overflowValue,
            giftVisibilityBeforePix: visibilityBeforePix,
            giftHiddenByPix:
              appliedToGift > 0 &&
              visibilityBeforePix === true,
            confirmedAt: serverTimestamp(),
            confirmedBy: currentUser.email,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      }
    });

    toast("PIX confirmado");
    await loadEntries();
  } catch (error) {
    alert(
      error.message ||
      "Não foi possível confirmar o PIX."
    );
  }
}

function isCashPix(pix) {
  return (
    pix.destinationType === "cash" ||
    pix.giftId === "presente-dinheiro"
  );
}

function shouldRestoreGiftVisibility(pix, gift, completedAfterRollback) {
  if (completedAfterRollback) return false;
  if (gift.ativo === false) return false;
  if (gift.purchaseStatus === "comprado") return false;

  return (
    pix.giftHiddenByPix === true ||
    pix.giftVisibilityBeforePix === true
  );
}

async function rollbackConfirmedPix(
  transaction,
  pixRef,
  pix,
  {
    deleteEntry = false
  } = {}
) {
  if (pix.status !== "confirmado") {
    throw new Error(
      "Este PIX não está confirmado e não precisa ser desfeito."
    );
  }

  if (!isCashPix(pix)) {
    const giftRef = doc(db, "presentes", pix.giftId);
    const giftSnapshot = await transaction.get(giftRef);

    if (!giftSnapshot.exists()) {
      throw new Error(
        "O presente relacionado não foi encontrado. O PIX não foi alterado."
      );
    }

    const gift = giftSnapshot.data();
    const price = Math.max(
      0,
      Number(gift.valorEstimado || 0)
    );

    const previousApplied = Math.max(
      0,
      Number(gift.pixConfirmedTotal || 0)
    );

    const previousOverflow = Math.max(
      0,
      Number(gift.pixOverflowTotal || 0)
    );

    /*
     * Os campos abaixo são gravados na confirmação.
     * Math.min protege contra totais antigos ou inconsistentes.
     */
    const appliedToGift = Math.min(
      previousApplied,
      Math.max(0, Number(pix.appliedToGift || 0))
    );

    const overflowValue = Math.min(
      previousOverflow,
      Math.max(0, Number(pix.overflowValue || 0))
    );

    const newApplied = Math.max(
      0,
      previousApplied - appliedToGift
    );

    const newOverflow = Math.max(
      0,
      previousOverflow - overflowValue
    );

    const completedAfterRollback =
      price > 0 && newApplied >= price;

    const newPixStatus =
      completedAfterRollback
        ? "concluido"
        : newApplied > 0
          ? "parcial"
          : "sem_contribuicao";

    const restoreVisibility =
      shouldRestoreGiftVisibility(
        pix,
        gift,
        completedAfterRollback
      );

    transaction.update(giftRef, {
      pixConfirmedTotal: newApplied,
      pixOverflowTotal: newOverflow,
      pixStatus: newPixStatus,
      visivelPublico:
        completedAfterRollback
          ? false
          : restoreVisibility
            ? true
            : gift.visivelPublico,
      updatedAt: serverTimestamp()
    });
  }

  const mirrorRef = pixMirrorRef(pix, pixRef.id);

  if (deleteEntry) {
    transaction.delete(pixRef);

    if (mirrorRef) {
      transaction.delete(mirrorRef);
    }

    return;
  }

  const rollbackData = {
    status: "aguardando_confirmacao",
    appliedToGift: 0,
    overflowValue: 0,
    giftVisibilityBeforePix: null,
    giftHiddenByPix: false,
    confirmedAt: null,
    confirmedBy: null,
    unconfirmedAt: serverTimestamp(),
    unconfirmedBy: currentUser.email,
    updatedAt: serverTimestamp()
  };

  transaction.update(pixRef, rollbackData);

  if (mirrorRef) {
    transaction.set(
      mirrorRef,
      rollbackData,
      { merge: true }
    );
  }

}

async function unconfirmPix(id) {
  const entry = pixEntries.find(item => item.id === id);

  if (!entry) return;

  const confirmed = confirm(
    `Desconfirmar o PIX de ${money(entry.value)} enviado por ` +
    `${entry.guestName || "este convidado"}?\n\n` +
    "O valor será retirado do acumulado do presente e o produto " +
    "reaparecerá no site público quando necessário."
  );

  if (!confirmed) return;

  try {
    await runTransaction(db, async transaction => {
      const pixRef = doc(db, "pixInformados", id);
      const pixSnapshot = await transaction.get(pixRef);

      if (!pixSnapshot.exists()) {
        throw new Error("O registro PIX não foi encontrado.");
      }

      await rollbackConfirmedPix(
        transaction,
        pixRef,
        pixSnapshot.data()
      );
    });

    toast("Confirmação do PIX desfeita");
    await loadEntries();
  } catch (error) {
    alert(
      error.message ||
      "Não foi possível desconfirmar o PIX."
    );
  }
}

async function deletePixEntry(id) {
  const entry = pixEntries.find(item => item.id === id);

  if (!entry) return;

  const confirmedEntry = entry.status === "confirmado";

  const warning = confirmedEntry
    ? (
        "\n\nEste PIX está confirmado. Antes da exclusão, o valor será " +
        "retirado do acumulado do presente."
      )
    : "";

  const accepted = confirm(
    `Excluir permanentemente o PIX de ${money(entry.value)} informado por ` +
    `${entry.guestName || "este convidado"}?` +
    warning +
    "\n\nEsta ação não poderá ser desfeita."
  );

  if (!accepted) return;

  try {
    await runTransaction(db, async transaction => {
      const pixRef = doc(db, "pixInformados", id);
      const pixSnapshot = await transaction.get(pixRef);

      if (!pixSnapshot.exists()) {
        throw new Error("O registro PIX não foi encontrado.");
      }

      const pix = pixSnapshot.data();

      if (pix.status === "confirmado") {
        await rollbackConfirmedPix(
          transaction,
          pixRef,
          pix,
          {
            deleteEntry: true
          }
        );
      } else {
        transaction.delete(pixRef);

        const mirrorRef = pixMirrorRef(pix, id);

        if (mirrorRef) {
          transaction.delete(mirrorRef);
        }
      }
    });

    toast("PIX excluído");
    await loadEntries();
  } catch (error) {
    alert(
      error.message ||
      "Não foi possível excluir o PIX."
    );
  }
}
async function rejectPix(id) {
  const entry = pixEntries.find(item => item.id === id);

  if (!entry) return;

  const confirmed = confirm(
    `Recusar o PIX informado por ${entry.guestName || "este convidado"}?`
  );

  if (!confirmed) return;

  try {
    await runTransaction(db, async transaction => {
      const pixRef = doc(db, "pixInformados", id);
      const snapshot = await transaction.get(pixRef);

      if (!snapshot.exists()) {
        throw new Error("O registro PIX não foi encontrado.");
      }

      const pix = snapshot.data();

      if (pix.status !== "aguardando_confirmacao") {
        throw new Error(
          "Somente PIX aguardando confirmação podem ser recusados."
        );
      }

      const data = {
        status: "recusado",
        rejectedAt: serverTimestamp(),
        rejectedBy: currentUser.email,
        updatedAt: serverTimestamp()
      };

      transaction.update(pixRef, data);

      const mirrorRef = pixMirrorRef(pix, id);

      if (mirrorRef) {
        transaction.set(
          mirrorRef,
          data,
          { merge: true }
        );
      }
    });

    toast("PIX recusado");
    await loadEntries();
  } catch (error) {
    alert(
      error.message ||
      "Não foi possível recusar o PIX."
    );
  }
}
async function reopenPix(id) {
  try {
    await runTransaction(db, async transaction => {
      const pixRef = doc(db, "pixInformados", id);
      const snapshot = await transaction.get(pixRef);

      if (!snapshot.exists()) {
        throw new Error("O registro PIX não foi encontrado.");
      }

      const pix = snapshot.data();

      if (pix.status !== "recusado") {
        throw new Error(
          "Somente PIX recusados podem voltar para aguardando."
        );
      }

      const data = {
        status: "aguardando_confirmacao",
        rejectedAt: null,
        rejectedBy: null,
        updatedAt: serverTimestamp()
      };

      transaction.update(pixRef, data);

      const mirrorRef = pixMirrorRef(pix, id);

      if (mirrorRef) {
        transaction.set(
          mirrorRef,
          data,
          { merge: true }
        );
      }
    });

    toast("PIX voltou para aguardando");
    await loadEntries();
  } catch (error) {
    alert(
      error.message ||
      "Não foi possível reabrir o PIX."
    );
  }
}
function openPixConfiguration() {
  $("pixConfigModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  $("pixKey").focus();
}

function closePixConfiguration() {
  $("pixConfigModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}
function rawConfigFromForm() {
  return {
    keyType: $("pixKeyType").value,
    key: $("pixKey").value,
    holderName: $("pixHolderName").value,
    city: $("pixCity").value,
    description: $("pixDescription").value,
    active: $("pixActive").checked
  };
}

function updateKeyHelp() {
  const type = $("pixKeyType").value;
  const help = $("pixKeyHelp");
  const input = $("pixKey");

  const settings = {
    aleatoria: [
      "Cole a chave aleatória exatamente como foi fornecida pelo banco.",
      "Ex.: 123e4567-e89b-12d3-a456-426614174000"
    ],
    telefone: [
      "Informe o telefone com DDD. O sistema adiciona o código +55.",
      "Ex.: (69) 99999-9999"
    ],
    email: [
      "Informe o e-mail cadastrado como chave PIX.",
      "Ex.: casal@email.com"
    ],
    cpf: [
      "Informe os 11 números do CPF.",
      "Ex.: 000.000.000-00"
    ],
    cnpj: [
      "Informe os 14 números do CNPJ.",
      "Ex.: 00.000.000/0000-00"
    ]
  };

  const [message, placeholder] =
    settings[type] || settings.aleatoria;

  help.textContent = message;
  input.placeholder = placeholder;
}

function updateConfigurationStatus(configuration) {
  const status = $("pixConfigStatus");

  if (!configuration) {
    status.className = "status warn";
    status.textContent = "Não configurado";
    return;
  }

  status.className = configuration.active
    ? "status ok"
    : "status warn";

  status.textContent = configuration.active
    ? "Ativo no site"
    : "Salvo, mas desativado";
}

async function testConfiguration({
  showSuccess = true
} = {}) {
  const configuration = normalizePixConfig(
    rawConfigFromForm()
  );

  const payload = buildPixPayload({
    key: configuration.key,
    name: configuration.holderName,
    city: configuration.city,
    amount: 1,
    description: configuration.description,
    txid: "TESTEPIX"
  });

  if (!validatePixPayload(payload)) {
    throw new Error(
      "O código PIX gerado não passou na validação interna."
    );
  }

  renderQrToCanvas(
    $("pixConfigQrCanvas"),
    payload,
    {
      size: 230,
      margin: 4,
      level: "M"
    }
  );

  $("pixConfigPreviewText").className =
    "notice success";

  $("pixConfigPreviewText").innerHTML = `
    <strong>${esc(configuration.holderName)}</strong><br>
    ${esc(formatPixKey(
      configuration.keyType,
      configuration.key
    ))}<br>
    <small>QR Code de teste: ${money(1)}</small>
  `;

  if (showSuccess) {
    toast("Configuração PIX validada");
  }

  return configuration;
}

async function loadConfiguration() {
  try {
    const snapshot = await getDoc(
      doc(db, "configuracoes", "pixPublico")
    );

    if (!snapshot.exists()) {
      updateConfigurationStatus(null);
      return;
    }

    pixConfiguration = snapshot.data();

    $("pixKeyType").value =
      pixConfiguration.keyType || "aleatoria";

    $("pixKey").value = pixConfiguration.key || "";
    $("pixHolderName").value =
      pixConfiguration.holderName || "";
    $("pixCity").value = pixConfiguration.city || "";
    $("pixDescription").value =
      pixConfiguration.description ||
      "PRESENTE DE CASAMENTO";
    $("pixActive").checked =
      pixConfiguration.active === true;

    updateKeyHelp();
    updateConfigurationStatus(pixConfiguration);

    if (
      pixConfiguration.key &&
      pixConfiguration.holderName &&
      pixConfiguration.city
    ) {
      await testConfiguration({
        showSuccess: false
      });
    }
  } catch (error) {
    $("pixConfigMessage").className =
      "notice danger";

    $("pixConfigMessage").textContent =
      error.message ||
      "Não foi possível carregar a configuração PIX.";

    $("pixConfigMessage").classList.remove("hidden");
  }
}

bootstrapPage({
  permission: "pix",

  onReady: async () => {
    updateKeyHelp();

    $("pixKeyType").addEventListener(
      "change",
      updateKeyHelp
    );

    $("pixSearch").addEventListener(
      "input",
      renderTable
    );

    $("pixStatusFilter").addEventListener(
      "change",
      renderTable
    );

    $("reloadButton").addEventListener(
      "click",
      loadEntries
    );

    $("openPixConfigButton").addEventListener(
      "click",
      openPixConfiguration
    );

    document.querySelectorAll(
      "[data-close-pix-config]"
    ).forEach(button => {
      button.addEventListener(
        "click",
        closePixConfiguration
      );
    });

    $("pixConfigModal").addEventListener(
      "click",
      event => {
        if (event.target === $("pixConfigModal")) {
          closePixConfiguration();
        }
      }
    );

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          !$("pixConfigModal").classList.contains("hidden")
        ) {
          closePixConfiguration();
        }
      }
    );

    $("testPixConfigButton").addEventListener(
      "click",
      async () => {
        try {
          await testConfiguration();
        } catch (error) {
          $("pixConfigPreviewText").className =
            "notice danger";

          $("pixConfigPreviewText").textContent =
            error.message;
        }
      }
    );

    $("pixConfigForm").addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const button = $("savePixConfigButton");
        const message = $("pixConfigMessage");

        button.disabled = true;
        button.textContent = "Salvando...";
        message.classList.add("hidden");

        try {
          const configuration =
            await testConfiguration({
              showSuccess: false
            });

          await setDoc(
            doc(db, "configuracoes", "pixPublico"),
            {
              ...configuration,
              updatedAt: serverTimestamp(),
              updatedBy: currentUser.email
            },
            { merge: true }
          );

          pixConfiguration = configuration;
          updateConfigurationStatus(configuration);

          message.className = "notice success";
          message.textContent =
            "Configuração do PIX salva e validada.";
          message.classList.remove("hidden");

          toast("PIX salvo");
          closePixConfiguration();
        } catch (error) {
          message.className = "notice danger";
          message.textContent =
            error.message ||
            "Não foi possível salvar a configuração PIX.";
          message.classList.remove("hidden");
        } finally {
          button.disabled = false;
          button.textContent =
            "Salvar configuração do PIX";
        }
      }
    );

    await Promise.all([
      loadEntries(),
      loadConfiguration()
    ]);
  }
});
