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
  limit,
  orderBy,
  query,
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
} from "../audit-log.js";

const PAGE_SIZE = 100;
const RESTORE_BATCH_SIZE = 400;
const BACKUP_SIGNATURE =
  "site-casamento-firestore-backup";

const PROTECTED_MASTER_PATH =
  "administradores/lindolfoandrew0@gmail.com";

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
  backup_gerado: "Backup gerado",
  backup_restaurado: "Backup restaurado",
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
  logs: "Logs administrativos"
});

let loadedLogs = [];
let lastLogDocument = null;
let hasMoreLogs = false;
let masterAccess = false;
let loadedBackup = null;

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

    const searchable = normalizedSearch([
      log.adminName,
      log.adminEmail,
      moduleLabel(log.module),
      actionLabel(log.action),
      log.summary,
      log.recordId,
      JSON.stringify(log.details || {})
    ].join(" "));

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
                    details !== "{}"
                      ? `
                        <details>
                          <summary>Ver detalhes</summary>
                          <pre class="log-details-data">${esc(details)}</pre>
                        </details>
                      `
                      : ""
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
      JSON.stringify(log.details || {})
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
  if (!masterAccess) return;

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
      record.path !== PROTECTED_MASTER_PATH
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

    if (masterAccess) {
      $("clearLogsButton")
        .classList.remove("hidden");
    } else {
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

    await loadLogs();
  }
});
