import { describe, expect, it } from "vitest";
import { isWireVersionTooLow } from "../src/modules/databases/discovery/mongo.js";

describe("isWireVersionTooLow", () => {
  it("detecta el error de servidor demasiado viejo (MongoDB 3.6)", () => {
    const err = new Error(
      "Server at db:27017 reports maximum wire version 6, but this version of the Node.js Driver requires at least 8 (MongoDB 4.2)",
    );
    expect(isWireVersionTooLow(err)).toBe(true);
  });

  it("detecta la variante de selección de servidor y la causa anidada", () => {
    const msg = "Server at db:27017 reports wire version 6, but this version of the driver requires at least 8 (MongoDB 4.2).";
    expect(isWireVersionTooLow(new Error(msg))).toBe(true);
    expect(isWireVersionTooLow(new Error("Server selection timed out", { cause: new Error(msg) }))).toBe(true);
  });

  it("no aplica al caso inverso (servidor demasiado nuevo)", () => {
    const msg = "Server at db:27017 reports minimum wire version 30, but this version of the Node.js Driver requires at most 27";
    expect(isWireVersionTooLow(new Error(msg))).toBe(false);
  });

  it("no confunde otros errores de conexión", () => {
    expect(isWireVersionTooLow(new Error("Authentication failed."))).toBe(false);
    expect(isWireVersionTooLow("reports maximum wire version 6")).toBe(false);
  });
});
