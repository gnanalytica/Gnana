import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { logger } from "../logger.js";

const encryptionLog = logger.child({ module: "encryption" });

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

let _derivedKey: Buffer | null = null;
let _warned = false;

/**
 * Derive a 256-bit key from the ENCRYPTION_KEY env var using scrypt.
 * If the env var is a 64-char hex string (32 bytes), it is used directly.
 * Returns null if ENCRYPTION_KEY is not set.
 */
function getKey(): Buffer | null {
  if (_derivedKey) return _derivedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (!_warned) {
      encryptionLog.warn(
        "ENCRYPTION_KEY not set — credentials will be stored in plaintext. Set ENCRYPTION_KEY in production.",
      );
      _warned = true;
    }
    return null;
  }

  // If it looks like a 32-byte hex string, use directly
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    _derivedKey = Buffer.from(raw, "hex");
  } else {
    // Derive key using scrypt with a fixed salt (deterministic per key)
    // The salt is fixed so we can decrypt later without storing it separately
    const salt = "gnana-encryption-salt";
    _derivedKey = scryptSync(raw, salt, KEY_LENGTH);
  }

  return _derivedKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns the format: `iv:authTag:ciphertext` (all hex encoded).
 * If ENCRYPTION_KEY is not set, returns the plaintext unchanged (dev fallback).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string produced by `encrypt()`.
 * If the input doesn't look like an encrypted value (no `:` separators),
 * it is returned as-is (supports legacy plaintext values).
 */
export function decrypt(encryptedValue: string): string {
  const key = getKey();
  if (!key) return encryptedValue;

  // If it doesn't match the iv:tag:ciphertext format, treat as legacy plaintext
  const parts = encryptedValue.split(":");
  if (parts.length !== 3) return encryptedValue;

  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];

  // Validate hex lengths: IV=12 bytes=24 hex chars, authTag=16 bytes=32 hex chars
  if (ivHex.length !== IV_LENGTH * 2 || authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    return encryptedValue;
  }

  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    encryptionLog.error("Failed to decrypt value — returning empty string to avoid leaking ciphertext");
    return "";
  }
}

/**
 * Encrypt a credentials JSON object. Serializes to JSON string, then encrypts.
 * If ENCRYPTION_KEY is not set, returns the original object unchanged.
 */
export function encryptJson(value: unknown): unknown {
  const key = getKey();
  if (!key) return value;

  const json = JSON.stringify(value);
  return encrypt(json);
}

/**
 * Decrypt a credentials value. If it's a string (encrypted), decrypts and parses as JSON.
 * If it's already an object (legacy plaintext jsonb), returns as-is.
 */
export function decryptJson(value: unknown): unknown {
  const key = getKey();
  if (!key) return value;

  // Already an object — legacy unencrypted jsonb value
  if (typeof value !== "string") return value;

  const decrypted = decrypt(value);
  try {
    return JSON.parse(decrypted) as unknown;
  } catch {
    // If it's not valid JSON after decryption, return as-is
    return decrypted;
  }
}
