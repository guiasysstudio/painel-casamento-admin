import {
  bootstrapPage,
  db,
  $,
  esc,
  hasSubPermission,
  toast
} from "../admin-core.js?v=3.2.0";
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js?v=3.2.0";

function effectiveStatus(reservation) {
  const expiration = reservation.expiresAt?.toDate?.();

  if (
    reservation.status === "reservado" &&
    expiration &&
    expiration.getTime() <= Date.now()
  ) {
    return "expirada";
  }

  return reservation.status;
}

function statusLabel(status) {
  return ({
    reservado: "Reservado",
    expirada: "Expirada",
    compra_informada: "Compra informada",
    compra_confirmada: "Compra confirmada",
    cancelada: "Cancelada pelo convidado",
    cancelada_admin: "Liberada pelo ADM"
  })[status] || String(status || "").replaceAll("_", " ");
}

function deliveryLabel(value) {
  return value === "casal"
    ? "Entrega no endereço do casal"
    : value === "convidado"
      ? "Entrega pessoal"
      : "Não informado";
}


function whatsappNumber(value) {
  const number = String(value || "").replace(/\D/g, "");

  if (
    (number.length === 12 || number.length === 13) &&
    number.startsWith("55")
  ) {
    return number;
  }

  if (number.length === 10 || number.length === 11) {
    return `55${number}`;
  }

  return "";
}

function whatsappMessage(reservation) {
  const guestName =
    String(reservation.guestName || "Olá").trim();

  const giftName =
    String(reservation.giftName || "presente").trim();

  const firstName =
    guestName.split(/\s+/).filter(Boolean)[0] || "Olá";

  return (
    `Olá, ${firstName}! ` +
    `Muito obrigado pelo carinho e por escolher o presente ` +
    `“${giftName}” para o nosso casamento. ` +
    `Ficamos muito felizes com sua lembrança! ` +
    `Com carinho, Mislaine e Emerson. 🤎`
  );
}

function whatsappUrl(reservation) {
  const number = whatsappNumber(reservation.whatsapp);

  if (!number) return "";

  return (
    `https://wa.me/${number}` +
    `?text=${encodeURIComponent(whatsappMessage(reservation))}`
  );
}

