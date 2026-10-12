import { describe, expect, it } from "vitest";
import { describeGcpError } from "../src/lib/gcp-error.js";

describe("describeGcpError", () => {
  it("usa el mensaje estructurado de la API", () => {
    const r = describeGcpError({ message: "x", response: { status: 403, data: { error: { message: "denied" } } } }, "{}");
    expect(r).toEqual({ status: 403, message: "denied", authHint: "" });
  });

  it("lee error/error_description del endpoint OAuth", () => {
    const r = describeGcpError(
      { message: "x", response: { status: 400, data: { error: "invalid_grant", error_description: "Invalid JWT" } } },
      "{}",
    );
    expect(r.message).toBe("invalid_grant: Invalid JWT");
  });

  it("401 con clave JSON: pista de clave revocada", () => {
    const r = describeGcpError({ message: "unauthorized", response: { status: 401, data: "" } }, "{}");
    expect(r.message).toBe("unauthorized");
    expect(r.authHint).toMatch(/clave/);
  });

  it("401 sin clave (ADC / cuenta de la VM): pista de metadatos", () => {
    const r = describeGcpError(
      { message: "Could not refresh access token: Request failed with status code 401", response: { status: 401 } },
      null,
    );
    expect(r.authHint).toMatch(/NO_PROXY/);
  });

  it("error sin respuesta HTTP", () => {
    expect(describeGcpError(new Error("ECONNRESET"), null)).toEqual({ status: null, message: "ECONNRESET", authHint: "" });
  });
});
