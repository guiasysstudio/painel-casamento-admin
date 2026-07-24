const PIX_KEY_TYPES = [
  "aleatoria",
  "telefone",
  "email",
  "cpf",
  "cnpj"
];

function removeAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitize(value, maxLength) {
  return removeAccents(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 $%*+\-./:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function byteLength(value) {
  return new TextEncoder().encode(String(value)).length;
}

function tlv(id, value) {
  const text = String(value);
  const length = byteLength(text);

  if (length > 99) {
    throw new Error(
      `O campo PIX ${id} ultrapassou o tamanho permitido.`
    );
  }

  return `${id}${String(length).padStart(2, "0")}${text}`;
}

function crc16(payload) {
  let crc = 0xffff;

  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000
        ? (crc << 1) ^ 0x1021
        : crc << 1;

      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePixKey(keyType, rawKey) {
  const type = PIX_KEY_TYPES.includes(keyType)
    ? keyType
    : "aleatoria";

  const key = String(rawKey || "").trim();

  if (!key) {
    throw new Error("Informe a chave PIX.");
  }

  if (type === "telefone") {
    const number = digits(key);

    if (number.length === 10 || number.length === 11) {
      return `+55${number}`;
    }

    if (
      (number.length === 12 || number.length === 13) &&
      number.startsWith("55")
    ) {
      return `+${number}`;
    }

    throw new Error(
      "Informe um telefone PIX válido com DDD."
    );
  }

  if (type === "email") {
    const email = key.toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Informe um e-mail PIX válido.");
    }

    return email;
  }

  if (type === "cpf") {
    const cpf = digits(key);

    if (cpf.length !== 11) {
      throw new Error("O CPF da chave PIX deve ter 11 números.");
    }

    return cpf;
  }

  if (type === "cnpj") {
    const cnpj = digits(key);

    if (cnpj.length !== 14) {
      throw new Error("O CNPJ da chave PIX deve ter 14 números.");
    }

    return cnpj;
  }

  if (key.length > 77) {
    throw new Error("A chave PIX informada é muito longa.");
  }

  return key;
}

export function normalizePixConfig(config = {}) {
  const keyType = PIX_KEY_TYPES.includes(config.keyType)
    ? config.keyType
    : "aleatoria";

  const key = normalizePixKey(keyType, config.key);
  const holderName = sanitize(config.holderName, 25);
  const city = sanitize(config.city, 15);
  const description = sanitize(
    config.description || "PRESENTE DE CASAMENTO",
    72
  );

  if (holderName.length < 2) {
    throw new Error("Informe o nome do titular do PIX.");
  }

  if (city.length < 2) {
    throw new Error("Informe a cidade do titular do PIX.");
  }

  return {
    keyType,
    key,
    holderName,
    city,
    description,
    active: config.active === true
  };
}

export function buildPixPayload({
  key,
  name,
  city,
  amount,
  description = "",
  txid = "***"
}) {
  const normalizedKey = String(key || "").trim();

  if (!normalizedKey) {
    throw new Error("A chave PIX não foi configurada.");
  }

  const normalizedName = sanitize(name, 25);
  const normalizedCity = sanitize(city, 15);
  const normalizedDescription = sanitize(description, 72);
  const normalizedTxid =
    txid === "***"
      ? "***"
      : sanitize(txid, 25).replace(/[^A-Z0-9]/g, "");

  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Informe um valor PIX válido.");
  }

  const merchantAccount =
    tlv("00", "BR.GOV.BCB.PIX") +
    tlv("01", normalizedKey) +
    (
      normalizedDescription
        ? tlv("02", normalizedDescription)
        : ""
    );

  let payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", value.toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", normalizedName) +
    tlv("60", normalizedCity) +
    tlv(
      "62",
      tlv("05", normalizedTxid || "***")
    ) +
    "6304";

  return payload + crc16(payload);
}

export function validatePixPayload(payload) {
  const text = String(payload || "").trim();

  if (
    text.length < 20 ||
    !text.includes("BR.GOV.BCB.PIX") ||
    !/6304[0-9A-F]{4}$/.test(text)
  ) {
    return false;
  }

  const withoutCrc = text.slice(0, -4);
  const receivedCrc = text.slice(-4);

  return crc16(withoutCrc) === receivedCrc;
}

export function formatPixKey(keyType, key) {
  const normalized = normalizePixKey(keyType, key);

  if (keyType === "cpf") {
    return normalized.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      "$1.$2.$3-$4"
    );
  }

  if (keyType === "cnpj") {
    return normalized.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }

  return normalized;
}
