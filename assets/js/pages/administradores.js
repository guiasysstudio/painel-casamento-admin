import {
  bootstrapPage,
  db,
  $,
  esc,
  emailId,
  MASTER_EMAIL,
  PERMISSION_SCHEMA,
  normalizePermissionState,
  hasSubPermission,
  toast
} from "../admin-core.js?v=3.2.0";

import {
  PERMISSION_VERSION,
  PERMISSION_KEYS,
  storagePermissionState
} from "../permission-schema.js?v=3.2.0";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  tryRecordAdminLog
} from "../audit-log.js?v=3.2.0";

let currentUser = null;
let currentSessionAdmin = null;
let administrators = new Map();

function roleLabel(role) {
  return role === "master"
    ? "Master"
    : "Administrador";
}

function showMessage(
  elementId,
  message,
  type = "danger"
) {
  const element = $(elementId);

  element.className =
    `notice ${type}`;

  element.textContent = message;
  element.classList.remove("hidden");
}

function hideMessage(elementId) {
  const element = $(elementId);

  element.textContent = "";
  element.classList.add("hidden");
}

function gridState(gridId, role) {
  const master = role === "master";
  const permissions = {};
  const subpermissions = {};

  PERMISSION_KEYS.forEach(permission => {
    const accessInput =
      document.querySelector(
        `#${gridId} [data-page-access="${permission}"]`
      );

    const access =
      master ||
      accessInput?.checked === true;

    permissions[permission] = access;
    subpermissions[permission] = {};

    Object.entries(
      PERMISSION_SCHEMA[
        permission
      ].actions || {}
    ).forEach(([action, definition]) => {
      const actionInput =
        document.querySelector(
          `#${gridId} [data-subpermission="${permission}.${action}"]`
        );

      subpermissions[permission][action] =
        master
          ? true
          : (
              definition.masterOnly === true
                ? false
                : (
                    access &&
                    actionInput?.checked === true
                  )
            );
    });
  });

  return storagePermissionState({
    role,
    permissions,
    subpermissions
  });
}

function syncModuleState(
  moduleCard,
  role
) {
  const master =
    role === "master";

  const accessInput =
    moduleCard.querySelector(
      "[data-page-access]"
    );

  const access =
    master ||
    accessInput.checked;

  accessInput.disabled = master;

  moduleCard.classList.toggle(
    "is-disabled",
    !access
  );

  moduleCard
    .querySelectorAll(
      "[data-subpermission]"
    )
    .forEach(input => {
      const masterOnly =
        input.dataset.masterOnly ===
        "true";

      if (master) {
        input.checked = true;
        input.disabled = true;
        return;
      }

      if (masterOnly) {
        input.checked = false;
        input.disabled = true;
        return;
      }

      input.disabled = !access;
    });
}

function syncPermissionGrid(
  gridId,
  role
) {
  const grid = $(gridId);

  grid
    .querySelectorAll(
      ".permission-module-card"
    )
    .forEach(card => {
      syncModuleState(
        card,
        role
      );
    });
}

