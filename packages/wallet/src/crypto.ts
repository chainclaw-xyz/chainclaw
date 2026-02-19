import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedData {
  ciphertext: string; // hex
  iv: string; // hex
  salt: string; // hex
  authTag: string; // hex
}

export function encrypt(plaintext: string, password: string): EncryptedData {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decrypt(data: EncryptedData, password: string): string {
  const salt = Buffer.from(data.salt, "hex");
  const key = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const iv = Buffer.from(data.iv, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(data.authTag, "hex"));

  let plaintext = decipher.update(data.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");
  return plaintext;
}
