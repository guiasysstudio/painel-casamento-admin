import {
  bootstrapPage,
  db,
  $,
  esc,
  money,
  toast
} from "../admin-core.js";

import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const DEFAULT_IMAGE_MODE = "fit";
const DEFAULT_THRESHOLD = 45;
const DEFAULT_IMAGE_SCALE = 85;
const MIN_IMAGE_SCALE = 35;
const MAX_IMAGE_SCALE = 160;
const MAX_IMAGE_SIDE = 720;
const MAX_IMAGE_DATA_LENGTH = 720000;

let originalSource = "";
let originalSourceType = "";
let finalImageSource = "";
let sourceImage = null;
let sourceObjectUrl = "";
let effectiveImageMode = DEFAULT_IMAGE_MODE;
let imageProcessingStatus = "none";
let imageProcessingTimer = null;

function normalizeImageMode(value) {
  return ["original", "fit", "remove-white"].includes(value)
    ? value
    : DEFAULT_IMAGE_MODE;
}

function revokeSourceObjectUrl() {
  if (sourceObjectUrl) {
    URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = "";
  }
}

function setMessage(message, type = "info") {
  const element = $("imageProcessingMessage");
  element.className = `notice ${type}`;
  element.textContent = message;
}

function setSourceStatus(message) {
  $("imageSourceStatus").textContent = message;
}

function setPreview(elementId, emptyId, source) {
  const image = $(elementId);
  const surface = image.closest(".image-preview-surface");

  if (!source) {
    image.removeAttribute("src");
    surface.classList.remove("has-image");
    $(emptyId).hidden = false;
    return;
  }

  image.src = source;
  surface.classList.add("has-image");
  $(emptyId).hidden = true;
}

function updateProcessedPreviewMode(mode) {
  const surface = $("processedPreviewSurface");

  surface.classList.remove(
    "image-mode-original",
    "image-mode-fit",
    "image-mode-remove-white"
  );

  surface.classList.add(`image-mode-${normalizeImageMode(mode)}`);
}

function normalizeImageScale(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_IMAGE_SCALE;
  }

  return Math.max(
    MIN_IMAGE_SCALE,
    Math.min(MAX_IMAGE_SCALE, Math.round(number))
  );
}

function applyImageScalePreview(value) {
  const scale = normalizeImageScale(value);
  const surface = $("processedPreviewSurface");

  $("giftImageScale").value = scale;
  $("giftImageScaleValue").textContent = `${scale}%`;

  surface.style.setProperty(
    "--gift-preview-scale",
    String(scale / 100)
  );
}

function updateThresholdVisibility() {
  const removeWhite = $("giftImageMode").value === "remove-white";
  $("thresholdField").classList.toggle("image-control-disabled", !removeWhite);
  $("giftImageThreshold").disabled = !removeWhite;
}

function loadImageElement(source, {
  crossOrigin = false,
  revokeAfterLoad = false
} = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    if (crossOrigin) {
      image.crossOrigin = "anonymous";
      image.referrerPolicy = "no-referrer";
    }

    image.onload = () => {
      if (revokeAfterLoad) {
        window.setTimeout(() => URL.revokeObjectURL(source), 0);
      }

      resolve(image);
    };

    image.onerror = () => {
      if (revokeAfterLoad) URL.revokeObjectURL(source);
      reject(new Error("Não foi possível carregar a imagem."));
    };

    image.src = source;
  });
}

async function loadExternalImageForProcessing(url) {
  const response = await fetch(url, {
    mode: "cors",
    cache: "no-store",
    referrerPolicy: "no-referrer"
  });

  if (!response.ok) {
    throw new Error(`A imagem retornou o código ${response.status}.`);
  }

  const blob = await response.blob();

  if (!blob.type.startsWith("image/")) {
    throw new Error(
      "O endereço informado não retornou uma imagem direta."
    );
  }

  revokeSourceObjectUrl();
  sourceObjectUrl = URL.createObjectURL(blob);

  return loadImageElement(sourceObjectUrl);
}

