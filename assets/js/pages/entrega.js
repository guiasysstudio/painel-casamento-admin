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
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js?v=3.2.0";

const ADDRESS_FIELDS = [
  "deliveryRecipient",
  "deliveryPhone",
  "deliveryZip",
  "deliveryStreet",
  "deliveryNumber",
  "deliveryComplement",
  "deliveryNeighborhood",
  "deliveryCity",
  "deliveryState",
  "deliveryReference"
];

function applyAccess() {
  const canEditAddress =
    hasSubPermission(
      "entrega",
      "editAddress"
    );

  const canToggle =
    hasSubPermission(
      "entrega",
      "togglePublic"
    );

  ADDRESS_FIELDS.forEach(id => {
    const field = $(id);

    field.disabled =
      !canEditAddress;

    field
      .closest(".field")
      ?.setAttribute(
        "data-permission-blocked",
        canEditAddress
          ? "false"
          : "true"
      );
  });

  $("deliveryActive").disabled =
    !canToggle;

  const submit =
    document.querySelector(
      '#deliveryForm button[type="submit"]'
    );

  if (submit) {
    submit.disabled =
      !canEditAddress &&
      !canToggle;
  }

  if (
    !canEditAddress &&
    !canToggle
  ) {
    $("deliveryForm")
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
        "entregaPublica"
      )
    );

  if (!snapshot.exists()) {
    return;
  }

  const delivery =
    snapshot.data();

  $("deliveryRecipient").value =
    delivery.recipient || "";

  $("deliveryPhone").value =
    delivery.phone || "";

  $("deliveryZip").value =
    delivery.zipCode || "";

  $("deliveryStreet").value =
    delivery.street || "";

  $("deliveryNumber").value =
    delivery.number || "";

  $("deliveryComplement").value =
    delivery.complement || "";

  $("deliveryNeighborhood").value =
    delivery.neighborhood || "";

  $("deliveryCity").value =
    delivery.city || "";

  $("deliveryState").value =
    delivery.state || "";

  $("deliveryReference").value =
    delivery.reference || "";

  $("deliveryActive").checked =
    delivery.active === true;
}

bootstrapPage({
  permission: "entrega",

  onReady: async () => {
    await load();
    applyAccess();

    $("deliveryForm")
      .addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          const data = {};

          if (
            hasSubPermission(
              "entrega",
              "editAddress"
            )
          ) {
            Object.assign(data, {
              recipient:
                $("deliveryRecipient")
                  .value
                  .trim(),

              phone:
                $("deliveryPhone")
                  .value
                  .trim(),

              zipCode:
                $("deliveryZip")
                  .value
                  .trim(),

              street:
                $("deliveryStreet")
                  .value
                  .trim(),

              number:
                $("deliveryNumber")
                  .value
                  .trim(),

              complement:
                $("deliveryComplement")
                  .value
                  .trim(),

              neighborhood:
                $("deliveryNeighborhood")
                  .value
                  .trim(),

              city:
                $("deliveryCity")
                  .value
                  .trim(),

              state:
                $("deliveryState")
                  .value
                  .trim()
                  .toUpperCase(),

              reference:
                $("deliveryReference")
                  .value
                  .trim()
            });
          }

          if (
            hasSubPermission(
              "entrega",
              "togglePublic"
            )
          ) {
            data.active =
              $("deliveryActive")
                .checked;
          }

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
              "entregaPublica"
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
              "configuracoes/entregaPublica",
            summary:
              "Dados autorizados do endereço de entrega foram atualizados.",
            details: {
              addressEdited:
                hasSubPermission(
                  "entrega",
                  "editAddress"
                ),

              publicStatusEdited:
                hasSubPermission(
                  "entrega",
                  "togglePublic"
                )
            }
          });

          toast(
            "Endereço salvo"
          );
        }
      );
  }
});
