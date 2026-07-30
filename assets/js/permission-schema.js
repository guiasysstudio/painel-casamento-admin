export const PERMISSION_VERSION = 2;

export const PERMISSION_SCHEMA = Object.freeze({
  dashboard: Object.freeze({
    label: "Visão geral",
    description:
      "Controla o acesso à página inicial do painel e aos resumos exibidos.",
    href: "index.html",
    navPage: "dashboard",
    legacyPermission: null,
    defaultAccess: true,
    actions: Object.freeze({
      viewConfirmationsSummary: Object.freeze({
        label: "Ver resumo de confirmações"
      }),
      viewGiftsSummary: Object.freeze({
        label: "Ver resumo de presentes"
      }),
      viewReservationsSummary: Object.freeze({
        label: "Ver resumo de reservas"
      }),
      viewPixSummary: Object.freeze({
        label: "Ver resumo de PIX"
      })
    })
  }),

  confirmacoes: Object.freeze({
    label: "Confirmações",
    description:
      "Permite consultar as famílias confirmadas e controlar o status.",
    href: "confirmacoes.html",
    navPage: "confirmacoes",
    legacyPermission: "confirmacoes",
    actions: Object.freeze({
      viewContacts: Object.freeze({
        label: "Visualizar WhatsApp"
      }),
      changeStatus: Object.freeze({
        label: "Cancelar ou restaurar confirmação"
      })
    })
  }),

  presentes: Object.freeze({
    label: "Presentes",
    description:
      "Controla cadastro, edição, visibilidade e exclusão dos presentes.",
    href: "presentes.html",
    navPage: "presentes",
    legacyPermission: "presentes",
    actions: Object.freeze({
      create: Object.freeze({
        label: "Cadastrar presente"
      }),
      edit: Object.freeze({
        label: "Editar dados e imagem"
      }),
      changeVisibility: Object.freeze({
        label: "Ativar, ocultar ou publicar"
      }),
      delete: Object.freeze({
        label: "Excluir presente"
      })
    })
  }),

  reservas: Object.freeze({
    label: "Reservas",
    description:
      "Controla contatos, confirmação de compra e liberação de presentes.",
    href: "reservas.html",
    navPage: "reservas",
    legacyPermission: "reservas",
    actions: Object.freeze({
      viewContacts: Object.freeze({
        label: "Visualizar WhatsApp"
      }),
      confirmPurchase: Object.freeze({
        label: "Confirmar compra"
      }),
      release: Object.freeze({
        label: "Liberar reserva"
      }),
      useWhatsapp: Object.freeze({
        label: "Usar botão de agradecimento no WhatsApp"
      })
    })
  }),

  pix: Object.freeze({
    label: "PIX",
    description:
      "Permite separar consulta, comprovantes, ações financeiras e configurações.",
    href: "pix.html",
    navPage: "pix",
    legacyPermission: "pix",
    actions: Object.freeze({
      viewContacts: Object.freeze({
        label: "Visualizar WhatsApp"
      }),
      viewReceipts: Object.freeze({
        label: "Visualizar comprovantes"
      }),
      confirm: Object.freeze({
        label: "Confirmar recebimento"
      }),
      unconfirm: Object.freeze({
        label: "Desconfirmar PIX"
      }),
      reject: Object.freeze({
        label: "Recusar PIX"
      }),
      reopen: Object.freeze({
        label: "Reabrir PIX recusado"
      }),
      delete: Object.freeze({
        label: "Excluir PIX"
      }),
      configurePix: Object.freeze({
        label: "Configurar chave e dados do PIX"
      }),
      configureReceipts: Object.freeze({
        label: "Configurar envio de comprovantes"
      })
    })
  }),

  paginaInicial: Object.freeze({
    label: "Página inicial",
    description:
      "Divide a edição do conteúdo, evento, prazo e regras de reserva.",
    href: "pagina-inicial.html",
    navPage: "pagina-inicial",
    legacyPermission: "configuracoes",
    actions: Object.freeze({
      editContent: Object.freeze({
        label: "Editar nome, título e apresentação"
      }),
      editEvent: Object.freeze({
        label: "Editar data, horário, local e mapa"
      }),
      editDeadline: Object.freeze({
        label: "Editar prazo de confirmação"
      }),
      editReservationRules: Object.freeze({
        label: "Editar duração da reserva e idade infantil"
      })
    })
  }),

  entrega: Object.freeze({
    label: "Entrega",
    description:
      "Controla os dados do endereço e sua exibição no site público.",
    href: "entrega.html",
    navPage: "entrega",
    legacyPermission: "configuracoes",
    actions: Object.freeze({
      editAddress: Object.freeze({
        label: "Editar endereço e contato"
      }),
      togglePublic: Object.freeze({
        label: "Ativar ou desativar endereço público"
      })
    })
  }),

  dominio: Object.freeze({
    label: "Domínio",
    description:
      "Separa os domínios do site e o destino do botão Site do painel.",
    href: "dominio.html",
    navPage: "dominio",
    legacyPermission: "configuracoes",
    actions: Object.freeze({
      editDomains: Object.freeze({
        label: "Editar domínios público e administrativo"
      }),
      editSiteButton: Object.freeze({
        label: "Editar link do botão Site"
      })
    })
  }),

  administradores: Object.freeze({
    label: "Administradores",
    description:
      "A página pode ser liberada para consulta e ativação ou desativação.",
    href: "administradores.html",
    navPage: "administradores",
    legacyPermission: "administradores",
    actions: Object.freeze({
      toggleActive: Object.freeze({
        label: "Ativar ou desativar administradores"
      }),
      create: Object.freeze({
        label: "Cadastrar administrador",
        masterOnly: true
      }),
      edit: Object.freeze({
        label: "Editar dados do administrador",
        masterOnly: true
      }),
      delete: Object.freeze({
        label: "Excluir administrador",
        masterOnly: true
      }),
      managePermissions: Object.freeze({
        label: "Gerenciar permissões",
        masterOnly: true
      })
    })
  }),

  exportacoes: Object.freeze({
    label: "Exportações",
    description:
      "Permite gerar os arquivos de confirmação e listas de convidados.",
    href: "exportacoes.html",
    navPage: "exportacoes",
    legacyPermission: "exportacoes",
    actions: Object.freeze({
      exportConfirmations: Object.freeze({
        label: "Gerar e baixar relatórios"
      })
    })
  }),

  logs: Object.freeze({
    label: "Logs e backup",
    description:
      "Controla detalhes dos logs, exportação e operações sensíveis de backup.",
    href: "logs.html",
    navPage: "logs",
    legacyPermission: "logs",
    actions: Object.freeze({
      viewDetails: Object.freeze({
        label: "Visualizar detalhes técnicos dos logs"
      }),
      exportLogs: Object.freeze({
        label: "Exportar logs em CSV"
      }),
      clearLogs: Object.freeze({
        label: "Limpar histórico de logs",
        masterOnly: true
      }),
      generateBackup: Object.freeze({
        label: "Gerar backup manual",
        masterOnly: true
      }),
      restoreBackup: Object.freeze({
        label: "Restaurar backup",
        masterOnly: true
      }),
      configureAutomaticBackup: Object.freeze({
        label: "Configurar backup automático",
        masterOnly: true
      }),
      runAutomaticBackup: Object.freeze({
        label: "Executar backup automático agora",
        masterOnly: true
      })
    })
  })
});