async function load() {
  const area = $("tableArea");
  area.innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "reservas"),
        orderBy("createdAt", "desc")
      )
    );

    const canViewContacts =
      hasSubPermission(
        "reservas",
        "viewContacts"
      );

    const canConfirmPurchase =
      hasSubPermission(
        "reservas",
        "confirmPurchase"
      );

    const canReleaseReservation =
      hasSubPermission(
        "reservas",
        "release"
      );

    const canUseWhatsapp =
      canViewContacts &&
      hasSubPermission(
        "reservas",
        "useWhatsapp"
      );

    area.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Convidado</th>
            <th>Presente</th>
            <th>Entrega</th>
            <th>Validade</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>

        <tbody>
          ${
            snapshot.docs.map(documentSnapshot => {
              const reservation = documentSnapshot.data();
              const status = effectiveStatus(reservation);
              const canConfirm =
                status === "reservado" ||
                status === "compra_informada";
              const canRelease = [
                "reservado",
                "compra_informada",
                "expirada"
              ].includes(status);

              const guestWhatsappUrl =
                whatsappUrl(reservation);

              return `
                <tr>
                  <td>
                    ${esc(reservation.guestName)}
                    <br>
                    ${
                      canViewContacts
                        ? `
                          <small>
                            ${esc(reservation.whatsapp)}
                          </small>
                        `
                        : `
                          <small>
                            Contato restrito
                          </small>
                        `
                    }
                  </td>

                  <td>${esc(reservation.giftName)}</td>

                  <td>
                    ${esc(deliveryLabel(reservation.deliveryChoice))}
                  </td>

                  <td>
                    ${
                      reservation.expiresAt
                        ?.toDate?.()
                        .toLocaleString("pt-BR") || "—"
                    }
                  </td>

                  <td>
                    <span class="status ${
                      status === "compra_confirmada" ||
                      status === "compra_informada"
                        ? "ok"
                        : ["reservado", "expirada"].includes(status)
                          ? "warn"
                          : ""
                    }">
                      ${esc(statusLabel(status))}
                    </span>
                  </td>

                  <td>
                    <div class="table-actions">
                      ${
                        canUseWhatsapp &&
                        status === "compra_confirmada" &&
                        guestWhatsappUrl
                          ? `
                            <a
                              class="btn btn-small btn-whatsapp btn-icon-only"
                              href="${esc(guestWhatsappUrl)}"
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Agradecer no WhatsApp para ${esc(reservation.guestName)}"
                              aria-label="Agradecer no WhatsApp para ${esc(reservation.guestName)}"
                            >
                              <span class="ui-icon icon-whatsapp" aria-hidden="true"></span>
                            </a>
                          `
                          : ""
                      }

                      ${
                        canConfirmPurchase &&
                        canConfirm
                          ? `
                            <button
                              class="btn btn-small btn-primary"
                              data-confirm="${documentSnapshot.id}"
                            >
                              Confirmar compra
                            </button>
                          `
                          : ""
                      }

                      ${
                        canReleaseReservation &&
                        canRelease
                          ? `
                            <button
                              class="btn btn-small btn-danger"
                              data-release="${documentSnapshot.id}"
                            >
                              Liberar presente
                            </button>
                          `
                          : ""
                      }
                    </div>
                  </td>
                </tr>
              `;
            }).join("") ||
            '<tr><td colspan="6">Nenhuma reserva.</td></tr>'
          }
        </tbody>
      </table>
    `;

    area.querySelectorAll("[data-confirm]").forEach(button => {
      button.addEventListener("click", () => {
        confirmPurchase(button.dataset.confirm);
      });
    });

    area.querySelectorAll("[data-release]").forEach(button => {
      button.addEventListener("click", () => {
        release(button.dataset.release);
      });
    });
  } catch (error) {
    area.innerHTML =
      `<div class="notice danger">${esc(error.message)}</div>`;
  }
}

async function confirmPurchase(id) {
  if (
    !hasSubPermission(
      "reservas",
      "confirmPurchase"
    )
  ) {
    alert(
      "Esta conta não pode confirmar compras."
    );
    return;
  }

  if (
    !confirm(
      "Confirmar que este presente foi comprado? Ele deixará de aparecer no site público."
    )
  ) {
    return;
  }

  try {
    let loggedReservation = null;

    await runTransaction(db, async transaction => {
      const reservationRef = doc(db, "reservas", id);
      const reservationSnapshot =
        await transaction.get(reservationRef);

      if (!reservationSnapshot.exists()) {
        throw new Error("Reserva não encontrada.");
      }

      const reservation = reservationSnapshot.data();
      loggedReservation = reservation;

      const giftRef = doc(
        db,
        "presentes",
        reservation.giftId
      );
      const giftSnapshot =
        await transaction.get(giftRef);

      let profileReservationRef = null;
      let profileReservationSnapshot = null;

      if (reservation.profileId) {
        profileReservationRef = doc(
          db,
          "perfisReservas",
          reservation.profileId,
          "reservas",
          id
        );

        profileReservationSnapshot =
          await transaction.get(profileReservationRef);
      }

      if (!giftSnapshot.exists()) {
        throw new Error("Presente não encontrado.");
      }

      const now = serverTimestamp();

      transaction.update(reservationRef, {
        status: "compra_confirmada",
        confirmedAt: now,
        updatedAt: now
      });

      if (profileReservationSnapshot?.exists()) {
        transaction.update(profileReservationRef, {
          status: "compra_confirmada",
          confirmedAt: now,
          updatedAt: now
        });
      }

      transaction.update(giftRef, {
        purchaseStatus: "comprado",
        visivelPublico: false,
        reservationId: null,
        reservationProfileId: null,
        reservedByUid: null,
        reservationExpiresAt: null,
        updatedAt: now
      });
    });

    await tryRecordAdminLog({
      module: "reservas",
      action: "compra_confirmada",
      recordId: id,
      summary:
        `Compra do presente “${loggedReservation?.giftName || "presente"}” confirmada.`,
      details: {
        guestName:
          loggedReservation?.guestName || "",
        giftId:
          loggedReservation?.giftId || "",
        giftName:
          loggedReservation?.giftName || ""
      }
    });

    toast("Compra confirmada");
    await load();
  } catch (error) {
    alert(error.message);
  }
}

async function release(id) {
  if (
    !hasSubPermission(
      "reservas",
      "release"
    )
  ) {
    alert(
      "Esta conta não pode liberar reservas."
    );
    return;
  }

  if (
    !confirm(
      "Liberar este presente novamente na lista pública?"
    )
  ) {
    return;
  }

  try {
    let loggedReservation = null;

    await runTransaction(db, async transaction => {
      const reservationRef = doc(db, "reservas", id);
      const reservationSnapshot =
        await transaction.get(reservationRef);

      if (!reservationSnapshot.exists()) {
        throw new Error("Reserva não encontrada.");
      }

      const reservation = reservationSnapshot.data();
      loggedReservation = reservation;

      const giftRef = doc(
        db,
        "presentes",
        reservation.giftId
      );
      const giftSnapshot =
        await transaction.get(giftRef);

      let profileReservationRef = null;
      let profileReservationSnapshot = null;

      if (reservation.profileId) {
        profileReservationRef = doc(
          db,
          "perfisReservas",
          reservation.profileId,
          "reservas",
          id
        );

        profileReservationSnapshot =
          await transaction.get(profileReservationRef);
      }

      const now = serverTimestamp();

      if (
        giftSnapshot.exists() &&
        giftSnapshot.data().reservationId === id
      ) {
        transaction.update(giftRef, {
          purchaseStatus: "disponivel",
          reservationId: null,
          reservationProfileId: null,
          reservedByUid: null,
          reservationExpiresAt: null,
          updatedAt: now
        });
      }

      transaction.update(reservationRef, {
        status: "cancelada_admin",
        updatedAt: now
      });

      if (profileReservationSnapshot?.exists()) {
        transaction.update(profileReservationRef, {
          status: "cancelada_admin",
          updatedAt: now
        });
      }
    });

    await tryRecordAdminLog({
      module: "reservas",
      action: "reserva_liberada",
      recordId: id,
      summary:
        `Reserva do presente “${loggedReservation?.giftName || "presente"}” liberada pelo ADM.`,
      details: {
        guestName:
          loggedReservation?.guestName || "",
        giftId:
          loggedReservation?.giftId || "",
        giftName:
          loggedReservation?.giftName || ""
      }
    });

    toast("Presente liberado");
    await load();
  } catch (error) {
    alert(error.message);
  }
}

bootstrapPage({
  permission: "reservas",
  onReady: async () => {
    await load();
    $("reloadButton").addEventListener("click", load);
    setInterval(load, 60000);
  }
});