function renderPermissionGrid(
  gridId,
  {
    role = "admin",
    admin = null,
    defaultsEnabled = true
  } = {}
) {
  const grid = $(gridId);

  const normalized = admin
    ? normalizePermissionState(admin)
    : null;

  grid.innerHTML =
    PERMISSION_KEYS.map(permission => {
      const definition =
        PERMISSION_SCHEMA[
          permission
        ];

      const access =
        role === "master" ||
        (
          normalized
            ? normalized.permissions[
                permission
              ] === true
            : defaultsEnabled
        );

      return `
        <article
          class="permission-module-card"
          data-permission-module="${esc(permission)}"
        >
          <div class="permission-module-head">
            <div class="permission-module-copy">
              <strong>
                ${esc(definition.label)}
              </strong>

              <small>
                ${esc(definition.description)}
              </small>
            </div>

            <label class="permission-access-toggle">
              <input
                data-page-access="${esc(permission)}"
                type="checkbox"
                ${access ? "checked" : ""}
              >
              Acessar página
            </label>
          </div>

          <div class="permission-action-grid">
            ${Object.entries(
              definition.actions || {}
            ).map(([action, actionDefinition]) => {
              const checked =
                role === "master" ||
                (
                  normalized
                    ? normalized
                        .subpermissions
                        ?.[permission]
                        ?.[action] === true
                    : (
                        defaultsEnabled &&
                        actionDefinition
                          .masterOnly !== true
                      )
                );

              const masterOnly =
                actionDefinition
                  .masterOnly === true;

              return `
                <label
                  class="permission-action-row ${
                    masterOnly
                      ? "is-master-only"
                      : ""
                  }"
                >
                  <input
                    data-master-only="${
                      masterOnly
                        ? "true"
                        : "false"
                    }"
                    data-subpermission="${esc(
                      `${permission}.${action}`
                    )}"
                    type="checkbox"
                    ${checked ? "checked" : ""}
                  >

                  <span>
                    ${esc(
                      actionDefinition.label
                    )}

                    ${
                      masterOnly
                        ? `
                          <small>
                            Exclusivo da conta Master
                          </small>
                        `
                        : ""
                    }
                  </span>
                </label>
              `;
            }).join("")}
          </div>
        </article>
      `;
    }).join("");

  grid
    .querySelectorAll(
      "[data-page-access]"
    )
    .forEach(input => {
      input.addEventListener(
        "change",
        () => {
          syncModuleState(
            input.closest(
              ".permission-module-card"
            ),
            role
          );
        }
      );
    });

  syncPermissionGrid(
    gridId,
    role
  );
}

function validateAtLeastOnePage(
  role,
  permissionState
) {
  if (role === "master") {
    return;
  }

  const hasPage =
    PERMISSION_KEYS.some(
      permission =>
        permissionState
          .permissions
          ?.[permission] === true
    );

  if (!hasPage) {
    throw new Error(
      "Libere pelo menos uma página para este administrador."
    );
  }
}


