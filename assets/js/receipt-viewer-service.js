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

export function normalizeReceiptServiceUrl(
  value
) {
  const text = String(value || "").trim();

  if (!text) return "";

  let url;

  try {
    url = new URL(text);
  } catch {
    throw new Error(
      "Informe uma URL válida do Google Apps Script."
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
    timeout = 90000
  } = {}
) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    const frameName =
      `receipt-access-${requestId.replaceAll("-", "")}`;

    const iframe =
      document.createElement("iframe");

    iframe.name = frameName;
    iframe.hidden = true;
    iframe.setAttribute(
      "aria-hidden",
      "true"
    );

    const form =
      document.createElement("form");

    form.method = "POST";
    form.action = endpoint;
    form.target = frameName;
    form.enctype =
      "application/x-www-form-urlencoded";
    form.hidden = true;

    const input =
      document.createElement("input");

    input.type = "hidden";
    input.name = "payload";

    input.value = JSON.stringify({
      ...payload,
      requestId,
      origin:
        window.location.origin
    });

    form.append(input);
    document.body.append(
      iframe,
      form
    );

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
          "casamento-receipt-access" ||
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
            "O comprovante não pôde ser aberto."
          )
        );
      });
    };

    const timer =
      window.setTimeout(
        () => {
          finish(() => {
            reject(
              new Error(
                "A abertura do comprovante demorou demais. Verifique a internet e tente novamente."
              )
            );
          });
        },
        timeout
      );

    window.addEventListener(
      "message",
      onMessage
    );

    form.submit();
  });
}

function base64ToBlob(
  base64,
  mimeType
) {
  const normalized =
    String(base64 || "")
      .replace(/\s+/g, "");

  if (!normalized) {
    throw new Error(
      "O arquivo do comprovante veio vazio."
    );
  }

  const binary = atob(normalized);
  const chunkSize = 1024 * 1024;
  const chunks = [];

  for (
    let offset = 0;
    offset < binary.length;
    offset += chunkSize
  ) {
    const slice = binary.slice(
      offset,
      offset + chunkSize
    );

    const bytes =
      new Uint8Array(slice.length);

    for (
      let index = 0;
      index < slice.length;
      index += 1
    ) {
      bytes[index] =
        slice.charCodeAt(index);
    }

    chunks.push(bytes);
  }

  return new Blob(
    chunks,
    {
      type:
        mimeType ||
        "application/octet-stream"
    }
  );
}

function openBlob({
  blob,
  fileName,
  popup
}) {
  const objectUrl =
    URL.createObjectURL(blob);

  let opened = popup;

  if (opened && !opened.closed) {
    try {
      opened.location.replace(
        objectUrl
      );
    } catch {
      opened = null;
    }
  }

  if (!opened) {
    const link =
      document.createElement("a");

    link.href = objectUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.download =
      fileName || "comprovante";

    document.body.append(link);
    link.click();
    link.remove();
  }

  window.setTimeout(
    () => URL.revokeObjectURL(
      objectUrl
    ),
    120000
  );
}

export async function openSecureReceipt({
  endpoint,
  idToken,
  pixId
}) {
  const normalizedEndpoint =
    normalizeReceiptServiceUrl(
      endpoint
    );

  if (!idToken) {
    throw new Error(
      "Não foi possível validar sua sessão administrativa."
    );
  }

  if (!pixId) {
    throw new Error(
      "O PIX do comprovante não foi identificado."
    );
  }

  const popup = window.open(
    "",
    "_blank"
  );

  if (popup) {
    popup.opener = null;

    popup.document.title =
      "Carregando comprovante";

    popup.document.body.innerHTML = `
      <p style="
        font-family:Arial,sans-serif;
        padding:24px;
        color:#342116;
      ">
        Carregando comprovante com segurança...
      </p>
    `;
  }

  try {
    const result =
      await submitPayload(
        normalizedEndpoint,
        {
          action: "viewReceipt",
          idToken,
          pixId
        }
      );

    const blob = base64ToBlob(
      result.fileBase64,
      result.mimeType
    );

    openBlob({
      blob,
      fileName:
        result.fileName ||
        "comprovante",
      popup
    });

    return result;
  } catch (error) {
    if (
      popup &&
      !popup.closed
    ) {
      popup.close();
    }

    throw error;
  }
}
