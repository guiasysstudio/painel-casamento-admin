import {
  bootstrapPage,
  db,
  $,
  esc,
  toast,
  currentUser,
  hasSubPermission
} from "../admin-core.js?v=3.2.0";

import {
  Bytes,
  collection,
  doc,
  GeoPoint,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  FIREBASE_CONFIG
} from "../firebase-config.js";

import {
  recordAdminLog,
  tryRecordAdminLog
} from "../audit-log.js?v=3.3.0";

import {
  normalizeAutomaticBackupUrl,
  runAutomaticBackupNow
} from "../automatic-backup-service.js?v=3.2.0";

const PAGE_SIZE = 100;
const RESTORE_BATCH_SIZE = 400;
const BACKUP_SIGNATURE =
  "site-casamento-firestore-backup";

const AUTOMATIC_BACKUP_CONFIG = Object.freeze({
  documentPath: [
    "configuracoes",
    "backupAutomatico"
  ],
  folderId:
    "1iO68sB-4SFlZ87GWhlHBmE4i3TfC6D8n",
  folderUrl:
    "https://drive.google.com/drive/folders/1iO68sB-4SFlZ87GWhlHBmE4i3TfC6D8n",
  scheduleTime: "03:30",
  timezone: "America/Porto_Velho",
  retentionCount: 30
});

const PROTECTED_MASTER_PATH =
  "administradores/lindolfoandrew0@gmail.com";

const PROTECTED_AUTOMATIC_BACKUP_PATH =
  "configuracoes/backupAutomatico";

const MODULE_LABELS = Object.freeze({
  sistema: "Sistema",
  configuracoes: "Configurações",
  confirmacoes: "Confirmações",
  presentes: "Presentes",
  reservas: "Reservas",
  pix: "PIX",
  administradores: "Administradores",
  exportacoes: "Exportações",
  logs: "Logs e backup"
});

const ACTION_LABELS = Object.freeze({
  inicializacao: "Inicialização",
  criado: "Criado",
  atualizado: "Atualizado",
  excluido: "Excluído",
  status_alterado: "Status alterado",
  compra_confirmada: "Compra confirmada",
  reserva_liberada: "Reserva liberada",
  pix_confirmado: "PIX confirmado",
  pix_desconfirmado: "PIX desconfirmado",
  pix_recusado: "PIX recusado",
  pix_reaberto: "PIX reaberto",
  comprovante_enviado:
    "Comprovante enviado",
  comprovante_visualizado:
    "Comprovante visualizado",
  comprovante_acesso_negado:
    "Acesso ao comprovante negado",
  comprovantes_migrados:
    "Comprovantes migrados",
  backup_gerado: "Backup gerado",
  backup_restaurado: "Backup restaurado",
  backup_automatico_configurado:
    "Backup automático configurado",
  backup_automatico_concluido:
    "Backup automático concluído",
  backup_automatico_erro:
    "Erro no backup automático",
  permissoes_migradas:
    "Permissões migradas",
  logs_exportados: "Logs exportados",
  logs_limpos: "Logs limpos",
  arquivo_exportado: "Arquivo exportado"
});

const BACKUP_LABELS = Object.freeze({
  configuracoes: "Configurações",
  presentes: "Presentes",
  confirmacoes: "Confirmações",
  reservas: "Reservas e perfis",
  pix: "PIX e perfis",
  administradores: "Administradores",
  logs: "Logs administrativos",
  outros: "Outros documentos"
});

let loadedLogs = [];
let lastLogDocument = null;
let hasMoreLogs = false;
let masterAccess = false;
let loadedBackup = null;

let automaticBackupProgressTimer = null;
let automaticBackupProgressUnsubscribe = null;
let automaticBackupProgressHideTimer = null;
let automaticBackupDisplayedPercent = 0;

function showMessage(
  elementId,
  message,
  type = "danger"
) {
  const element = $(elementId);

  element.className = `notice ${type}`;
  element.textContent = message;
  element.classList.remove("hidden");
}

function hideMessage(elementId) {
  const element = $(elementId);

  element.textContent = "";
  element.classList.add("hidden");
}

function logMilliseconds(log) {
  if (log.createdAt?.toMillis) {
    return log.createdAt.toMillis();
  }

  if (log.createdAt?.toDate) {
    return log.createdAt.toDate().getTime();
  }

  const parsed = Date.parse(
    log.clientCreatedAt || ""
  );

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function formatDateTime(log) {
  const milliseconds = logMilliseconds(log);

  if (!milliseconds) {
    return {
      date: "Data indisponível",
      time: ""
    };
  }

  const date = new Date(milliseconds);

  return {
    date: new Intl.DateTimeFormat(
      "pt-BR",
      {
        dateStyle: "short"
      }
    ).format(date),

    time: new Intl.DateTimeFormat(
      "pt-BR",
      {
        timeStyle: "medium"
      }
    ).format(date)
  };
}

function moduleLabel(value) {
  return MODULE_LABELS[value] || value || "Outro";
}

function actionLabel(value) {
  return ACTION_LABELS[value] ||
    String(value || "Ação")
      .replaceAll("_", " ");
}

function escapeCsv(value) {
  const text = String(value ?? "");

  return `"${text.replaceAll('"', '""')}"`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(
    () => URL.revokeObjectURL(url),
    1500
  );
}

function normalizedSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function startOfDate(value) {
  if (!value) return 0;

  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime())
    ? 0
    : date.getTime();
}

function endOfDate(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;

  const date = new Date(`${value}T23:59:59.999`);

  return Number.isNaN(date.getTime())
    ? Number.MAX_SAFE_INTEGER
    : date.getTime();
}