function createScaledCanvas(image, maxSide = MAX_IMAGE_SIDE) {
  const scale = Math.min(
    1,
    maxSide / image.naturalWidth,
    maxSide / image.naturalHeight
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas;
}

function removeConnectedWhiteBackground(
  canvas,
  strength,
  removeInternalWhite = true
) {
  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const width = canvas.width;
  const height = canvas.height;
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const pixelCount = width * height;

  const intensity = Math.max(
    10,
    Math.min(90, Number(strength) || 45)
  );

  const cutoff = 252 - intensity * .68;
  const neutralLimit = 16 + intensity * .18;

  /*
   * Pixels marcados para transparência.
   * Primeiro entram os fundos conectados às bordas.
   * Depois, opcionalmente, entram componentes brancos internos.
   */
  const removable = new Uint8Array(pixelCount);
  const queued = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);

  function pixelMetrics(index) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];

    return {
      alpha: data[offset + 3],
      average: (red + green + blue) / 3,
      spread:
        Math.max(red, green, blue) -
        Math.min(red, green, blue)
    };
  }

  function isBackgroundCandidate(index) {
    const metrics = pixelMetrics(index);

    if (metrics.alpha === 0) return true;

    return (
      metrics.average >= cutoff &&
      metrics.spread <= neutralLimit
    );
  }

  /*
   * Flood fill com oito direções. Isso remove também pequenos
   * pontos diagonais que antes ficavam isolados na borda do objeto.
   */
  function addNeighbours(index, enqueue) {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;

        const nextX = x + offsetX;
        const nextY = y + offsetY;

        if (
          nextX < 0 ||
          nextX >= width ||
          nextY < 0 ||
          nextY >= height
        ) {
          continue;
        }

        enqueue(nextY * width + nextX);
      }
    }
  }

  /*
   * Etapa 1: fundo branco conectado às extremidades da imagem.
   */
  let queueStart = 0;
  let queueEnd = 0;

  function enqueueOuter(index) {
    if (
      index < 0 ||
      index >= pixelCount ||
      queued[index] ||
      !isBackgroundCandidate(index)
    ) {
      return;
    }

    queued[index] = 1;
    queue[queueEnd++] = index;
  }

  for (let x = 0; x < width; x += 1) {
    enqueueOuter(x);
    enqueueOuter((height - 1) * width + x);
  }

  for (let y = 0; y < height; y += 1) {
    enqueueOuter(y * width);
    enqueueOuter(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart++];
    removable[index] = 1;
    addNeighbours(index, enqueueOuter);
  }

  /*
   * Etapa 2: procura "ilhas" brancas que não alcançam as bordas.
   * É o caso do branco preso no centro de utensílios vazados.
   */
  if (removeInternalWhite) {
    const componentVisited = new Uint8Array(pixelCount);
    const componentQueue = new Int32Array(pixelCount);
    const componentPixels = [];

    for (let seed = 0; seed < pixelCount; seed += 1) {
      if (
        removable[seed] ||
        componentVisited[seed] ||
        !isBackgroundCandidate(seed)
      ) {
        continue;
      }

      let componentStart = 0;
      let componentEnd = 0;
      let touchesBorder = false;
      let brightnessTotal = 0;
      let spreadTotal = 0;
      let left = width;
      let right = -1;
      let top = height;
      let bottom = -1;

      componentPixels.length = 0;
      componentVisited[seed] = 1;
      componentQueue[componentEnd++] = seed;

      function enqueueComponent(index) {
        if (
          index < 0 ||
          index >= pixelCount ||
          componentVisited[index] ||
          removable[index] ||
          !isBackgroundCandidate(index)
        ) {
          return;
        }

        componentVisited[index] = 1;
        componentQueue[componentEnd++] = index;
      }

      while (componentStart < componentEnd) {
        const index = componentQueue[componentStart++];
        componentPixels.push(index);

        const x = index % width;
        const y = Math.floor(index / width);
        const metrics = pixelMetrics(index);

        brightnessTotal += metrics.average;
        spreadTotal += metrics.spread;

        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);

        if (
          x === 0 ||
          x === width - 1 ||
          y === 0 ||
          y === height - 1
        ) {
          touchesBorder = true;
        }

        addNeighbours(index, enqueueComponent);
      }

      const size = componentPixels.length;
      const averageBrightness =
        size ? brightnessTotal / size : 0;
      const averageSpread =
        size ? spreadTotal / size : 255;

      const boxWidth = right - left + 1;
      const boxHeight = bottom - top + 1;
      const boxArea = Math.max(1, boxWidth * boxHeight);
      const fillRatio = size / boxArea;

      /*
       * Proteções contra apagar partes brancas reais do produto:
       * - nunca remove componentes que tocam a borda;
       * - limita o componente a 38% da imagem;
       * - exige branco bastante neutro;
       * - exige uma área mínima para ignorar ruído;
       * - evita remover grandes peças brancas muito sólidas.
       *
       * A caixa no ADM permite desligar esta etapa quando necessário.
       */
      const shouldRemove = (
        !touchesBorder &&
        size >= 12 &&
        size <= pixelCount * .38 &&
        averageBrightness >= cutoff + 1 &&
        averageSpread <= neutralLimit * .9 &&
        (
          fillRatio < .9 ||
          size <= pixelCount * .18
        )
      );

      if (shouldRemove) {
        componentPixels.forEach(index => {
          removable[index] = 1;
        });
      }
    }
  }

  /*
   * Suavização da borda para não deixar recortes serrilhados.
   */
  const featherRange = Math.max(5, 255 - cutoff);

  for (let index = 0; index < pixelCount; index += 1) {
    if (!removable[index]) continue;

    const offset = index * 4;
    const average = (
      data[offset] +
      data[offset + 1] +
      data[offset + 2]
    ) / 3;

    const remaining = Math.max(
      0,
      Math.min(1, (255 - average) / featherRange)
    );

    data[offset + 3] = Math.round(
      data[offset + 3] * remaining
    );
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function trimTransparentCanvas(canvas) {
  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;

  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];

      if (alpha > 12) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left || bottom < top) return canvas;

  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const padding = Math.max(
    8,
    Math.round(Math.max(contentWidth, contentHeight) * .045)
  );

  const result = document.createElement("canvas");
  result.width = contentWidth + padding * 2;
  result.height = contentHeight + padding * 2;

  result.getContext("2d").drawImage(
    canvas,
    left,
    top,
    contentWidth,
    contentHeight,
    padding,
    padding,
    contentWidth,
    contentHeight
  );

  return result;
}