function permissionSummary(admin) {
  if (admin.role === "master") {
    return `
      <div class="admin-permission-summary">
        <span class="permission-chip master">
          Acesso total
        </span>
      </div>
    `;
  }

  const normalized =
    normalizePermissionState(admin);

  const enabled =
    PERMISSION_KEYS.filter(
      permission =>
        normalized.permissions[
          permission
        ] === true
    );

  if (!enabled.length) {
    return `
      <div class="admin-permission-summary">
        <span class="permission-chip">
          Nenhuma página liberada
        </span>
      </div>
    `;
  }

  return `
    <div class="permission-summary-groups">
      ${enabled.map(permission => {
        const definition =
          PERMISSION_SCHEMA[
            permission
          ];

        const actions =
          Object.entries(
            definition.actions || {}
          )
            .filter(
              ([action, actionDefinition]) =>
                actionDefinition
                  .masterOnly !== true &&
                normalized
                  .subpermissions
                  ?.[permission]
                  ?.[action] === true
            )
            .map(
              ([, actionDefinition]) =>
                actionDefinition.label
            );

        return `
          <div class="permission-summary-group">
            <strong>
              ${esc(definition.label)}
            </strong>

            <small>
              ${
                actions.length
                  ? esc(actions.join(" • "))
                  : "Somente visualização"
              }
            </small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function closeEditModal() {
  $("editAdminModal")
    .classList.add("hidden");

  document.body.classList.remove(
    "modal-open"
  );

  $("editAdminForm").reset();
  hideMessage("editAdminMessage");
}

function openEditModal(email) {
  if (
    currentSessionAdmin.role !==
    "master"
  ) {
    return;
  }

  const admin =
    administrators.get(email);

  if (!admin) {
    alert(
      "Administrador não encontrado."
    );
    return;
  }

  if (email === MASTER_EMAIL) {
    alert(
      "A conta Master principal não pode ser alterada."
    );
    return;
  }

  $("editOriginalEmail").value =
    email;

  $("editAdminEmail").value =
    email;

  $("editAdminName").value =
    admin.name || "";

  $("editAdminRole").value =
    admin.role || "admin";

  $("editAdminActive").checked =
    admin.active === true;

  renderPermissionGrid(
    "editPermissionGrid",
    {
      role:
        admin.role || "admin",
      admin,
      defaultsEnabled: false
    }
  );

  hideMessage(
    "editAdminMessage"
  );

  $("editAdminModal")
    .classList.remove("hidden");

  document.body.classList.add(
    "modal-open"
  );

  $("editAdminName").focus();
}

async function migrateLegacyPermissions(
  snapshot
) {
  if (
    currentSessionAdmin.role !==
    "master"
  ) {
    return 0;
  }

  const pending =
    snapshot.docs.filter(
      documentSnapshot => {
        const admin =
          documentSnapshot.data();

        if (
          documentSnapshot.id ===
          MASTER_EMAIL
        ) {
          return false;
        }

        return (
          admin.permissionVersion !==
            PERMISSION_VERSION ||
          !admin.subpermissions
        );
      }
    );

  if (!pending.length) {
    return 0;
  }

  const batch =
    writeBatch(db);

  pending.forEach(documentSnapshot => {
    const admin =
      documentSnapshot.data();

    const normalized =
      normalizePermissionState(admin);

    const stored =
      storagePermissionState({
        role:
          admin.role || "admin",
        permissions:
          normalized.permissions,
        subpermissions:
          normalized.subpermissions
      });

    batch.set(
      documentSnapshot.ref,
      {
        ...stored,
        updatedAt:
          serverTimestamp(),
        permissionsMigratedAt:
          serverTimestamp(),
        permissionsMigratedBy:
          currentUser.email
      },
      {
        merge: true
      }
    );
  });

  await batch.commit();

  await tryRecordAdminLog({
    module:
      "administradores",
    action:
      "permissoes_migradas",
    recordId:
      "administradores",
    summary:
      `${pending.length} administradores migrados para permissões e subpermissões.`,
    details: {
      quantity:
        pending.length,
      permissionVersion:
        PERMISSION_VERSION
    }
  });

  return pending.length;
}

async function load({
  allowMigration = true
} = {}) {
  const area = $("tableArea");

  area.innerHTML = `
    <div class="loading">
      Carregando administradores...
    </div>
  `;

  try {
    let snapshot =
      await getDocs(
        query(
          collection(
            db,
            "administradores"
          ),
          orderBy("email")
        )
      );

    if (allowMigration) {
      const migrated =
        await migrateLegacyPermissions(
          snapshot
        );

      if (migrated > 0) {
        snapshot =
          await getDocs(
            query(
              collection(
                db,
                "administradores"
              ),
              orderBy("email")
            )
          );

        toast(
          "Permissões antigas migradas"
        );
      }
    }

    administrators =
      new Map(
        snapshot.docs.map(
          documentSnapshot => [
            documentSnapshot.id,
            {
              id:
                documentSnapshot.id,
              ...documentSnapshot.data()
            }
          ]
        )
      );

    const canToggle =
      currentSessionAdmin.role ===
        "master" ||
      hasSubPermission(
        "administradores",
        "toggleActive"
      );

    const canManage =
      currentSessionAdmin.role ===
      "master";

    area.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Administrador</th>
            <th>Perfil</th>
            <th>Permissões</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>

        <tbody>
          ${
            snapshot.docs.map(
              documentSnapshot => {
                const email =
                  documentSnapshot.id;

                const admin =
                  documentSnapshot.data();

                const protectedMaster =
                  email === MASTER_EMAIL;

                const ownAccount =
                  email ===
                  emailId(
                    currentUser.email
                  );

                const actions = [];

                if (
                  canManage &&
                  !protectedMaster &&
                  !ownAccount
                ) {
                  actions.push(`
                    <button
                      class="btn btn-small btn-secondary"
                      data-edit="${esc(email)}"
                      type="button"
                    >
                      Editar
                    </button>
                  `);
                }

                if (
                  canToggle &&
                  !protectedMaster &&
                  !ownAccount
                ) {
                  actions.push(`
                    <button
                      class="btn btn-small ${
                        admin.active
                          ? "btn-ghost"
                          : "btn-primary"
                      }"
                      data-active="${
                        admin.active === true
                      }"
                      data-toggle="${esc(email)}"
                      type="button"
                    >
                      ${
                        admin.active
                          ? "Desativar"
                          : "Ativar"
                      }
                    </button>
                  `);
                }

                if (
                  canManage &&
                  !protectedMaster &&
                  !ownAccount
                ) {
                  actions.push(`
                    <button
                      class="btn btn-small btn-danger"
                      data-delete="${esc(email)}"
                      type="button"
                    >
                      Excluir
                    </button>
                  `);
                }

                return `
                  <tr>
                    <td>
                      <div class="admin-account-name">
                        <strong>
                          ${esc(
                            admin.name ||
                            "Sem nome"
                          )}
                        </strong>

                        <small>
                          ${esc(email)}
                        </small>
                      </div>
                    </td>

                    <td>
                      ${esc(
                        roleLabel(
                          admin.role
                        )
                      )}
                    </td>

                    <td>
                      ${permissionSummary(admin)}
                    </td>

                    <td>
                      <span
                        class="status ${
                          admin.active
                            ? "ok"
                            : "warn"
                        }"
                      >
                        ${
                          admin.active
                            ? "Ativo"
                            : "Inativo"
                        }
                      </span>
                    </td>

                    <td>
                      ${
                        protectedMaster
                          ? `
                            <span class="status ok">
                              Conta Master protegida
                            </span>
                          `
                          : ownAccount
                            ? `
                              <span class="status ok">
                                Conta atual
                              </span>
                            `
                            : (
                              actions.length
                                ? `
                                  <div class="admin-action-buttons">
                                    ${actions.join("")}
                                  </div>
                                `
                                : `
                                  <span class="status">
                                    Somente consulta
                                  </span>
                                `
                            )
                      }
                    </td>
                  </tr>
                `;
              }
            ).join("") ||
            `
              <tr>
                <td colspan="5">
                  Nenhum administrador cadastrado.
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    `;

    area
      .querySelectorAll(
        "[data-edit]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            openEditModal(
              button.dataset.edit
            );
          }
        );
      });

    area
      .querySelectorAll(
        "[data-toggle]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          async () => {
            const email =
              button.dataset.toggle;

            const currentlyActive =
              button.dataset.active ===
              "true";

            const action =
              currentlyActive
                ? "desativar"
                : "ativar";

            if (
              !confirm(
                `Deseja ${action} o administrador ${email}?`
              )
            ) {
              return;
            }

            try {
              await updateDoc(
                doc(
                  db,
                  "administradores",
                  email
                ),
                {
                  active:
                    !currentlyActive,
                  updatedAt:
                    serverTimestamp(),
                  updatedBy:
                    currentUser.email
                }
              );

              await tryRecordAdminLog({
                module:
                  "administradores",
                action:
                  "status_alterado",
                recordId: email,
                summary:
                  `Administrador ${email} ${
                    currentlyActive
                      ? "desativado"
                      : "ativado"
                  }.`,
                details: {
                  previousActive:
                    currentlyActive,
                  newActive:
                    !currentlyActive
                }
              });

              toast(
                currentlyActive
                  ? "Administrador desativado"
                  : "Administrador ativado"
              );

              await load({
                allowMigration: false
              });
            } catch (error) {
              alert(
                error.message ||
                "Não foi possível alterar o status."
              );
            }
          }
        );
      });

    area
      .querySelectorAll(
        "[data-delete]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          async () => {
            const email =
              button.dataset.delete;

            const admin =
              administrators.get(email);

            const confirmed =
              confirm(
                `Excluir permanentemente o acesso de ${
                  admin?.name || email
                } (${email})?\n\nEsta ação não poderá ser desfeita.`
              );

            if (!confirmed) return;

            try {
              await deleteDoc(
                doc(
                  db,
                  "administradores",
                  email
                )
              );

              await tryRecordAdminLog({
                module:
                  "administradores",
                action: "excluido",
                recordId: email,
                summary:
                  `Administrador ${
                    admin?.name || email
                  } excluído.`,
                details: {
                  email,
                  name:
                    admin?.name || "",
                  role:
                    admin?.role || ""
                }
              });

              toast(
                "Administrador excluído"
              );

              await load({
                allowMigration: false
              });
            } catch (error) {
              alert(
                error.message ||
                "Não foi possível excluir o administrador."
              );
            }
          }
        );
      });
  } catch (error) {
    area.innerHTML = `
      <div class="notice danger">
        ${esc(
          error.message ||
          "Não foi possível carregar os administradores."
        )}
      </div>
    `;
  }
}

