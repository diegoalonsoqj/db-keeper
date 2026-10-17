import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "../src/lib/totp.js";

// Vector de la RFC 6238 (SHA-1): secreto ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("base32 ida y vuelta", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("coincide con la RFC 6238", () => {
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("acepta ±30 s de desfase y nada más", () => {
    const now = 1111111109_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", null, now)).toBeNull();
  });

  it("un código ya usado no vale otra vez", () => {
    const now = 1111111109_000;
    const step = Math.floor(now / 30_000);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, step - 1, now)).toBe(step);
  });

  it("URI para la app", () => {
    const uri = otpauthUri("ABC", "admin", "DBKeeper");
    expect(uri).toMatch(/^otpauth:\/\/totp\/DBKeeper%3Aadmin\?/);
    expect(uri).toContain("secret=ABC");
    expect(uri).toContain("issuer=DBKeeper");
  });
});

describe("códigos de recuperación", () => {
  it("formato, sin repetidos y hash tolerante a guion/minúsculas", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(hashRecoveryCode("k7pq m2xd")).toBe(hashRecoveryCode("K7PQ-M2XD"));
  });
});