function canvasToCompressedDataUrl(canvas) {
  let quality = .84;
  let result = canvas.toDataURL("image/webp", quality);

  while (
    result.length > MAX_IMAGE_DATA_LENGTH &&
    quality > .52
  ) {
    quality -= .07;
    result = canvas.toDataURL("image/webp", quality);
  }

  if (result.length > MAX_IMAGE_DATA_LENGTH) {
    throw new Error(
      "A imagem ainda ficou muito grande. Use uma imagem menor ou recorte-a antes do upload."
    );
  }

  return result;
}

function processLoadedImage(image, mode, threshold) {
  let canvas = createScaledCanvas(image);

  if (mode === "remove-white") {
    canvas = removeConnectedWhiteBackground(
      canvas,
      threshold,
      $("giftRemoveInternalWhite").checked
    );
    canvas = trimTransparentCanvas(canvas);
  }

  return canvasToCompressedDataUrl(canvas);
}

async function applyCurrentTreatment({
  showWorkingMessage = true
} = {}) {
  const selectedMode = normalizeImageMode(
    $("giftImageMode").value
  );
  const threshold = Number($("giftImageThreshold").value);

  updateThresholdVisibility();

  if (!originalSource) {
    finalImageSource = "";
    effectiveImageMode = selectedMode;
    imageProcessingStatus = "none";
    setPreview("giftOriginalPreview", "originalPreviewEmpty", "");
    setPreview("giftImagePreview", "processedPreviewEmpty", "");
    updateProcessedPreviewMode(selectedMode);
    setMessage("Escolha uma imagem para visualizar o resultado.");
    setSourceStatus("Nenhuma imagem selecionada.");
    return;
  }

  if (showWorkingMessage) {
    setMessage("Processando imagem...", "info");
  }

  /*
   * Link externo em modo original/ajustado não precisa de CORS:
   * o navegador apenas exibe a imagem.
   */
  if (
    originalSourceType === "link" &&
    selectedMode !== "remove-white"
  ) {
    finalImageSource = originalSource;
    effectiveImageMode = selectedMode;
    imageProcessingStatus = "linked";

    setPreview(
      "giftOriginalPreview",
      "originalPreviewEmpty",
      originalSource
    );

    setPreview(
      "giftImagePreview",
      "processedPreviewEmpty",
      originalSource
    );

    updateProcessedPreviewMode(selectedMode);
    setMessage(
      selectedMode === "fit"
        ? "A imagem será centralizada sobre um fundo branco quente para se integrar ao card."
        : "A imagem será exibida sem remoção de fundo.",
      "success"
    );
    setSourceStatus("Imagem carregada por link.");
    return;
  }

  if (!sourceImage) {
    if (originalSourceType === "link") {
      try {
        sourceImage = await loadExternalImageForProcessing(
          originalSource
        );
      } catch (error) {
        $("giftImageMode").value = "fit";
        updateThresholdVisibility();

        finalImageSource = originalSource;
        effectiveImageMode = "fit";
        imageProcessingStatus = "cors-fallback";

        setPreview(
          "giftOriginalPreview",
          "originalPreviewEmpty",
          originalSource
        );

        setPreview(
          "giftImagePreview",
          "processedPreviewEmpty",
          originalSource
        );

        updateProcessedPreviewMode("fit");

        setMessage(
          "A loja bloqueou a leitura dos pixels desta imagem. Ela será ajustada ao card sem remover o fundo. Para remoção completa, faça o upload da imagem.",
          "warning"
        );

        setSourceStatus("Link externo com proteção CORS.");
        return;
      }
    } else {
      throw new Error(
        "A imagem de origem não está disponível. Selecione o arquivo novamente."
      );
    }
  }

  finalImageSource = processLoadedImage(
    sourceImage,
    selectedMode,
    threshold
  );

  effectiveImageMode = selectedMode;
  imageProcessingStatus =
    selectedMode === "remove-white"
      ? "background-removed"
      : "processed";

  setPreview(
    "giftOriginalPreview",
    "originalPreviewEmpty",
    originalSource
  );

  setPreview(
    "giftImagePreview",
    "processedPreviewEmpty",
    finalImageSource
  );

  updateProcessedPreviewMode(selectedMode);

  setMessage(
    selectedMode === "remove-white"
      ? "Fundo branco removido. Confira detalhes claros do produto antes de salvar."
      : selectedMode === "fit"
        ? "Imagem comprimida e ajustada ao fundo do card."
        : "Imagem comprimida sem remoção do fundo.",
    "success"
  );

  setSourceStatus(
    originalSourceType === "upload"
      ? "Imagem enviada por upload."
      : "Link processado com sucesso."
  );
}

