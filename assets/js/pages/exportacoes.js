import {
  bootstrapPage,
  db,
  $,
  toast
} from "../admin-core.js";

import {
  collection,
  getDocs,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js";

bootstrapPage({
  permission: "exportacoes",

  onReady: async () => {
    $("exportButton").addEventListener(
      "click",
      async () => {
        const message = $("exportMessage");

        try {
          if (!window.XLSX) {
            throw new Error(
              "A biblioteca de exportação não carregou. Verifique a internet."
            );
          }

          const selected = new Set(
            [
              ...document.querySelectorAll(
                "#exportOptions input:checked"
              )
            ].map(input => input.value)
          );

          if (!selected.size) {
            throw new Error(
              "Selecione pelo menos uma opção."
            );
          }

          const snapshot = await getDocs(
            query(
              collection(db, "confirmacoes"),
              where("status", "==", "confirmada"),
              orderBy("responsibleName")
            )
          );

          const items = snapshot.docs.map(
            documentSnapshot =>
              documentSnapshot.data()
          );

          const workbook =
            XLSX.utils.book_new();

          const totals = {
            adultos: items.reduce(
              (sum, item) =>
                sum +
                (item.counts?.adults || 0),
              0
            ),
            criancas: items.reduce(
              (sum, item) =>
                sum +
                (item.counts?.children || 0),
              0
            ),
            geral: items.reduce(
              (sum, item) =>
                sum +
                (item.counts?.total || 0),
              0
            )
          };

          if (
            selected.has("adultos") ||
            selected.has("criancas") ||
            selected.has("geral")
          ) {
            const rows = [];

            if (selected.has("adultos")) {
              rows.push({
                Indicador: "Total de adultos",
                Quantidade: totals.adultos
              });
            }

            if (selected.has("criancas")) {
              rows.push({
                Indicador: "Total de crianças",
                Quantidade: totals.criancas
              });
            }

            if (selected.has("geral")) {
              rows.push({
                Indicador: "Total geral",
                Quantidade: totals.geral
              });
            }

            XLSX.utils.book_append_sheet(
              workbook,
              XLSX.utils.json_to_sheet(rows),
              "Resumo"
            );
          }

          if (selected.has("familias")) {
            const rows = items.map(item => ({
              Responsável:
                item.responsibleName,
              WhatsApp:
                item.whatsapp,
              Cônjuge:
                item.spouseName || "",
              Filhos:
                (item.children || [])
                  .map(child =>
                    `${child.name} (${child.age})`
                  )
                  .join(", "),
              Adultos:
                item.counts?.adults || 0,
              Crianças:
                item.counts?.children || 0,
              Total:
                item.counts?.total || 0
            }));

            XLSX.utils.book_append_sheet(
              workbook,
              XLSX.utils.json_to_sheet(rows),
              "Famílias"
            );
          }

          if (selected.has("pessoas")) {
            const rows = [];

            items.forEach(item => {
              rows.push({
                Nome: item.responsibleName,
                Família: item.responsibleName,
                Vínculo: "Responsável",
                Idade: "",
                Classificação: "Adulto"
              });

              if (item.spouseName) {
                rows.push({
                  Nome: item.spouseName,
                  Família: item.responsibleName,
                  Vínculo:
                    "Cônjuge/Acompanhante",
                  Idade: "",
                  Classificação: "Adulto"
                });
              }

              (item.children || [])
                .forEach(child => {
                  rows.push({
                    Nome: child.name,
                    Família:
                      item.responsibleName,
                    Vínculo: "Filho(a)",
                    Idade: child.age,
                    Classificação:
                      Number(child.age) <= 12
                        ? "Criança"
                        : "Adulto"
                  });
                });
            });

            XLSX.utils.book_append_sheet(
              workbook,
              XLSX.utils.json_to_sheet(rows),
              "Lista completa"
            );
          }

          const fileName =
            "confirmacoes-mislaine-emerson.xlsx";

          XLSX.writeFile(
            workbook,
            fileName
          );

          await tryRecordAdminLog({
            module: "exportacoes",
            action: "arquivo_exportado",
            recordId: fileName,
            summary:
              "Relatório de confirmações exportado em Excel.",
            details: {
              options: [...selected],
              families: items.length,
              totals
            }
          });

          toast("Arquivo Excel gerado");
          message.classList.add("hidden");
        } catch (error) {
          message.className =
            "notice danger";
          message.textContent =
            error.message;
          message.classList.remove("hidden");
        }
      }
    );
  }
});
