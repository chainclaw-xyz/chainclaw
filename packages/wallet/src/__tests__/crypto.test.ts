import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../crypto.js";

describe("encrypt/decrypt", () => {
  const password = "testpassword123";

  it("encrypts and decrypts a string correctly", () => {
    const plaintext = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const encrypted = encrypt(plaintext, password);
    const decrypted = decrypt(encrypted, password);

    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random salt/iv)", () => {
    const plaintext = "hello world";
    const enc1 = encrypt(plaintext, password);
    const enc2 = encrypt(plaintext, password);

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(enc1.salt).not.toBe(enc2.salt);
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  it("fails to decrypt with wrong password", () => {
    const plaintext = "secret data";
    const encrypted = encrypt(plaintext, password);

    expect(() => decrypt(encrypted, "wrongpassword")).toThrow();
  });

  it("fails to decrypt with tampered ciphertext", () => {
    const plaintext = "secret data";
    const encrypted = encrypt(plaintext, password);

    encrypted.ciphertext = "00" + encrypted.ciphertext.slice(2);

    expect(() => decrypt(encrypted, password)).toThrow();
  });

  it("returns hex strings for all encrypted fields", () => {
    const encrypted = encrypt("test", password);

    expect(encrypted.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(encrypted.iv).toMatch(/^[0-9a-f]+$/);
    expect(encrypted.salt).toMatch(/^[0-9a-f]+$/);
    expect(encrypted.authTag).toMatch(/^[0-9a-f]+$/);
  });
});