function filteredLogs() {
  const search = normalizedSearch(
    $("logsSearch").value
  );

  const moduleValue =
    $("logsModuleFilter").value;

  const actionValue =
    $("logsActionFilter").value;

  const adminValue =
    $("logsAdminFilter").value;

  const start = startOfDate(
    $("logsStartDate").value
  );

  const end = endOfDate(
    $("logsEndDate").value
  );

  return loadedLogs.filter(log => {
    const timestamp = logMilliseconds(log);

    if (
      moduleValue &&
      log.module !== moduleValue
    ) {
      return false;
    }

    if (
      actionValue &&
      log.action !== actionValue
    ) {
      return false;
    }

    if (
      adminValue &&
      log.adminEmail !== adminValue
    ) {
      return false;
    }

    if (
      timestamp < start ||
      timestamp > end
    ) {
      return false;
    }

    if (!search) return true;

    const searchableValues = [
      log.adminName,
      log.adminEmail,
      moduleLabel(log.module),
      actionLabel(log.action),
      log.summary,
      log.recordId
    ];

    if (
      hasSubPermission(
        "logs",
        "viewDetails"
      )
    ) {
      searchableValues.push(
        JSON.stringify(
          log.details || {}
        )
      );
    }

    const searchable =
      normalizedSearch(
        searchableValues.join(" ")
      );

    return searchable.includes(search);
  });
}

function updateFilterOptions() {
  const selectValues = {
    modules: $("logsModuleFilter").value,
    actions: $("logsActionFilter").value,
    admins: $("logsAdminFilter").value
  };

  const modules = [
    ...new Set(
      loadedLogs
        .map(log => log.module)
        .filter(Boolean)
    )
  ].sort((a, b) =>
    moduleLabel(a).localeCompare(
      moduleLabel(b),
      "pt-BR"
    )
  );

  const actions = [
    ...new Set(
      loadedLogs
        .map(log => log.action)
        .filter(Boolean)
    )
  ].sort((a, b) =>
    actionLabel(a).localeCompare(
      actionLabel(b),
      "pt-BR"
    )
  );

  const admins = [
    ...new Map(
      loadedLogs
        .filter(log => log.adminEmail)
        .map(log => [
          log.adminEmail,
          log.adminName || log.adminEmail
        ])
    ).entries()
  ].sort((a, b) =>
    a[1].localeCompare(b[1], "pt-BR")
  );

  $("logsModuleFilter").innerHTML = `
    <option value="">Todos os módulos</option>
    ${modules.map(value => `
      <option value="${esc(value)}">
        ${esc(moduleLabel(value))}
      </option>
    `).join("")}
  `;

  $("logsActionFilter").innerHTML = `
    <option value="">Todas as ações</option>
    ${actions.map(value => `
      <option value="${esc(value)}">
        ${esc(actionLabel(value))}
      </option>
    `).join("")}
  `;

  $("logsAdminFilter").innerHTML = `
    <option value="">Todos os administradores</option>
    ${admins.map(([email, name]) => `
      <option value="${esc(email)}">
        ${esc(name)} — ${esc(email)}
      </option>
    `).join("")}
  `;

  $("logsModuleFilter").value =
    selectValues.modules;

  $("logsActionFilter").value =
    selectValues.actions;

  $("logsAdminFilter").value =
    selectValues.admins;
}

function updateStatistics(entries) {
  const today = new Date();

  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();

  $("logsLoadedCount").textContent =
    String(loadedLogs.length);

  $("logsTodayCount").textContent =
    String(
      loadedLogs.filter(
        log => logMilliseconds(log) >= todayStart
      ).length
    );

  $("logsFilteredCount").textContent =
    String(entries.length);
}

