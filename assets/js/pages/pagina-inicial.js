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
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js";

function localInput(value) {
  if (!value) return "";

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  const pad = number =>
    String(number).padStart(2, "0");

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}`
  );
}

async function load() {
  const snapshot = await getDoc(
    doc(
      db,
      "configuracoes",
      "publico"
    )
  );

  if (!snapshot.exists()) return;

  const configuration = snapshot.data();

  $("siteName").value =
    configuration.siteName || "";
  $("pageTitle").value =
    configuration.pageTitle || "";
  $("introText").value =
    configuration.introText || "";
  $("weddingDate").value =
    localInput(configuration.weddingDate);
  $("confirmationDeadline").value =
    localInput(
      configuration.confirmationDeadline
    );
  $("venueName").value =
    configuration.venueName || "";
  $("venueAddress").value =
    configuration.venueAddress || "";
  $("mapsUrl").value =
    configuration.mapsUrl || "";
  $("childMaxAge").value =
    configuration.childMaxAge ?? 12;
  $("reservationHours").value =
    configuration.reservationHours ?? 24;
}

bootstrapPage({
  permission: "configuracoes",

  onReady: async () => {
    await load();

    $("siteConfigForm").addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const data = {
          siteName:
            $("siteName").value.trim(),
          pageTitle:
            $("pageTitle").value.trim(),
          introText:
            $("introText").value.trim(),
          weddingDate:
            Timestamp.fromDate(
              new Date(
                $("weddingDate").value
              )
            ),
          confirmationDeadline:
            Timestamp.fromDate(
              new Date(
                $("confirmationDeadline").value
              )
            ),
          venueName:
            $("venueName").value.trim(),
          venueAddress:
            $("venueAddress").value.trim(),
          mapsUrl:
            $("mapsUrl").value.trim(),
          childMaxAge:
            Number(
              $("childMaxAge").value
            ),
          reservationHours:
            Number(
              $("reservationHours").value
            ),
          updatedAt:
            serverTimestamp()
        };

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
          module: "configuracoes",
          action: "atualizado",
          recordId:
            "configuracoes/publico",
          summary:
            "Conteúdo e dados da página inicial atualizados.",
          details: {
            siteName: data.siteName,
            venueName: data.venueName,
            childMaxAge:
              data.childMaxAge,
            reservationHours:
              data.reservationHours
          }
        });

        toast("Página inicial salva");
      }
    );
  }
});
