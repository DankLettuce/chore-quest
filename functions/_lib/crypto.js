const enc = new TextEncoder();
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

export async function sha256Hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

export function randomHex(bytes = 32) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }

export const PBKDF2_ITER = 100000; // Workers caps PBKDF2 at 100k iterations

export async function hashPin(pin, saltHex = randomHex(16), iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${saltHex}$${hex(bits)}`;
}

export async function verifyPin(pin, stored) {
  if (!stored) return false;
  const [, iter, salt, want] = stored.split('$');
  const got = (await hashPin(pin, salt, +iter)).split('$')[3];
  return timingSafeEq(got, want);
}

export function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// The family key, sealed with the parent PIN (AES-GCM, PBKDF2-SHA256 derived key), so a
// parent can unlock a new device with just the PIN. Format: v1$<salt>$<iv>$<ciphertext>
async function pinAesKey(pin, saltHex) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: PBKDF2_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealKey(familyKey, pin) {
  const salt = randomHex(16), iv = randomHex(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: unhex(iv) }, await pinAesKey(pin, salt), enc.encode(familyKey));
  return `v1$${salt}$${iv}$${hex(ct)}`;
}
export async function openKey(sealed, pin) {
  if (!sealed) return null;
  const [v, salt, iv, ct] = sealed.split('$');
  if (v !== 'v1') return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv) }, await pinAesKey(pin, salt), unhex(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
