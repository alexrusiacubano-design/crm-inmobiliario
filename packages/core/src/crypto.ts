import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado de campos sensibles (p. ej. número de cuenta bancaria) con AES-256-GCM.
 * Formato guardado: "v1.<iv>.<tag>.<ciphertext>" en base64url. La clave vive solo en el
 * servidor (FIELD_ENCRYPTION_KEY, 32 bytes en base64) y nunca llega al navegador.
 */

function getKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEY no está configurada: no se pueden guardar datos cifrados");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY debe tener 32 bytes en base64");
  return key;
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(
    ".",
  );
}

export function decryptField(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Formato de dato cifrado desconocido");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