export const PERMISSION_KEYS = Object.freeze(
  Object.keys(PERMISSION_SCHEMA)
);

export const NAV_PERMISSION_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(PERMISSION_SCHEMA).map(
      ([permission, definition]) => [
        definition.navPage,
        permission
      ]
    )
  )
);

export function permissionDefinition(permission) {
  return PERMISSION_SCHEMA[permission] || null;
}

export function isMasterRole(role) {
  return String(role || "") === "master";
}

function booleanValue(value, fallback) {
  return typeof value === "boolean"
    ? value
    : fallback;
}

function legacyAccess(
  permission,
  storedPermissions = {},
  legacyMode = true
) {
  const definition =
    permissionDefinition(permission);

  if (!definition) return false;

  if (
    typeof storedPermissions[permission] ===
    "boolean"
  ) {
    return storedPermissions[permission];
  }

  if (
    legacyMode &&
    definition.legacyPermission &&
    typeof storedPermissions[
      definition.legacyPermission
    ] === "boolean"
  ) {
    return storedPermissions[
      definition.legacyPermission
    ];
  }

  return (
    legacyMode &&
    definition.defaultAccess === true
  );
}

export function normalizePermissionState(
  admin = {}
) {
  const master = isMasterRole(admin.role);

  const legacyMode =
    Number(
      admin.permissionVersion || 0
    ) < PERMISSION_VERSION;

  const storedPermissions =
    admin.permissions &&
    typeof admin.permissions === "object"
      ? admin.permissions
      : {};

  const storedSubpermissions =
    admin.subpermissions &&
    typeof admin.subpermissions === "object"
      ? admin.subpermissions
      : {};

  const permissions = {};
  const subpermissions = {};

  PERMISSION_KEYS.forEach(permission => {
    const definition =
      permissionDefinition(permission);

    const access = master
      ? true
      : legacyAccess(
          permission,
          storedPermissions,
          legacyMode
        );

    permissions[permission] = access;
    subpermissions[permission] = {};

    Object.entries(
      definition.actions || {}
    ).forEach(([action, actionDefinition]) => {
      const explicit =
        storedSubpermissions?.[permission]
          ?.[action];

      subpermissions[permission][action] =
        master
          ? true
          : actionDefinition.masterOnly === true
            ? false
            : booleanValue(
                explicit,
                legacyMode
                  ? access
                  : false
              );
    });
  });

  return {
    permissionVersion:
      PERMISSION_VERSION,
    permissions,
    subpermissions
  };
}

