import {
  bootstrapPage,
  db,
  $,
  esc,
  toast
} from "../admin-core.js";

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js";

async function load() {
  const area = $("tableArea");

  area.innerHTML =
    '<div class="loading">Carregando...</div>';

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "confirmacoes"),
        orderBy("updatedAt", "desc")
      )
    );

    area.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Responsável</th>
            <th>WhatsApp</th>
            <th>Cônjuge</th>
            <th>Filhos</th>
            <th>Adultos</th>
            <th>Crianças</th>
            <th>Total</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>

        <tbody>
          ${
            snapshot.docs.map(documentSnapshot => {
              const confirmation =
                documentSnapshot.data();

              const children =
                (confirmation.children || [])
                  .map(child =>
                    `${esc(child.name)} (${child.age})`
                  )
                  .join(", ") || "—";

              return `
                <tr>
                  <td>
                    <strong>
                      ${esc(confirmation.responsibleName)}
                    </strong>
                  </td>

                  <td>${esc(confirmation.whatsapp)}</td>
                  <td>${esc(confirmation.spouseName || "—")}</td>
                  <td>${children}</td>
                  <td>${confirmation.counts?.adults || 0}</td>
                  <td>${confirmation.counts?.children || 0}</td>
                  <td>${confirmation.counts?.total || 0}</td>

                  <td>
                    <span class="status ${
                      confirmation.status === "confirmada"
                        ? "ok"
                        : "bad"
                    }">
                      ${esc(confirmation.status)}
                    </span>
                  </td>

                  <td>
                    <button
                      class="btn btn-small ${
                        confirmation.status === "confirmada"
                          ? "btn-danger"
                          : "btn-primary"
                      }"
                      data-name="${esc(
                        confirmation.responsibleName
                      )}"
                      data-status="${esc(
                        confirmation.status
                      )}"
                      data-toggle="${esc(
                        documentSnapshot.id
                      )}"
                      type="button"
                    >
                      ${
                        confirmation.status === "confirmada"
                          ? "Cancelar"
                          : "Restaurar"
                      }
                    </button>
                  </td>
                </tr>
              `;
            }).join("") ||
            '<tr><td colspan="9">Nenhuma confirmação.</td></tr>'
          }
        </tbody>
      </table>
    `;

    area
      .querySelectorAll("[data-toggle]")
      .forEach(button => {
        button.addEventListener(
          "click",
          async () => {
            const previousStatus =
              button.dataset.status;

            const newStatus =
              previousStatus === "confirmada"
                ? "cancelada"
                : "confirmada";

            await updateDoc(
              doc(
                db,
                "confirmacoes",
                button.dataset.toggle
              ),
              {
                status: newStatus,
                updatedAt: serverTimestamp()
              }
            );

            await tryRecordAdminLog({
              module: "confirmacoes",
              action: "status_alterado",
              recordId:
                button.dataset.toggle,
              summary:
                `Confirmação de ${button.dataset.name || "convidado"} alterada para ${newStatus}.`,
              details: {
                previousStatus,
                newStatus
              }
            });

            toast("Confirmação atualizada");
            await load();
          }
        );
      });
  } catch (error) {
    area.innerHTML = `
      <div class="notice danger">
        ${esc(error.message)}
      </div>
    `;
  }
}

bootstrapPage({
  permission: "confirmacoes",

  onReady: async () => {
    await load();

    $("reloadButton")
      .addEventListener(
        "click",
        load
      );
  }
});