async function useUploadedFile(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem válido.");
  }

  revokeSourceObjectUrl();
  sourceObjectUrl = URL.createObjectURL(file);
  sourceImage = await loadImageElement(sourceObjectUrl);

  /*
   * A prévia original usa o Object URL apenas durante a edição.
   * Somente a versão comprimida/processada é salva no Firestore.
   */
  originalSource = sourceObjectUrl;
  originalSourceType = "upload";
  $("giftImageUrl").value = "";

  await applyCurrentTreatment();
}

async function useImageLink() {
  const url = $("giftImageUrl").value.trim();

  if (!url) {
    throw new Error("Cole o link direto de uma imagem.");
  }

  try {
    new URL(url);
  } catch {
    throw new Error("Informe um link válido.");
  }

  revokeSourceObjectUrl();
  sourceImage = null;
  originalSource = url;
  originalSourceType = "link";
  $("giftImageFile").value = "";

  setPreview(
    "giftOriginalPreview",
    "originalPreviewEmpty",
    url
  );

  await applyCurrentTreatment();
}

function resetImageEditor() {
  revokeSourceObjectUrl();
  originalSource = "";
  originalSourceType = "";
  finalImageSource = "";
  sourceImage = null;
  effectiveImageMode = DEFAULT_IMAGE_MODE;
  imageProcessingStatus = "none";

  $("giftImageUrl").value = "";
  $("giftImageFile").value = "";
  $("giftImageMode").value = DEFAULT_IMAGE_MODE;
  $("giftImageThreshold").value = DEFAULT_THRESHOLD;
  $("giftThresholdValue").textContent = `${DEFAULT_THRESHOLD}%`;
  $("giftRemoveInternalWhite").checked = true;
  applyImageScalePreview(DEFAULT_IMAGE_SCALE);

  updateThresholdVisibility();
  updateProcessedPreviewMode(DEFAULT_IMAGE_MODE);

  setPreview("giftOriginalPreview", "originalPreviewEmpty", "");
  setPreview("giftImagePreview", "processedPreviewEmpty", "");
  setMessage("Escolha uma imagem para visualizar o resultado.");
  setSourceStatus("Nenhuma imagem selecionada.");
}