export function permissionEnabled(
  admin,
  permission
) {
  if (!admin || admin.active !== true) {
    return false;
  }

  if (isMasterRole(admin.role)) {
    return true;
  }

  return normalizePermissionState(admin)
    .permissions[permission] === true;
}

export function subpermissionEnabled(
  admin,
  permission,
  action
) {
  if (!admin || admin.active !== true) {
    return false;
  }

  if (isMasterRole(admin.role)) {
    return true;
  }

  const state =
    normalizePermissionState(admin);

  return (
    state.permissions[permission] === true &&
    state.subpermissions?.[permission]
      ?.[action] === true
  );
}

export function storagePermissionState({
  role = "admin",
  permissions = {},
  subpermissions = {}
} = {}) {
  const master = isMasterRole(role);

  const normalizedPermissions = {};
  const normalizedSubpermissions = {};

  PERMISSION_KEYS.forEach(permission => {
    const definition =
      permissionDefinition(permission);

    const access = master
      ? true
      : permissions[permission] === true;

    normalizedPermissions[permission] =
      access;

    normalizedSubpermissions[permission] =
      {};

    Object.entries(
      definition.actions || {}
    ).forEach(([action, actionDefinition]) => {
      normalizedSubpermissions[
        permission
      ][action] =
        master
          ? true
          : (
              actionDefinition.masterOnly ===
                true
                ? false
                : (
                    access &&
                    subpermissions?.[permission]
                      ?.[action] === true
                  )
            );
    });
  });

  /*
   * Mantém as permissões antigas para compatibilidade com versões
   * anteriores que ainda possam estar em cache.
   */
  normalizedPermissions.confirmacoes =
    normalizedPermissions.confirmacoes;

  normalizedPermissions.presentes =
    normalizedPermissions.presentes;

  normalizedPermissions.reservas =
    normalizedPermissions.reservas;

  normalizedPermissions.pix =
    normalizedPermissions.pix;

  normalizedPermissions.configuracoes =
    (
      normalizedPermissions.paginaInicial ||
      normalizedPermissions.entrega ||
      normalizedPermissions.dominio
    );

  normalizedPermissions.administradores =
    normalizedPermissions.administradores;

  normalizedPermissions.exportacoes =
    normalizedPermissions.exportacoes;

  normalizedPermissions.logs =
    normalizedPermissions.logs;

  return {
    permissionVersion:
      PERMISSION_VERSION,
    permissions:
      normalizedPermissions,
    subpermissions:
      normalizedSubpermissions
  };
}

export function fullPermissionState(
  role = "master"
) {
  const permissions = Object.fromEntries(
    PERMISSION_KEYS.map(permission => [
      permission,
      true
    ])
  );

  const subpermissions =
    Object.fromEntries(
      PERMISSION_KEYS.map(permission => [
        permission,
        Object.fromEntries(
          Object.keys(
            permissionDefinition(permission)
              .actions || {}
          ).map(action => [
            action,
            true
          ])
        )
      ])
    );

  return storagePermissionState({
    role,
    permissions,
    subpermissions
  });
}
