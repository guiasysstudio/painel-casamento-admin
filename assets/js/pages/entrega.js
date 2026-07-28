import {
  bootstrapPage,
  db,
  $,
  toast
} from "../admin-core.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js";

async function load() {
  const snapshot = await getDoc(
    doc(
      db,
      "configuracoes",
      "entregaPublica"
    )
  );

  if (!snapshot.exists()) return;

  const delivery = snapshot.data();

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
  permission: "configuracoes",

  onReady: async () => {
    await load();

    $("deliveryForm").addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const data = {
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
              .trim(),
          active:
            $("deliveryActive").checked,
          updatedAt:
            serverTimestamp()
        };

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
          module: "configuracoes",
          action: "atualizado",
          recordId:
            "configuracoes/entregaPublica",
          summary:
            "Endereço público de entrega atualizado.",
          details: {
            city: data.city,
            state: data.state,
            active: data.active
          }
        });

        toast("Endereço salvo");
      }
    );
  }
});