async function createAdministrator(
  event
) {
  event.preventDefault();
  hideMessage(
    "adminFormMessage"
  );

  if (
    currentSessionAdmin.role !==
    "master"
  ) {
    return;
  }

  const email =
    emailId(
      $("adminEmail").value
    );

  const name =
    $("adminName").value.trim();

  const role =
    $("adminRole").value;

  try {
    if (!email || !name) {
      throw new Error(
        "Informe o nome e o e-mail Google."
      );
    }

    const reference =
      doc(
        db,
        "administradores",
        email
      );

    const existing =
      await getDoc(reference);

    if (existing.exists()) {
      throw new Error(
        "Já existe um administrador cadastrado com este e-mail."
      );
    }

    const permissionState =
      gridState(
        "permissionGrid",
        role
      );

    validateAtLeastOnePage(
      role,
      permissionState
    );

    await setDoc(reference, {
      email,
      name,
      role,
      ...permissionState,
      active: true,
      createdBy:
        currentUser.email,
      createdAt:
        serverTimestamp(),
      updatedBy:
        currentUser.email,
      updatedAt:
        serverTimestamp()
    });

    $("adminForm").reset();
    $("adminRole").value =
      "admin";

    renderPermissionGrid(
      "permissionGrid",
      {
        role: "admin",
        defaultsEnabled: true
      }
    );

    await tryRecordAdminLog({
      module:
        "administradores",
      action: "criado",
      recordId: email,
      summary:
        `Administrador ${name} cadastrado.`,
      details: {
        email,
        name,
        role,
        permissions:
          permissionState.permissions,
        subpermissions:
          permissionState.subpermissions
      }
    });

    toast(
      "Administrador cadastrado"
    );

    await load({
      allowMigration: false
    });
  } catch (error) {
    showMessage(
      "adminFormMessage",
      error.message ||
      "Não foi possível cadastrar o administrador."
    );
  }
}

