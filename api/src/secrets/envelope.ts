import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Envelope encryption for one field value.
// A random data key (DEK) encrypts the value. The key encryption key (KEK) wraps the DEK.
// The stored object carries the key id so a keyring can decrypt it later.

export type Envelope = {
  v: 1;
  kid: string;
  iv: string;      // base64, 12 bytes, for the value
  tag: string;     // base64, 16 bytes, for the value
  dek_enc: string; // base64, iv(12) || tag(16) || wrapped DEK, for the DEK
  ct: string;      // base64 ciphertext of the value
};

const IV_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32;

function assertKek(kek: Buffer): void {
  if (kek.length !== DEK_LEN) throw new Error("KEK must be 32 bytes");
}

/** Encrypts one string value. A fresh DEK is used for each call. */
export function encryptField(plain: string, kek: Buffer, keyId: string): Envelope {
  assertKek(kek);
  if (keyId.length === 0) throw new Error("key id is required");
  const dek = randomBytes(DEK_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const wrapIv = randomBytes(IV_LEN);
  const wrap = createCipheriv("aes-256-gcm", kek, wrapIv);
  const wrapped = Buffer.concat([wrap.update(dek), wrap.final()]);
  const wrapTag = wrap.getAuthTag();

  return {
    v: 1,
    kid: keyId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    dek_enc: Buffer.concat([wrapIv, wrapTag, wrapped]).toString("base64"),
    ct: ct.toString("base64"),
  };
}

/** Decrypts one envelope. Throws when the key id is unknown or the data was changed. */
export function decryptField(obj: Envelope, keyring: Map<string, Buffer>): string {
  if (!obj || obj.v !== 1) throw new Error("unsupported envelope version");
  const kek = keyring.get(obj.kid);
  if (!kek) throw new Error(`unknown key id: ${obj.kid}`);
  assertKek(kek);

  const wrapped = Buffer.from(obj.dek_enc, "base64");
  if (wrapped.length !== IV_LEN + TAG_LEN + DEK_LEN) throw new Error("bad wrapped key");
  const wrapIv = wrapped.subarray(0, IV_LEN);
  const wrapTag = wrapped.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const dekCt = wrapped.subarray(IV_LEN + TAG_LEN);
  const unwrap = createDecipheriv("aes-256-gcm", kek, wrapIv);
  unwrap.setAuthTag(wrapTag);
  const dek = Buffer.concat([unwrap.update(dekCt), unwrap.final()]);

  const iv = Buffer.from(obj.iv, "base64");
  const tag = Buffer.from(obj.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(obj.ct, "base64")), decipher.final()]).toString("utf8");
}

/** True when the value looks like an envelope object. */
export function isEnvelope(v: unknown): v is Envelope {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.v === 1 && typeof o.kid === "string" && typeof o.iv === "string" && typeof o.tag === "string" && typeof o.dek_enc === "string" && typeof o.ct === "string";
}

export type KidPolicy = { activeKid: string; previousKids: string[]; graceUntil?: Date | undefined };

/**
 * Decides if a key id may decrypt now. The active key always can.
 * A previous key can only while the grace window is open.
 */
export function assertKidUsable(policy: KidPolicy, kid: string, now: Date): void {
  if (kid === policy.activeKid) return;
  if (policy.previousKids.includes(kid)) {
    if (policy.graceUntil && now.getTime() < policy.graceUntil.getTime()) return;
    throw new Error(`key ${kid} is refused: the grace window ended`);
  }
  throw new Error(`unknown key id: ${kid}`);
}
