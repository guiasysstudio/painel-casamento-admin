function isTrustedGoogleOrigin(origin) {
  if (origin === "null") return true;

  try {
    const url = new URL(origin);

    return (
      url.protocol === "https:" &&
      (
        url.hostname === "script.google.com" ||
        url.hostname.endsWith(
          ".googleusercontent.com"
        )
      )
    );
  } catch {
    return false;
  }
}

export function normalizeAutomaticBackupUrl(
  value
) {
  const text = String(value || "").trim();

  if (!text) return "";

  let url;

  try {
    url = new URL(text);
  } catch {
    throw new Error(
      "Informe a URL válida da implantação do Google Apps Script."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !/\/macros\/s\/[^/]+\/exec\/?$/.test(
      url.pathname
    )
  ) {
    throw new Error(
      "Use a URL publicada do Apps Script, terminada em /exec."
    );
  }

  url.search = "";
  url.hash = "";

  return url.href;
}

function submitPayload(
  endpoint,
  payload,
  {
    timeout = 360000
  } = {}
) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const frameName =
      `automatic-backup-${requestId.replaceAll("-", "")}`;

    const iframe = document.createElement(
      "iframe"
    );

    iframe.name = frameName;
    iframe.hidden = true;
    iframe.setAttribute(
      "aria-hidden",
      "true"
    );

    const form = document.createElement(
      "form"
    );

    form.method = "POST";
    form.action = endpoint;
    form.target = frameName;
    form.enctype =
      "application/x-www-form-urlencoded";
    form.hidden = true;

    const input = document.createElement(
      "input"
    );

    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({
      ...payload,
      requestId,
      origin: window.location.origin
    });

    form.append(input);
    document.body.append(iframe, form);

    let finished = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener(
        "message",
        onMessage
      );
      form.remove();
      iframe.remove();
    };

    const finish = callback => {
      if (finished) return;

      finished = true;
      cleanup();
      callback();
    };

    const onMessage = event => {
      if (
        !isTrustedGoogleOrigin(
          event.origin
        )
      ) {
        return;
      }

      const data = event.data;

      if (
        !data ||
        data.source !==
          "casamento-auto-backup" ||
        data.requestId !== requestId
      ) {
        return;
      }

      finish(() => {
        if (data.ok) {
          resolve(data);
          return;
        }

        reject(
          new Error(
            data.message ||
            "O backup automático não foi concluído."
          )
        );
      });
    };

    const timer = window.setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            "O backup demorou demais. Consulte o status no painel e verifique a pasta do Google Drive."
          )
        );
      });
    }, timeout);

    window.addEventListener(
      "message",
      onMessage
    );

    form.submit();
  });
}

export async function runAutomaticBackupNow({
  endpoint,
  idToken
}) {
  const normalizedEndpoint =
    normalizeAutomaticBackupUrl(endpoint);

  if (!idToken) {
    throw new Error(
      "Não foi possível validar sua sessão administrativa."
    );
  }

  return submitPayload(
    normalizedEndpoint,
    {
      action: "runBackupNow",
      idToken
    }
  );
}
