import {
  bootstrapPage,
  db,
  $,
  hasSubPermission,
  toast
} from "../admin-core.js?v=3.2.0";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js?v=3.2.0";

const FIELD_GROUPS = Object.freeze({
  editContent: [
    "siteName",
    "pageTitle",
    "introText"
  ],

  editEvent: [
    "weddingDate",
    "venueName",
    "venueAddress",
    "mapsUrl"
  ],

  editDeadline: [
    "confirmationDeadline"
  ],

  editReservationRules: [
    "childMaxAge",
    "reservationHours"
  ]
});

function localInput(value) {
  if (!value) return "";

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  const pad = number =>
    String(number)
      .padStart(2, "0");

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}`
  );
}

function allowed(action) {
  return hasSubPermission(
    "paginaInicial",
    action
  );
}

function applyFormAccess() {
  Object.entries(
    FIELD_GROUPS
  ).forEach(([action, fieldIds]) => {
    const enabled =
      allowed(action);

    fieldIds.forEach(id => {
      const field = $(id);

      if (!field) return;

      field.disabled = !enabled;

      field
        .closest(".field")
        ?.setAttribute(
          "data-permission-blocked",
          enabled
            ? "false"
            : "true"
        );
    });
  });

  const hasAnyEdit =
    Object.keys(
      FIELD_GROUPS
    ).some(allowed);

  const submitButton =
    document.querySelector(
      '#siteConfigForm button[type="submit"]'
    );

  if (submitButton) {
    submitButton.disabled =
      !hasAnyEdit;
  }

  if (!hasAnyEdit) {
    $("siteConfigForm")
      .insertAdjacentHTML(
        "afterbegin",
        `
          <div class="notice info permission-restricted-note">
            Esta conta possui acesso somente para consulta.
          </div>
        `
      );
  }
}

async function load() {
  const snapshot =
    await getDoc(
      doc(
        db,
        "configuracoes",
        "publico"
      )
    );

  if (!snapshot.exists()) {
    return;
  }

  const configuration =
    snapshot.data();

  $("siteName").value =
    configuration.siteName || "";

  $("pageTitle").value =
    configuration.pageTitle || "";

  $("introText").value =
    configuration.introText || "";

  $("weddingDate").value =
    localInput(
      configuration.weddingDate
    );

  $("confirmationDeadline").value =
    localInput(
      configuration
        .confirmationDeadline
    );

  $("venueName").value =
    configuration.venueName || "";

  $("venueAddress").value =
    configuration.venueAddress || "";

  $("mapsUrl").value =
    configuration.mapsUrl || "";

  $("childMaxAge").value =
    configuration.childMaxAge ??
    12;

  $("reservationHours").value =
    configuration
      .reservationHours ??
    24;
}

function buildAllowedPayload() {
  const data = {};

  if (allowed("editContent")) {
    data.siteName =
      $("siteName").value.trim();

    data.pageTitle =
      $("pageTitle")
        .value
        .trim();

    data.introText =
      $("introText")
        .value
        .trim();
  }

  if (allowed("editEvent")) {
    data.weddingDate =
      Timestamp.fromDate(
        new Date(
          $("weddingDate").value
        )
      );

    data.venueName =
      $("venueName")
        .value
        .trim();

    data.venueAddress =
      $("venueAddress")
        .value
        .trim();

    data.mapsUrl =
      $("mapsUrl")
        .value
        .trim();
  }

  if (allowed("editDeadline")) {
    data.confirmationDeadline =
      Timestamp.fromDate(
        new Date(
          $("confirmationDeadline")
            .value
        )
      );
  }

  if (
    allowed(
      "editReservationRules"
    )
  ) {
    data.childMaxAge =
      Number(
        $("childMaxAge").value
      );

    data.reservationHours =
      Number(
        $("reservationHours")
          .value
      );
  }

  return data;
}

bootstrapPage({
  permission: "paginaInicial",

  onReady: async () => {
    await load();
    applyFormAccess();

    $("siteConfigForm")
      .addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          const data =
            buildAllowedPayload();

          if (
            !Object.keys(data).length
          ) {
            return;
          }

          data.updatedAt =
            serverTimestamp();

          await setDoc(
            doc(
              db,
              "configuracoes",
              "publico"
            ),
            data,
            {
              merge: true
            }
          );

          await tryRecordAdminLog({
            module:
              "configuracoes",
            action: "atualizado",
            recordId:
              "configuracoes/publico",
            summary:
              "Dados autorizados da página inicial foram atualizados.",
            details: {
              changedGroups:
                Object.keys(
                  FIELD_GROUPS
                ).filter(allowed)
            }
          });

          toast(
            "Página inicial salva"
          );
        }
      );
  }
});