async function load() {
  const area = $("tableArea");
  area.innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const snapshot = await getDocs(
      query(collection(db, "presentes"), orderBy("nome"))
    );

    area.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Presente</th>
            <th>Categoria</th>
            <th>Valor</th>
            <th>Imagem</th>
            <th>Compra</th>
            <th>PIX</th>
            <th>Visível</th>
            <th>Ações</th>
          </tr>
        </thead>

        <tbody>
          ${
            snapshot.docs.map(documentSnapshot => {
              const gift = documentSnapshot.data();
              const imageMode = normalizeImageMode(
                gift.imageMode
              );

              return `
                <tr>
                  <td>
                    <strong>${esc(gift.nome)}</strong>
                    <br>
                    <small>${esc(gift.loja || "")}</small>
                  </td>

                  <td>${esc(gift.categoria)}</td>
                  <td>${money(gift.valorEstimado)}</td>

                  <td>
                    ${
                      gift.imagemUrl
                        ? `
                          <img
                            class="admin-gift-thumb"
                            src="${esc(gift.imagemUrl)}"
                            alt=""
                          >
                          <br>
                          <small>${esc(
                            imageMode === "remove-white"
                              ? "Fundo removido"
                              : imageMode === "fit"
                                ? "Ajustada"
                                : "Original"
                          )}</small>
                        `
                        : "Sem imagem"
                    }
                  </td>

                  <td>${esc(
                    gift.purchaseStatus || "disponivel"
                  )}</td>

                  <td>
                    ${esc(gift.pixStatus || "sem_contribuicao")}
                    <br>
                    <small>${money(gift.pixConfirmedTotal)}</small>
                  </td>

                  <td>${gift.visivelPublico ? "Sim" : "Não"}</td>

                  <td>
                    <button
                      class="btn btn-small btn-secondary"
                      data-edit="${documentSnapshot.id}"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              `;
            }).join("") ||
            '<tr><td colspan="8">Nenhum presente.</td></tr>'
          }
        </tbody>
      </table>
    `;

    area.querySelectorAll("[data-edit]").forEach(button => {
      button.addEventListener("click", () => {
        edit(button.dataset.edit);
      });
    });
  } catch (error) {
    area.innerHTML = `
      <div class="notice danger">
        ${esc(error.message)}
      </div>
    `;
  }
}

function close() {
  $("giftModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  revokeSourceObjectUrl();
}

async function edit(id) {
  const snapshot = await getDoc(doc(db, "presentes", id));

  if (snapshot.exists()) {
    open(id, snapshot.data());
  }
}

function open(id = "", gift = {}) {
  $("giftForm").reset();
  resetImageEditor();

  $("giftId").value = id;
  $("giftModalTitle").textContent =
    id ? "Editar presente" : "Novo presente";

  $("giftName").value = gift.nome || "";
  $("giftCategory").value = gift.categoria || "";
  $("giftValue").value = gift.valorEstimado ?? "";
  $("giftStore").value = gift.loja || "";
  $("giftLink").value = gift.linkCompra || "";
  $("giftActive").checked = gift.ativo ?? true;
  $("giftVisible").checked = gift.visivelPublico ?? true;

  const savedImage = gift.imagemUrl || "";
  const savedOriginal = gift.imagemOriginalUrl || "";
  const savedSourceType =
    gift.imageSourceType ||
    (savedImage.startsWith("data:") ? "upload" : "link");

  $("giftImageMode").value = normalizeImageMode(
    gift.imageMode
  );

  $("giftImageThreshold").value =
    Number(gift.imageThreshold) || DEFAULT_THRESHOLD;

  $("giftThresholdValue").textContent =
    `${$("giftImageThreshold").value}%`;

  $("giftRemoveInternalWhite").checked =
    gift.imageRemoveInternalWhite ?? true;

  applyImageScalePreview(
    gift.imageScale ?? DEFAULT_IMAGE_SCALE
  );

  effectiveImageMode = normalizeImageMode(gift.imageMode);
  imageProcessingStatus =
    gift.imageProcessingStatus || (savedImage ? "saved" : "none");

  finalImageSource = savedImage;
  originalSource =
    savedSourceType === "link"
      ? (savedOriginal || savedImage)
      : savedImage;

  originalSourceType = savedSourceType;

  if (savedSourceType === "link") {
    $("giftImageUrl").value = savedOriginal || savedImage;
  }

  setPreview(
    "giftOriginalPreview",
    "originalPreviewEmpty",
    originalSource
  );

  setPreview(
    "giftImagePreview",
    "processedPreviewEmpty",
    savedImage
  );

  updateThresholdVisibility();
  updateProcessedPreviewMode(effectiveImageMode);

  if (savedImage) {
    setMessage(
      savedSourceType === "upload"
        ? "Imagem salva carregada. Para refazer a remoção a partir do arquivo original, envie o arquivo novamente."
        : "Imagem salva carregada. Você pode alterar o tratamento e processar novamente.",
      "info"
    );

    setSourceStatus(
      savedSourceType === "upload"
        ? "Imagem salva por upload."
        : "Imagem salva por link."
    );
  }

  $("giftFormMessage").classList.add("hidden");
  $("giftModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

bootstrapPage({
  permission: "presentes",

  onReady: async () => {
    await load();

    $("reloadButton").addEventListener("click", load);
    $("newGiftButton").addEventListener("click", () => open());

    document.querySelectorAll("[data-close-modal]").forEach(button => {
      button.addEventListener("click", close);
    });

    $("giftModal").addEventListener("click", event => {
      if (event.target === $("giftModal")) close();
    });

    $("processImageUrlButton").addEventListener(
      "click",
      async () => {
        const button = $("processImageUrlButton");
        button.disabled = true;
        button.textContent = "Carregando...";

        try {
          await useImageLink();
        } catch (error) {
          setMessage(error.message, "danger");
        } finally {
          button.disabled = false;
          button.textContent = "Carregar e testar link";
        }
      }
    );

    $("giftImageFile").addEventListener(
      "change",
      async event => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
          setMessage("Carregando arquivo...", "info");
          await useUploadedFile(file);
        } catch (error) {
          setMessage(error.message, "danger");
        }
      }
    );

    $("giftImageMode").addEventListener(
      "change",
      async () => {
        try {
          await applyCurrentTreatment();
        } catch (error) {
          setMessage(error.message, "danger");
        }
      }
    );

    $("giftImageScale").addEventListener(
      "input",
      () => {
        applyImageScalePreview(
          $("giftImageScale").value
        );
      }
    );

    $("giftRemoveInternalWhite").addEventListener(
      "change",
      async () => {
        if ($("giftImageMode").value !== "remove-white") return;

        try {
          await applyCurrentTreatment();
        } catch (error) {
          setMessage(error.message, "danger");
        }
      }
    );

    $("giftImageThreshold").addEventListener(
      "input",
      () => {
        const value = $("giftImageThreshold").value;
        $("giftThresholdValue").textContent = `${value}%`;

        window.clearTimeout(imageProcessingTimer);
        imageProcessingTimer = window.setTimeout(async () => {
          if ($("giftImageMode").value !== "remove-white") return;

          try {
            await applyCurrentTreatment({
              showWorkingMessage: false
            });
          } catch (error) {
            setMessage(error.message, "danger");
          }
        }, 180);
      }
    );

    $("restoreOriginalImageButton").addEventListener(
      "click",
      async () => {
        $("giftImageMode").value = "original";
        updateThresholdVisibility();

        try {
          await applyCurrentTreatment();
        } catch (error) {
          setMessage(error.message, "danger");
        }
      }
    );

    $("giftForm").addEventListener("submit", async event => {
      event.preventDefault();

      const message = $("giftFormMessage");

      try {
        if (
          originalSource &&
          !finalImageSource
        ) {
          await applyCurrentTreatment();
        }

        const id =
          $("giftId").value ||
          `presente-${crypto.randomUUID()}`;

        const savedOriginalUrl =
          originalSourceType === "link"
            ? originalSource
            : "";

        await setDoc(
          doc(db, "presentes", id),
          {
            nome: $("giftName").value.trim(),
            categoria: $("giftCategory").value.trim(),
            valorEstimado: Number($("giftValue").value),
            loja: $("giftStore").value.trim(),
            linkCompra: $("giftLink").value.trim(),

            imagemUrl: finalImageSource || "",
            imagemOriginalUrl: savedOriginalUrl,
            imageMode: effectiveImageMode,
            imageThreshold: Number(
              $("giftImageThreshold").value
            ),
            imageRemoveInternalWhite:
              $("giftRemoveInternalWhite").checked,
            imageScale: normalizeImageScale(
              $("giftImageScale").value
            ),
            imageSourceType: originalSourceType || "",
            imageProcessingStatus,

            quantidade: 1,
            ativo: $("giftActive").checked,
            visivelPublico: $("giftVisible").checked,

            purchaseStatus: "disponivel",
            pixStatus: "sem_contribuicao",
            pixConfirmedTotal: 0,
            pixOverflowTotal: 0,
            reservationId: null,
            reservedByUid: null,
            reservationExpiresAt: null,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

        toast("Presente salvo");
        close();
        await load();
      } catch (error) {
        message.className = "notice danger";
        message.textContent = error.message;
        message.classList.remove("hidden");
      }
    });
  }
});