function renderLogs() {
  const entries = filteredLogs();
  const area = $("logsTableArea");

  const canViewDetails =
    hasSubPermission(
      "logs",
      "viewDetails"
    );

  updateStatistics(entries);

  if (!entries.length) {
    area.innerHTML = `
      <div class="empty-state">
        Nenhum log corresponde aos filtros selecionados.
      </div>
    `;
    return;
  }

  area.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Administrador</th>
          <th>Módulo</th>
          <th>Ação</th>
          <th>Descrição</th>
          <th>Registro</th>
        </tr>
      </thead>

      <tbody>
        ${entries.map(log => {
          const date = formatDateTime(log);
          const details = JSON.stringify(
            log.details || {},
            null,
            2
          );

          return `
            <tr>
              <td>
                <div class="log-date">
                  <strong>${esc(date.date)}</strong>
                  <small>${esc(date.time)}</small>
                </div>
              </td>

              <td>
                <div class="log-admin">
                  <strong>
                    ${esc(
                      log.adminName ||
                      "Administrador"
                    )}
                  </strong>

                  <small>
                    ${esc(log.adminEmail || "—")}
                  </small>
                </div>
              </td>

              <td>
                <span class="log-module-chip">
                  ${esc(moduleLabel(log.module))}
                </span>
              </td>

              <td>
                <span class="log-action-chip">
                  ${esc(actionLabel(log.action))}
                </span>
              </td>

              <td>
                <div class="log-summary">
                  <strong>
                    ${esc(log.summary || "Ação registrada")}
                  </strong>

                  ${
                    canViewDetails &&
                    details !== "{}"
                      ? `
                        <details>
                          <summary>Ver detalhes</summary>
                          <pre class="log-details-data">${esc(details)}</pre>
                        </details>
                      `
                      : (
                          details !== "{}"
                            ? `
                              <small class="log-record-id">
                                Detalhes restritos
                              </small>
                            `
                            : ""
                        )
                  }
                </div>
              </td>

              <td>
                <span class="log-record-id">
                  ${esc(log.recordId || "—")}
                </span>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function loadLogs({
  reset = true
} = {}) {
  const button = reset
    ? $("reloadLogsButton")
    : $("loadMoreLogsButton");

  button.disabled = true;

  if (reset) {
    $("logsTableArea").innerHTML = `
      <div class="loading">
        Carregando histórico...
      </div>
    `;

    loadedLogs = [];
    lastLogDocument = null;
    hasMoreLogs = false;
  }

  hideMessage("logsMessage");

  try {
    const constraints = [
      orderBy("createdAt", "desc")
    ];

    if (lastLogDocument) {
      constraints.push(
        startAfter(lastLogDocument)
      );
    }

    constraints.push(limit(PAGE_SIZE));

    const snapshot = await getDocs(
      query(
        collection(db, "logs"),
        ...constraints
      )
    );

    const newEntries = snapshot.docs.map(
      documentSnapshot => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data()
      })
    );

    loadedLogs = reset
      ? newEntries
      : [...loadedLogs, ...newEntries];

    lastLogDocument =
      snapshot.docs.at(-1) ||
      lastLogDocument;

    hasMoreLogs =
      snapshot.size === PAGE_SIZE;

    $("loadMoreLogsButton").classList.toggle(
      "hidden",
      !hasMoreLogs
    );

    updateFilterOptions();
    renderLogs();
  } catch (error) {
    showMessage(
      "logsMessage",
      error.message ||
      "Não foi possível carregar os logs."
    );

    if (!loadedLogs.length) {
      $("logsTableArea").innerHTML = `
        <div class="empty-state">
          O histórico não pôde ser carregado.
        </div>
      `;
    }
  } finally {
    button.disabled = false;
  }
}

async function exportLogs() {
  if (
    !hasSubPermission(
      "logs",
      "exportLogs"
    )
  ) {
    showMessage(
      "logsMessage",
      "Esta conta não pode exportar os logs.",
      "warning"
    );
    return;
  }

  const canViewDetails =
    hasSubPermission(
      "logs",
      "viewDetails"
    );

  const entries = filteredLogs();

  if (!entries.length) {
    showMessage(
      "logsMessage",
      "Não existem registros para exportar.",
      "warning"
    );
    return;
  }

  const header = [
    "Data",
    "Hora",
    "Administrador",
    "E-mail",
    "Perfil",
    "Módulo",
    "Ação",
    "Descrição",
    "Registro",
    "Detalhes"
  ];

  const rows = entries.map(log => {
    const date = formatDateTime(log);

    return [
      date.date,
      date.time,
      log.adminName || "",
      log.adminEmail || "",
      log.adminRole || "",
      moduleLabel(log.module),
      actionLabel(log.action),
      log.summary || "",
      log.recordId || "",
      canViewDetails
        ? JSON.stringify(
            log.details || {}
          )
        : ""
    ];
  });

  const csv = [
    header,
    ...rows
  ].map(row =>
    row.map(escapeCsv).join(";")
  ).join("\r\n");

  const now = new Date();
  const fileName =
    `logs-administrativos-${
      now.toISOString().slice(0, 10)
    }.csv`;

  downloadBlob(
    new Blob(
      ["\uFEFF", csv],
      {
        type:
          "text/csv;charset=utf-8"
      }
    ),
    fileName
  );

  await tryRecordAdminLog({
    module: "logs",
    action: "logs_exportados",
    summary:
      `${entries.length} logs exportados em CSV.`,
    details: {
      quantity: entries.length
    }
  });

  toast("Logs exportados");
}

async function clearAllLogs() {
  if (
    !masterAccess ||
    !hasSubPermission(
      "logs",
      "clearLogs"
    )
  ) {
    return;
  }

  const accepted = confirm(
    "Excluir todos os logs administrativos?\n\n" +
    "Esta ação não poderá ser desfeita. " +
    "Gere um backup antes de continuar."
  );

  if (!accepted) return;

  const confirmationText = prompt(
    "Digite LIMPAR LOGS para confirmar:"
  );

  if (
    String(confirmationText || "")
      .trim()
      .toUpperCase() !== "LIMPAR LOGS"
  ) {
    return;
  }

  const button = $("clearLogsButton");
  button.disabled = true;

  try {
    let deleted = 0;

    while (true) {
      const snapshot = await getDocs(
        query(
          collection(db, "logs"),
          limit(RESTORE_BATCH_SIZE)
        )
      );

      if (snapshot.empty) break;

      const batch = writeBatch(db);

      snapshot.docs.forEach(documentSnapshot => {
        batch.delete(documentSnapshot.ref);
      });

      await batch.commit();
      deleted += snapshot.size;
    }

    await recordAdminLog({
      module: "logs",
      action: "logs_limpos",
      summary:
        `${deleted} logs anteriores foram excluídos.`,
      details: {
        deleted
      }
    });

    toast("Logs limpos");
    await loadLogs();
  } catch (error) {
    showMessage(
      "logsMessage",
      error.message ||
      "Não foi possível limpar os logs."
    );
  } finally {
    button.disabled = false;
  }
}

function selectedBackupModules() {
  return [
    ...document.querySelectorAll(
      "[data-backup-module]:checked"
    )
  ].map(input => input.dataset.backupModule);
}

function serializeValue(value) {
  if (value instanceof Timestamp) {
    return {
      __firestoreType: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds
    };
  }

  if (value instanceof Date) {
    return {
      __firestoreType: "date",
      value: value.toISOString()
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.entries(value).map(
        ([key, item]) => [
          key,
          serializeValue(item)
        ]
      )
    );
  }

  return value;
}

function deserializeValue(value) {
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    if (
      value.__firestoreType ===
      "timestamp"
    ) {
      return new Timestamp(
        Number(value.seconds),
        Number(value.nanoseconds || 0)
      );
    }

    if (
      value.__firestoreType === "date"
    ) {
      return new Date(value.value);
    }

    if (
      value.__firestoreType === "integer"
    ) {
      const integer = Number(value.value);

      if (!Number.isSafeInteger(integer)) {
        throw new Error(
          "O backup possui um número inteiro fora do limite seguro do navegador."
        );
      }

      return integer;
    }

    if (
      value.__firestoreType === "bytes"
    ) {
      return Bytes.fromBase64String(
        String(value.value || "")
      );
    }

    if (
      value.__firestoreType === "geopoint"
    ) {
      return new GeoPoint(
        Number(value.latitude),
        Number(value.longitude)
      );
    }

    if (
      value.__firestoreType === "reference"
    ) {
      const marker = "/documents/";
      const referenceValue = String(
        value.value || ""
      );
      const index = referenceValue.indexOf(
        marker
      );

      if (index < 0) {
        throw new Error(
          "O backup possui uma referência de documento inválida."
        );
      }

      return doc(
        db,
        ...referenceValue
          .slice(index + marker.length)
          .split("/")
          .filter(Boolean)
      );
    }

    return Object.fromEntries(
      Object.entries(value).map(
        ([key, item]) => [
          key,
          deserializeValue(item)
        ]
      )
    );
  }

  return value;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(
    value
  );

  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return [
    ...new Uint8Array(hash)
  ].map(byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function collectCollection(
  collectionSegments,
  moduleId,
  records
) {
  const snapshot = await getDocs(
    collection(db, ...collectionSegments)
  );

  snapshot.docs.forEach(documentSnapshot => {
    records.push({
      module: moduleId,
      path: documentSnapshot.ref.path,
      data: serializeValue(
        documentSnapshot.data()
      )
    });
  });

  return snapshot.docs;
}

async function collectBackupModule(
  moduleId,
  records
) {
  if (moduleId === "configuracoes") {
    await collectCollection(
      ["configuracoes"],
      moduleId,
      records
    );
    return;
  }

  if (moduleId === "presentes") {
    await collectCollection(
      ["presentes"],
      moduleId,
      records
    );
    return;
  }

  if (moduleId === "confirmacoes") {
    await collectCollection(
      ["confirmacoes"],
      moduleId,
      records
    );
    return;
  }

  if (moduleId === "reservas") {
    await collectCollection(
      ["reservas"],
      moduleId,
      records
    );

    const profiles = await collectCollection(
      ["perfisReservas"],
      moduleId,
      records
    );

    for (const profile of profiles) {
      await collectCollection(
        [
          "perfisReservas",
          profile.id,
          "reservas"
        ],
        moduleId,
        records
      );
    }

    return;
  }

  if (moduleId === "pix") {
    await collectCollection(
      ["pixInformados"],
      moduleId,
      records
    );

    await collectCollection(
      ["comprovantesPix"],
      moduleId,
      records
    );

    const profiles = await collectCollection(
      ["perfisPix"],
      moduleId,
      records
    );

    for (const profile of profiles) {
      await collectCollection(
        [
          "perfisPix",
          profile.id,
          "pix"
        ],
        moduleId,
        records
      );
    }

    return;
  }

  if (moduleId === "administradores") {
    await collectCollection(
      ["administradores"],
      moduleId,
      records
    );
    return;
  }

  if (moduleId === "logs") {
    await collectCollection(
      ["logs"],
      moduleId,
      records
    );
  }
}

function updateProgress(
  elementId,
  textElementId,
  message,
  visible
) {
  const element = $(elementId);
  const textElement = $(textElementId);

  textElement.textContent = message;
  element.classList.toggle(
    "hidden",
    !visible
  );
}

async function createCompressedBackupBlob(
  text
) {
  if (
    "CompressionStream" in window
  ) {
    const stream = new Blob([text])
      .stream()
      .pipeThrough(
        new CompressionStream("gzip")
      );

    const buffer = await new Response(
      stream
    ).arrayBuffer();

    return {
      blob: new Blob(
        [buffer],
        {
          type: "application/gzip"
        }
      ),
      extension: "json.gz"
    };
  }

  return {
    blob: new Blob(
      [text],
      {
        type:
          "application/json;charset=utf-8"
      }
    ),
    extension: "json"
  };
}

async function generateBackup() {
  if (!masterAccess) return;

  const modules = selectedBackupModules();

  if (!modules.length) {
    showMessage(
      "backupMessage",
      "Selecione pelo menos um módulo.",
      "warning"
    );
    return;
  }

  const button =
    $("generateBackupButton");

  button.disabled = true;
  hideMessage("backupMessage");

  updateProgress(
    "backupProgress",
    "backupProgressText",
    "Preparando backup...",
    true
  );

  try {
    const records = [];

    for (
      let index = 0;
      index < modules.length;
      index += 1
    ) {
      const moduleId = modules[index];

      updateProgress(
        "backupProgress",
        "backupProgressText",
        `Lendo ${BACKUP_LABELS[moduleId]} (${index + 1}/${modules.length})...`,
        true
      );

      await collectBackupModule(
        moduleId,
        records
      );
    }

    records.sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    const counts = Object.fromEntries(
      modules.map(moduleId => [
        moduleId,
        records.filter(
          record =>
            record.module === moduleId
        ).length
      ])
    );

    const documentsDigest = await sha256(
      JSON.stringify(records)
    );

    const backup = {
      signature: BACKUP_SIGNATURE,
      schemaVersion: 1,
      projectId:
        FIREBASE_CONFIG.projectId,
      createdAt:
        new Date().toISOString(),
      selectedModules: modules,
      counts,
      integrity: {
        algorithm: "SHA-256",
        documents: documentsDigest
      },
      documents: records
    };

    const text = JSON.stringify(
      backup,
      null,
      2
    );

    const {
      blob,
      extension
    } = await createCompressedBackupBlob(
      text
    );

    const now = new Date();
    const datePart = now
      .toISOString()
      .replaceAll(":", "-")
      .slice(0, 19);

    downloadBlob(
      blob,
      `backup-casamento-${datePart}.${extension}`
    );

    await tryRecordAdminLog({
      module: "logs",
      action: "backup_gerado",
      summary:
        `Backup gerado com ${records.length} documentos.`,
      details: {
        modules,
        counts,
        documents: records.length,
        compressed:
          extension.endsWith(".gz")
      }
    });

    showMessage(
      "backupMessage",
      `Backup concluído: ${records.length} documentos incluídos.`,
      "success"
    );

    toast("Backup gerado");
  } catch (error) {
    showMessage(
      "backupMessage",
      error.message ||
      "Não foi possível gerar o backup."
    );
  } finally {
    button.disabled = false;

    updateProgress(
      "backupProgress",
      "backupProgressText",
      "",
      false
    );
  }
}

async function readBackupFile(file) {
  if (
    file.size > 80 * 1024 * 1024
  ) {
    throw new Error(
      "O arquivo de backup ultrapassa o limite de 80 MB."
    );
  }

  if (/\.gz$/i.test(file.name)) {
    if (
      !("DecompressionStream" in window)
    ) {
      throw new Error(
        "Este navegador não consegue abrir arquivos GZIP. Use Chrome ou Edge atualizado."
      );
    }

    const stream = file
      .stream()
      .pipeThrough(
        new DecompressionStream("gzip")
      );

    return new Response(stream).text();
  }

  return file.text();
}

function backupModuleCounts(backup) {
  return Object.fromEntries(
    Object.keys(BACKUP_LABELS).map(
      moduleId => [
        moduleId,
        backup.documents.filter(
          record =>
            record.module === moduleId
        ).length
      ]
    )
  );
}

async function validateBackup(backup) {
  if (
    !backup ||
    backup.signature !==
      BACKUP_SIGNATURE
  ) {
    throw new Error(
      "Este arquivo não foi gerado pelo módulo de backup do site."
    );
  }

  if (
    backup.schemaVersion !== 1 ||
    !Array.isArray(backup.documents)
  ) {
    throw new Error(
      "Versão de backup incompatível."
    );
  }

  if (
    backup.projectId !==
      FIREBASE_CONFIG.projectId
  ) {
    throw new Error(
      "Este backup pertence a outro projeto Firebase."
    );
  }

  for (const record of backup.documents) {
    const segments = String(
      record.path || ""
    ).split("/").filter(Boolean);

    if (
      !record.module ||
      segments.length < 2 ||
      segments.length % 2 !== 0 ||
      !record.data ||
      typeof record.data !== "object"
    ) {
      throw new Error(
        "O arquivo possui um documento inválido."
      );
    }
  }

  if (
    backup.integrity?.documents
  ) {
    const calculated = await sha256(
      JSON.stringify(backup.documents)
    );

    if (
      calculated !==
      backup.integrity.documents
    ) {
      throw new Error(
        "A verificação de integridade do backup falhou."
      );
    }
  }

  return backup;
}

function renderRestoreBackup(backup) {
  const counts =
    backupModuleCounts(backup);

  const availableModules =
    Object.entries(counts)
      .filter(
        ([moduleId, count]) =>
          count > 0 &&
          moduleId !== "logs"
      );

  $("restoreBackupSummary").innerHTML = `
    <strong>
      ${backup.documents.length} documentos encontrados
    </strong>

    <small>
      Criado em ${
        new Date(
          backup.createdAt
        ).toLocaleString("pt-BR")
      }
    </small>

    <div class="backup-module-summary">
      ${Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(
          ([moduleId, count]) => `
            <span>
              ${esc(BACKUP_LABELS[moduleId])}: ${count}
              ${
                moduleId === "logs"
                  ? " — somente arquivo"
                  : ""
              }
            </span>
          `
        ).join("")}
    </div>
  `;

  $("restoreBackupSummary")
    .classList.remove("hidden");

  $("restoreSelection").innerHTML =
    availableModules.map(
      ([moduleId, count]) => `
        <label class="checkbox-row">
          <input
            checked
            data-restore-module="${esc(moduleId)}"
            type="checkbox"
          >
          ${esc(BACKUP_LABELS[moduleId])}
          (${count})
        </label>
      `
    ).join("");

  $("restoreSelection")
    .classList.remove("hidden");

  $("restoreConfirmationField")
    .classList.remove("hidden");

  $("restoreConfirmation").value = "";
  $("restoreBackupButton").disabled = true;
}

async function handleBackupFile(event) {
  hideMessage("restoreMessage");

  const file =
    event.target.files?.[0];

  loadedBackup = null;

  $("restoreBackupSummary")
    .classList.add("hidden");

  $("restoreSelection")
    .classList.add("hidden");

  $("restoreConfirmationField")
    .classList.add("hidden");

  $("restoreBackupButton").disabled = true;

  if (!file) return;

  try {
    updateProgress(
      "restoreProgress",
      "restoreProgressText",
      "Lendo arquivo de backup...",
      true
    );

    const text = await readBackupFile(file);
    const parsed = JSON.parse(text);

    loadedBackup = await validateBackup(
      parsed
    );

    renderRestoreBackup(
      loadedBackup
    );

    showMessage(
      "restoreMessage",
      "Backup validado. Selecione os módulos e confirme a restauração.",
      "success"
    );
  } catch (error) {
    event.target.value = "";

    showMessage(
      "restoreMessage",
      error.message ||
      "Não foi possível abrir o backup."
    );
  } finally {
    updateProgress(
      "restoreProgress",
      "restoreProgressText",
      "",
      false
    );
  }
}

function selectedRestoreModules() {
  return [
    ...document.querySelectorAll(
      "[data-restore-module]:checked"
    )
  ].map(input =>
    input.dataset.restoreModule
  );
}

async function restoreBackup() {
  if (
    !masterAccess ||
    !loadedBackup
  ) {
    return;
  }

  const confirmation =
    $("restoreConfirmation")
      .value
      .trim()
      .toUpperCase();

  if (confirmation !== "RESTAURAR") {
    showMessage(
      "restoreMessage",
      "Digite RESTAURAR para confirmar.",
      "warning"
    );
    return;
  }

  const modules =
    selectedRestoreModules();

  if (!modules.length) {
    showMessage(
      "restoreMessage",
      "Selecione pelo menos um módulo.",
      "warning"
    );
    return;
  }

  const records = loadedBackup.documents
    .filter(record =>
      modules.includes(record.module) &&
      record.module !== "logs" &&
      record.path !== PROTECTED_MASTER_PATH &&
      record.path !==
        PROTECTED_AUTOMATIC_BACKUP_PATH
    )
    .sort((a, b) => {
      const depthDifference =
        a.path.split("/").length -
        b.path.split("/").length;

      return depthDifference ||
        a.path.localeCompare(b.path);
    });

  const accepted = confirm(
    `Restaurar ${records.length} documentos?\n\n` +
    "Documentos com o mesmo caminho serão substituídos. " +
    "Outros documentos existentes não serão apagados."
  );

  if (!accepted) return;

  const button =
    $("restoreBackupButton");

  button.disabled = true;
  hideMessage("restoreMessage");

  try {
    let restored = 0;

    for (
      let offset = 0;
      offset < records.length;
      offset += RESTORE_BATCH_SIZE
    ) {
      const chunk = records.slice(
        offset,
        offset + RESTORE_BATCH_SIZE
      );

      const batch = writeBatch(db);

      chunk.forEach(record => {
        const reference = doc(
          db,
          ...record.path
            .split("/")
            .filter(Boolean)
        );

        batch.set(
          reference,
          deserializeValue(record.data)
        );
      });

      await batch.commit();
      restored += chunk.length;

      updateProgress(
        "restoreProgress",
        "restoreProgressText",
        `Restaurando documentos: ${restored}/${records.length}`,
        true
      );
    }

    await tryRecordAdminLog({
      module: "logs",
      action: "backup_restaurado",
      summary:
        `${restored} documentos restaurados por mesclagem.`,
      details: {
        modules,
        restored,
        backupCreatedAt:
          loadedBackup.createdAt
      }
    });

    showMessage(
      "restoreMessage",
      `Restauração concluída: ${restored} documentos processados.`,
      "success"
    );

    $("restoreConfirmation").value = "";
    toast("Backup restaurado");
    await loadLogs();
  } catch (error) {
    showMessage(
      "restoreMessage",
      error.message ||
      "Não foi possível restaurar o backup."
    );
  } finally {
    button.disabled = false;

    updateProgress(
      "restoreProgress",
      "restoreProgressText",
      "",
      false
    );
  }
}



function clampAutomaticBackupPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, Math.round(number))
  );
}

function estimatedAutomaticBackupMessage(
  percent
) {
  if (percent < 8) {
    return "Iniciando backup...";
  }

  if (percent < 20) {
    return "Validando acesso ao Firestore e ao Google Drive...";
  }

  if (percent < 60) {
    return "Lendo os documentos do Firestore...";
  }

  if (percent < 76) {
    return "Organizando os dados do backup...";
  }

  if (percent < 88) {
    return "Compactando o arquivo...";
  }

  if (percent < 96) {
    return "Enviando o backup ao Google Drive...";
  }

  return "Finalizando e aplicando a retenção...";
}

function renderAutomaticBackupProgress({
  percent,
  message,
  state = "running",
  visible = true
}) {
  const container = $(
    "autoBackupProgress"
  );

  const bar = $(
    "autoBackupProgressBar"
  );

  const fill = $(
    "autoBackupProgressFill"
  );

  const text = $(
    "autoBackupProgressText"
  );

  const percentText = $(
    "autoBackupProgressPercent"
  );

  const normalizedPercent =
    clampAutomaticBackupPercent(
      percent
    );

  automaticBackupDisplayedPercent =
    normalizedPercent;

  container.classList.toggle(
    "hidden",
    !visible
  );

  container.classList.toggle(
    "is-success",
    state === "success"
  );

  container.classList.toggle(
    "is-error",
    state === "error"
  );

  text.textContent =
    message ||
    estimatedAutomaticBackupMessage(
      normalizedPercent
    );

  percentText.textContent =
    `${normalizedPercent}%`;

  bar.setAttribute(
    "aria-valuenow",
    String(normalizedPercent)
  );

  fill.style.width =
    `${normalizedPercent}%`;
}

function stopAutomaticBackupProgressTracking() {
  if (automaticBackupProgressTimer) {
    window.clearInterval(
      automaticBackupProgressTimer
    );

    automaticBackupProgressTimer =
      null;
  }

  if (
    automaticBackupProgressUnsubscribe
  ) {
    automaticBackupProgressUnsubscribe();
    automaticBackupProgressUnsubscribe =
      null;
  }

  if (automaticBackupProgressHideTimer) {
    window.clearTimeout(
      automaticBackupProgressHideTimer
    );

    automaticBackupProgressHideTimer =
      null;
  }
}

function startAutomaticBackupProgressTracking() {
  stopAutomaticBackupProgressTracking();

  renderAutomaticBackupProgress({
    percent: 0,
    message: "Iniciando backup...",
    state: "running",
    visible: true
  });

  automaticBackupProgressUnsubscribe =
    onSnapshot(
      automaticBackupReference(),
      snapshot => {
        if (!snapshot.exists()) return;

        const data = snapshot.data();
        const status = String(
          data.lastStatus || ""
        );

        const reportedPercent =
          clampAutomaticBackupPercent(
            data.progressPercent
          );

        const reportedMessage =
          String(
            data.progressMessage || ""
          ).trim();

        if (status === "running") {
          renderAutomaticBackupProgress({
            percent: Math.max(
              automaticBackupDisplayedPercent,
              reportedPercent
            ),
            message:
              reportedMessage ||
              estimatedAutomaticBackupMessage(
                reportedPercent
              ),
            state: "running",
            visible: true
          });
        }
      },
      error => {
        console.warn(
          "Não foi possível acompanhar o progresso em tempo real.",
          error
        );
      }
    );

  automaticBackupProgressTimer =
    window.setInterval(
      () => {
        if (
          automaticBackupDisplayedPercent >=
          94
        ) {
          return;
        }

        let increment = 1;

        if (
          automaticBackupDisplayedPercent <
          25
        ) {
          increment = 4;
        } else if (
          automaticBackupDisplayedPercent <
          55
        ) {
          increment = 2;
        }

        const nextPercent = Math.min(
          94,
          automaticBackupDisplayedPercent +
          increment
        );

        renderAutomaticBackupProgress({
          percent: nextPercent,
          message:
            estimatedAutomaticBackupMessage(
              nextPercent
            ),
          state: "running",
          visible: true
        });
      },
      900
    );
}

function finishAutomaticBackupProgress({
  success,
  message
}) {
  stopAutomaticBackupProgressTracking();

  renderAutomaticBackupProgress({
    percent: success
      ? 100
      : automaticBackupDisplayedPercent,
    message:
      message ||
      (
        success
          ? "Backup concluído e salvo no Google Drive."
          : "O backup não foi concluído."
      ),
    state: success
      ? "success"
      : "error",
    visible: true
  });

  automaticBackupProgressHideTimer =
    window.setTimeout(
      () => {
        $("autoBackupProgress")
          .classList.add("hidden");

        automaticBackupProgressHideTimer =
          null;
      },
      success ? 1800 : 3200
    );
}


function automaticBackupReference() {
  return doc(
    db,
    ...AUTOMATIC_BACKUP_CONFIG.documentPath
  );
}

function timestampDate(value) {
  if (!value) return null;

  if (value?.toDate) {
    return value.toDate();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function formatAutomaticBackupDate(value) {
  const date = timestampDate(value);

  if (!date) return "—";

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle: "short",
      timeStyle: "medium"
    }
  ).format(date);
}

function formatAutomaticBackupBytes(value) {
  const bytes = Number(value || 0);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }

  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(2)} MB`;
}

function automaticBackupStatusLabel(status) {
  return ({
    running: "Executando agora",
    success: "Funcionando",
    error: "Erro na última execução"
  })[status] || "Aguardando instalação";
}

function renderAutomaticBackupStatus(data = {}) {
  const status = String(
    data.lastStatus || ""
  );

  const badge = $(
    "autoBackupStatusBadge"
  );

  badge.textContent =
    automaticBackupStatusLabel(status);

  badge.className =
    `automatic-backup-status-badge ${
      status || "pending"
    }`;

  $("autoBackupLastSuccess").textContent =
    formatAutomaticBackupDate(
      data.lastSuccessAt
    );

  $("autoBackupDocuments").textContent =
    Number.isFinite(
      Number(data.lastDocumentCount)
    )
      ? String(
          Number(data.lastDocumentCount)
        )
      : "—";

  $("autoBackupFileSize").textContent =
    formatAutomaticBackupBytes(
      data.lastFileSize
    );

  $("autoBackupSchedule").textContent =
    `Diariamente por volta de ${
      data.scheduleTime ||
      AUTOMATIC_BACKUP_CONFIG.scheduleTime
    }`;

  $("autoBackupRetention").textContent =
    `${
      Number(data.retentionCount) ||
      AUTOMATIC_BACKUP_CONFIG.retentionCount
    } arquivos automáticos`;

  const fileLink = $(
    "autoBackupLastFileLink"
  );

  if (data.lastFileUrl) {
    fileLink.href = data.lastFileUrl;
    fileLink.target = "_blank";
    fileLink.rel = "noopener";
    fileLink.textContent =
      data.lastFileName ||
      "Abrir último backup";
    fileLink.classList.remove(
      "is-disabled"
    );
  } else {
    fileLink.href = "#";
    fileLink.removeAttribute("target");
    fileLink.removeAttribute("rel");
    fileLink.textContent =
      "Nenhum backup registrado";
    fileLink.classList.add(
      "is-disabled"
    );
  }

  const errorBox = $(
    "autoBackupLastErrorBox"
  );

  if (
    status === "error" &&
    data.lastError
  ) {
    errorBox.textContent =
      `Último erro: ${data.lastError}`;
    errorBox.classList.remove("hidden");
  } else {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }

  const urlInput = $(
    "autoBackupAppsScriptUrl"
  );

  if (
    data.appsScriptUrl &&
    !urlInput.value
  ) {
    urlInput.value = data.appsScriptUrl;
  }

  $("runAutoBackupNowButton").disabled =
    !String(urlInput.value || "").trim();
}

async function loadAutomaticBackupStatus() {
  if (!masterAccess) return;

  const button = $(
    "reloadAutoBackupStatusButton"
  );

  button.disabled = true;
  hideMessage("autoBackupMessage");

  try {
    const snapshot = await getDoc(
      automaticBackupReference()
    );

    renderAutomaticBackupStatus(
      snapshot.exists()
        ? snapshot.data()
        : {}
    );
  } catch (error) {
    showMessage(
      "autoBackupMessage",
      error.message ||
      "Não foi possível consultar o status do backup automático."
    );
  } finally {
    button.disabled = false;
  }
}

async function saveAutomaticBackupUrl() {
  if (!masterAccess) return;

  const button = $(
    "saveAutoBackupUrlButton"
  );

  button.disabled = true;
  hideMessage("autoBackupMessage");

  try {
    const appsScriptUrl =
      normalizeAutomaticBackupUrl(
        $("autoBackupAppsScriptUrl").value
      );

    if (!appsScriptUrl) {
      throw new Error(
        "Informe a URL da implantação do Google Apps Script."
      );
    }

    await setDoc(
      automaticBackupReference(),
      {
        appsScriptUrl,
        folderId:
          AUTOMATIC_BACKUP_CONFIG.folderId,
        folderUrl:
          AUTOMATIC_BACKUP_CONFIG.folderUrl,
        scheduleTime:
          AUTOMATIC_BACKUP_CONFIG.scheduleTime,
        timezone:
          AUTOMATIC_BACKUP_CONFIG.timezone,
        retentionCount:
          AUTOMATIC_BACKUP_CONFIG.retentionCount,
        updatedAt: serverTimestamp()
      },
      {
        merge: true
      }
    );

    await tryRecordAdminLog({
      module: "logs",
      action:
        "backup_automatico_configurado",
      recordId:
        "configuracoes/backupAutomatico",
      summary:
        "URL do serviço de backup automático configurada.",
      details: {
        folderId:
          AUTOMATIC_BACKUP_CONFIG.folderId,
        scheduleTime:
          AUTOMATIC_BACKUP_CONFIG.scheduleTime,
        timezone:
          AUTOMATIC_BACKUP_CONFIG.timezone,
        retentionCount:
          AUTOMATIC_BACKUP_CONFIG.retentionCount
      }
    });

    $("autoBackupAppsScriptUrl").value =
      appsScriptUrl;

    $("runAutoBackupNowButton").disabled =
      false;

    showMessage(
      "autoBackupMessage",
      "URL salva. O botão Executar backup agora está liberado.",
      "success"
    );

    toast("Serviço de backup salvo");
  } catch (error) {
    showMessage(
      "autoBackupMessage",
      error.message ||
      "Não foi possível salvar a URL."
    );
  } finally {
    button.disabled = false;
  }
}

async function executeAutomaticBackupNow() {
  if (!masterAccess) return;

  const button = $(
    "runAutoBackupNowButton"
  );

  button.disabled = true;
  hideMessage("autoBackupMessage");

  startAutomaticBackupProgressTracking();

  try {
    const endpoint =
      normalizeAutomaticBackupUrl(
        $("autoBackupAppsScriptUrl").value
      );

    if (!currentUser) {
      throw new Error(
        "A sessão administrativa não está disponível."
      );
    }

    const idToken = await currentUser
      .getIdToken(true);

    const result = await runAutomaticBackupNow({
      endpoint,
      idToken
    });

    finishAutomaticBackupProgress({
      success: true,
      message:
        `Backup concluído: ${
          Number(result.documentCount || 0)
        } documentos salvos no Google Drive.`
    });

    showMessage(
      "autoBackupMessage",
      `Backup concluído: ${
        Number(result.documentCount || 0)
      } documentos enviados ao Google Drive.`,
      "success"
    );

    toast("Backup automático concluído");

    await Promise.all([
      loadAutomaticBackupStatus(),
      loadLogs()
    ]);
  } catch (error) {
    const message =
      error.message ||
      "Não foi possível executar o backup agora.";

    finishAutomaticBackupProgress({
      success: false,
      message
    });

    showMessage(
      "autoBackupMessage",
      message
    );
  } finally {
    button.disabled =
      !String(
        $("autoBackupAppsScriptUrl").value ||
        ""
      ).trim();
  }
}

function bindFilters() {
  [
    "logsSearch",
    "logsModuleFilter",
    "logsActionFilter",
    "logsAdminFilter",
    "logsStartDate",
    "logsEndDate"
  ].forEach(id => {
    $(id).addEventListener(
      id === "logsSearch"
        ? "input"
        : "change",
      renderLogs
    );
  });
}

bootstrapPage({
  permission: "logs",

  onReady: async ({ admin }) => {
    masterAccess =
      admin.role === "master";

    const canExportLogs =
      hasSubPermission(
        "logs",
        "exportLogs"
      );

    $("exportLogsButton")
      .classList.toggle(
        "hidden",
        !canExportLogs
      );

    if (
      masterAccess &&
      hasSubPermission(
        "logs",
        "clearLogs"
      )
    ) {
      $("clearLogsButton")
        .classList.remove("hidden");
    } else {
      $("clearLogsButton")?.remove();
    }

    if (!masterAccess) {
      $("automaticBackupMasterSection")?.remove();
      $("backupMasterSection")?.remove();
    }

    bindFilters();

    $("reloadLogsButton")
      .addEventListener(
        "click",
        () => loadLogs()
      );

    $("loadMoreLogsButton")
      .addEventListener(
        "click",
        () => loadLogs({
          reset: false
        })
      );

    $("exportLogsButton")
      .addEventListener(
        "click",
        exportLogs
      );

    $("clearLogsButton")
      .addEventListener(
        "click",
        clearAllLogs
      );

    if (masterAccess) {
      $("reloadAutoBackupStatusButton")
        .addEventListener(
          "click",
          loadAutomaticBackupStatus
        );

      $("saveAutoBackupUrlButton")
        .addEventListener(
          "click",
          saveAutomaticBackupUrl
        );

      $("runAutoBackupNowButton")
        .addEventListener(
          "click",
          executeAutomaticBackupNow
        );

      $("autoBackupAppsScriptUrl")
        .addEventListener(
          "input",
          () => {
            $("runAutoBackupNowButton").disabled =
              !String(
                $("autoBackupAppsScriptUrl").value ||
                ""
              ).trim();
          }
        );

      $("autoBackupLastFileLink")
        .addEventListener(
          "click",
          event => {
            if (
              event.currentTarget.classList
                .contains("is-disabled")
            ) {
              event.preventDefault();
            }
          }
        );

      $("generateBackupButton")
        .addEventListener(
          "click",
          generateBackup
        );

      $("restoreBackupFile")
        .addEventListener(
          "change",
          handleBackupFile
        );

      $("restoreConfirmation")
        .addEventListener(
          "input",
          () => {
            $("restoreBackupButton").disabled =
              $("restoreConfirmation")
                .value
                .trim()
                .toUpperCase() !==
              "RESTAURAR";
          }
        );

      $("restoreBackupButton")
        .addEventListener(
          "click",
          restoreBackup
        );
    }

    if (masterAccess) {
      await Promise.all([
        loadLogs(),
        loadAutomaticBackupStatus()
      ]);
    } else {
      await loadLogs();
    }
  }
});