async function saveAdministrator(
  event
) {
  event.preventDefault();
  hideMessage(
    "editAdminMessage"
  );

  if (
    currentSessionAdmin.role !==
    "master"
  ) {
    return;
  }

  const saveButton =
    $("saveAdminButton");

  saveButton.disabled = true;
  saveButton.textContent =
    "Salvando...";

  const originalEmail =
    emailId(
      $("editOriginalEmail")
        .value
    );

  const newEmail =
    emailId(
      $("editAdminEmail").value
    );

  const name =
    $("editAdminName")
      .value
      .trim();

  const role =
    $("editAdminRole").value;

  const active =
    $("editAdminActive").checked;

  try {
    if (
      originalEmail ===
      MASTER_EMAIL
    ) {
      throw new Error(
        "A conta Master principal não pode ser alterada."
      );
    }

    if (!newEmail || !name) {
      throw new Error(
        "Informe o nome e o e-mail Google."
      );
    }

    const originalAdmin =
      administrators.get(
        originalEmail
      );

    if (!originalAdmin) {
      throw new Error(
        "O administrador original não foi encontrado."
      );
    }

    const permissionState =
      gridState(
        "editPermissionGrid",
        role
      );

    validateAtLeastOnePage(
      role,
      permissionState
    );

    const updatedData = {
      ...originalAdmin,
      email: newEmail,
      name,
      role,
      ...permissionState,
      active,
      updatedBy:
        currentUser.email,
      updatedAt:
        serverTimestamp()
    };

    delete updatedData.id;

    if (
      newEmail !== originalEmail
    ) {
      const newReference =
        doc(
          db,
          "administradores",
          newEmail
        );

      const existingNewEmail =
        await getDoc(
          newReference
        );

      if (
        existingNewEmail.exists()
      ) {
        throw new Error(
          "Já existe outro administrador cadastrado com o novo e-mail."
        );
      }

      const batch =
        writeBatch(db);

      batch.set(
        newReference,
        updatedData
      );

      batch.delete(
        doc(
          db,
          "administradores",
          originalEmail
        )
      );

      await batch.commit();
    } else {
      await updateDoc(
        doc(
          db,
          "administradores",
          originalEmail
        ),
        {
          email: newEmail,
          name,
          role,
          ...permissionState,
          active,
          updatedBy:
            currentUser.email,
          updatedAt:
            serverTimestamp()
        }
      );
    }

    await tryRecordAdminLog({
      module:
        "administradores",
      action: "atualizado",
      recordId: newEmail,
      summary:
        `Administrador ${name} atualizado.`,
      details: {
        originalEmail,
        newEmail,
        role,
        active,
        permissions:
          permissionState.permissions,
        subpermissions:
          permissionState.subpermissions
      }
    });

    closeEditModal();

    toast(
      "Administrador atualizado"
    );

    await load({
      allowMigration: false
    });
  } catch (error) {
    showMessage(
      "editAdminMessage",
      error.message ||
      "Não foi possível salvar as alterações."
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent =
      "Salvar alterações";
  }
}

bootstrapPage({
  permission: "administradores",

  onReady: async ({
    user,
    admin
  }) => {
    currentUser = user;
    currentSessionAdmin = admin;

    const master =
      admin.role === "master";

    if (!master) {
      document
        .querySelector(
          ".admin-form-card"
        )
        ?.remove();

      $("editAdminModal")?.remove();
    } else {
      renderPermissionGrid(
        "permissionGrid",
        {
          role: "admin",
          defaultsEnabled: true
        }
      );

      $("adminRole")
        .addEventListener(
          "change",
          () => {
            renderPermissionGrid(
              "permissionGrid",
              {
                role:
                  $("adminRole")
                    .value,
                defaultsEnabled:
                  true
              }
            );
          }
        );

      $("editAdminRole")
        .addEventListener(
          "change",
          () => {
            const email =
              emailId(
                $("editOriginalEmail")
                  .value
              );

            const editedAdmin =
              administrators.get(
                email
              );

            renderPermissionGrid(
              "editPermissionGrid",
              {
                role:
                  $("editAdminRole")
                    .value,
                admin:
                  editedAdmin,
                defaultsEnabled:
                  false
              }
            );
          }
        );

      $("adminForm")
        .addEventListener(
          "submit",
          createAdministrator
        );

      $("editAdminForm")
        .addEventListener(
          "submit",
          saveAdministrator
        );

      document
        .querySelectorAll(
          "[data-close-edit]"
        )
        .forEach(button => {
          button.addEventListener(
            "click",
            closeEditModal
          );
        });

      $("editAdminModal")
        .addEventListener(
          "click",
          event => {
            if (
              event.target ===
              $("editAdminModal")
            ) {
              closeEditModal();
            }
          }
        );

      document.addEventListener(
        "keydown",
        event => {
          if (
            event.key === "Escape" &&
            !$("editAdminModal")
              .classList
              .contains("hidden")
          ) {
            closeEditModal();
          }
        }
      );
    }

    $("reloadButton")
      .addEventListener(
        "click",
        () => load({
          allowMigration: master
        })
      );

    await load({
      allowMigration: master
    });
  }
});
