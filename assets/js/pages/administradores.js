import {
  bootstrapPage,
  db,
  $,
  esc,
  emailId,
  MASTER_EMAIL,
  PERMISSIONS,
  toast
} from "../admin-core.js";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const PERMISSION_LABELS = {
  confirmacoes: "Confirmações",
  presentes: "Presentes",
  reservas: "Reservas",
  pix: "PIX",
  configuracoes: "Configurações",
  administradores: "Administradores",
  exportacoes: "Exportações",
  logs: "Logs e backup"
};

let currentUser = null;
let administrators = new Map();

function permissionLabel(permission) {
  return PERMISSION_LABELS[permission] || permission;
}

function roleLabel(role) {
  return role === "master" ? "Master" : "Administrador";
}

function showMessage(elementId, message, type = "danger") {
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

function permissionValues(gridId, role) {
  const grid = $(gridId);

  return Object.fromEntries(
    [...grid.querySelectorAll("[data-permission]")].map(input => [
      input.dataset.permission,
      role === "master" || input.checked
    ])
  );
}

function renderPermissionGrid(gridId, {
  role = "admin",
  permissions = null
} = {}) {
  const grid = $(gridId);

  grid.innerHTML = PERMISSIONS.map(permission => {
    const checked =
      role === "master" ||
      permissions?.[permission] === true ||
      permissions === null;

    return `
      <label class="checkbox-row">
        <input
          type="checkbox"
          data-permission="${esc(permission)}"
          ${checked ? "checked" : ""}
          ${role === "master" ? "disabled" : ""}
        >
        ${esc(permissionLabel(permission))}
      </label>
    `;
  }).join("");
}

function updateGridForRole(roleSelectId, gridId) {
  const master = $(roleSelectId).value === "master";

  $(gridId).querySelectorAll("[data-permission]").forEach(input => {
    if (master) input.checked = true;
    input.disabled = master;
  });
}

function permissionSummary(admin) {
  if (admin.role === "master") {
    return `
      <div class="admin-permission-summary">
        <span class="permission-chip master">Acesso total</span>
      </div>
    `;
  }

  const enabled = PERMISSIONS.filter(
    permission => admin.permissions?.[permission] === true
  );

  if (!enabled.length) {
    return `
      <div class="admin-permission-summary">
        <span class="permission-chip">Nenhuma permissão</span>
      </div>
    `;
  }

  return `
    <div class="admin-permission-summary">
      ${enabled.map(permission => `
        <span class="permission-chip">
          ${esc(permissionLabel(permission))}
        </span>
      `).join("")}
    </div>
  `;
}

function closeEditModal() {
  $("editAdminModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  $("editAdminForm").reset();
  hideMessage("editAdminMessage");
}

function openEditModal(email) {
  const admin = administrators.get(email);

  if (!admin) {
    alert("Administrador não encontrado.");
    return;
  }

  if (email === MASTER_EMAIL) {
    alert("A conta Master principal não pode ser alterada.");
    return;
  }

  $("editOriginalEmail").value = email;
  $("editAdminEmail").value = email;
  $("editAdminName").value = admin.name || "";
  $("editAdminRole").value = admin.role || "admin";
  $("editAdminActive").checked = admin.active === true;

  renderPermissionGrid("editPermissionGrid", {
    role: admin.role || "admin",
    permissions: admin.permissions || {}
  });

  updateGridForRole("editAdminRole", "editPermissionGrid");
  hideMessage("editAdminMessage");

  $("editAdminModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  $("editAdminName").focus();
}

async function load() {
  const area = $("tableArea");
  area.innerHTML = '<div class="loading">Carregando administradores...</div>';

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "administradores"),
        orderBy("email")
      )
    );

    administrators = new Map(
      snapshot.docs.map(documentSnapshot => [
        documentSnapshot.id,
        {
          id: documentSnapshot.id,
          ...documentSnapshot.data()
        }
      ])
    );

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
            snapshot.docs.map(documentSnapshot => {
              const email = documentSnapshot.id;
              const admin = documentSnapshot.data();
              const protectedMaster = email === MASTER_EMAIL;

              return `
                <tr>
                  <td>
                    <div class="admin-account-name">
                      <strong>${esc(admin.name || "Sem nome")}</strong>
                      <small>${esc(email)}</small>
                    </div>
                  </td>

                  <td>${esc(roleLabel(admin.role))}</td>

                  <td>${permissionSummary(admin)}</td>

                  <td>
                    <span class="status ${admin.active ? "ok" : "warn"}">
                      ${admin.active ? "Ativo" : "Inativo"}
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
                        : `
                          <div class="admin-action-buttons">
                            <button
                              class="btn btn-small btn-secondary"
                              type="button"
                              data-edit="${esc(email)}"
                            >
                              Editar
                            </button>

                            <button
                              class="btn btn-small ${
                                admin.active ? "btn-ghost" : "btn-primary"
                              }"
                              type="button"
                              data-toggle="${esc(email)}"
                              data-active="${admin.active === true}"
                            >
                              ${admin.active ? "Desativar" : "Ativar"}
                            </button>

                            <button
                              class="btn btn-small btn-danger"
                              type="button"
                              data-delete="${esc(email)}"
                            >
                              Excluir
                            </button>
                          </div>
                        `
                    }
                  </td>
                </tr>
              `;
            }).join("") ||
            '<tr><td colspan="5">Nenhum administrador cadastrado.</td></tr>'
          }
        </tbody>
      </table>
    `;

    area.querySelectorAll("[data-edit]").forEach(button => {
      button.addEventListener("click", () => {
        openEditModal(button.dataset.edit);
      });
    });

    area.querySelectorAll("[data-toggle]").forEach(button => {
      button.addEventListener("click", async () => {
        const email = button.dataset.toggle;
        const currentlyActive = button.dataset.active === "true";
        const action = currentlyActive ? "desativar" : "ativar";

        if (!confirm(`Deseja ${action} o administrador ${email}?`)) {
          return;
        }

        try {
          await updateDoc(
            doc(db, "administradores", email),
            {
              active: !currentlyActive,
              updatedAt: serverTimestamp(),
              updatedBy: currentUser.email
            }
          );

          toast(
            currentlyActive
              ? "Administrador desativado"
              : "Administrador ativado"
          );

          await load();
        } catch (error) {
          alert(error.message || "Não foi possível alterar o status.");
        }
      });
    });

    area.querySelectorAll("[data-delete]").forEach(button => {
      button.addEventListener("click", async () => {
        const email = button.dataset.delete;
        const admin = administrators.get(email);

        const confirmed = confirm(
          `Excluir permanentemente o acesso de ${
            admin?.name || email
          } (${email})?\n\nEsta ação não poderá ser desfeita.`
        );

        if (!confirmed) return;

        try {
          await deleteDoc(doc(db, "administradores", email));
          toast("Administrador excluído");
          await load();
        } catch (error) {
          alert(error.message || "Não foi possível excluir o administrador.");
        }
      });
    });
  } catch (error) {
    area.innerHTML = `
      <div class="notice danger">
        ${esc(error.message || "Não foi possível carregar os administradores.")}
      </div>
    `;
  }
}

async function createAdministrator(event) {
  event.preventDefault();
  hideMessage("adminFormMessage");

  const email = emailId($("adminEmail").value);
  const name = $("adminName").value.trim();
  const role = $("adminRole").value;

  try {
    if (!email || !name) {
      throw new Error("Informe o nome e o e-mail Google.");
    }

    const reference = doc(db, "administradores", email);
    const existing = await getDoc(reference);

    if (existing.exists()) {
      throw new Error(
        "Já existe um administrador cadastrado com este e-mail."
      );
    }

    const permissions = permissionValues("permissionGrid", role);

    await setDoc(reference, {
      email,
      name,
      role,
      permissions,
      active: true,
      createdBy: currentUser.email,
      createdAt: serverTimestamp(),
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    });

    $("adminForm").reset();
    $("adminRole").value = "admin";
    renderPermissionGrid("permissionGrid", {
      role: "admin",
      permissions: null
    });

    toast("Administrador cadastrado");
    await load();
  } catch (error) {
    showMessage(
      "adminFormMessage",
      error.message || "Não foi possível cadastrar o administrador."
    );
  }
}

async function saveAdministrator(event) {
  event.preventDefault();
  hideMessage("editAdminMessage");

  const saveButton = $("saveAdminButton");
  saveButton.disabled = true;
  saveButton.textContent = "Salvando...";

  const originalEmail = emailId($("editOriginalEmail").value);
  const newEmail = emailId($("editAdminEmail").value);
  const name = $("editAdminName").value.trim();
  const role = $("editAdminRole").value;
  const active = $("editAdminActive").checked;

  try {
    if (originalEmail === MASTER_EMAIL) {
      throw new Error("A conta Master principal não pode ser alterada.");
    }

    if (!newEmail || !name) {
      throw new Error("Informe o nome e o e-mail Google.");
    }

    const originalAdmin = administrators.get(originalEmail);

    if (!originalAdmin) {
      throw new Error("O administrador original não foi encontrado.");
    }

    const permissions = permissionValues(
      "editPermissionGrid",
      role
    );

    const updatedData = {
      ...originalAdmin,
      email: newEmail,
      name,
      role,
      permissions,
      active,
      updatedBy: currentUser.email,
      updatedAt: serverTimestamp()
    };

    delete updatedData.id;

    if (newEmail !== originalEmail) {
      const newReference = doc(db, "administradores", newEmail);
      const existingNewEmail = await getDoc(newReference);

      if (existingNewEmail.exists()) {
        throw new Error(
          "Já existe outro administrador cadastrado com o novo e-mail."
        );
      }

      const batch = writeBatch(db);

      batch.set(newReference, updatedData);
      batch.delete(doc(db, "administradores", originalEmail));

      await batch.commit();
    } else {
      await updateDoc(
        doc(db, "administradores", originalEmail),
        {
          email: newEmail,
          name,
          role,
          permissions,
          active,
          updatedBy: currentUser.email,
          updatedAt: serverTimestamp()
        }
      );
    }

    closeEditModal();
    toast("Administrador atualizado");
    await load();
  } catch (error) {
    showMessage(
      "editAdminMessage",
      error.message || "Não foi possível salvar as alterações."
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Salvar alterações";
  }
}

bootstrapPage({
  permission: "administradores",

  onReady: async ({ user, admin }) => {
    currentUser = user;

    if (admin.role !== "master") {
      document.querySelector(".admin-main").innerHTML = `
        <div class="page-card access-denied">
          <p class="eyebrow">Acesso negado</p>
          <h1 style="font-family:var(--title-font);font-weight:400">
            Somente Master
          </h1>
          <p>
            Apenas uma conta Master pode cadastrar, editar ou excluir administradores.
          </p>
          <a class="btn btn-primary" href="index.html">
            Voltar à visão geral
          </a>
        </div>
      `;
      return;
    }

    renderPermissionGrid("permissionGrid", {
      role: "admin",
      permissions: null
    });

    $("adminRole").addEventListener("change", () => {
      updateGridForRole("adminRole", "permissionGrid");
    });

    $("editAdminRole").addEventListener("change", () => {
      updateGridForRole(
        "editAdminRole",
        "editPermissionGrid"
      );
    });

    $("adminForm").addEventListener(
      "submit",
      createAdministrator
    );

    $("editAdminForm").addEventListener(
      "submit",
      saveAdministrator
    );

    $("reloadButton").addEventListener("click", load);

    document.querySelectorAll("[data-close-edit]").forEach(button => {
      button.addEventListener("click", closeEditModal);
    });

    $("editAdminModal").addEventListener("click", event => {
      if (event.target === $("editAdminModal")) {
        closeEditModal();
      }
    });

    document.addEventListener("keydown", event => {
      if (
        event.key === "Escape" &&
        !$("editAdminModal").classList.contains("hidden")
      ) {
        closeEditModal();
      }
    });

    await load();
  }
});
