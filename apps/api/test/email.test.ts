import { describe, expect, it } from "vitest";
import { buildApiBody, parseAddress } from "../src/modules/notifications/email.js";
import { renderEmail } from "../src/modules/notifications/email-template.js";

describe("renderEmail", () => {
  const html = renderEmail({
    tone: "danger",
    status: "Con errores",
    title: "Backup con errores: <script>x</script>",
    rows: [{ label: "Motor", value: "PostgreSQL" }],
    details: [{ name: "ventas", ok: false, info: 'error "<timeout>"' }],
    sentAt: "11 oct 2026, 18:10",
  });

  it("escapa los valores dinámicos", () => {
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("error &quot;&lt;timeout&gt;&quot;");
  });

  it("incluye estado, resumen y detalle, sin emojis", () => {
    expect(html).toContain("Con errores");
    expect(html).toContain("PostgreSQL");
    expect(html).toContain("Detalle por base de datos");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

const cfg = {
  enabled: true,
  provider: "api" as const,
  from: "Notificaciones <no-reply@empresa.com>",
  recipients: ["a@empresa.com", "b@empresa.com"],
  smtp: { host: "", port: 587, secure: false, user: "", password: null },
  api: { url: "https://api.example.com/v1/notify/email", title: "DBKeeper", authHeader: "Authorization", auth: null },
};
const msg = { subject: "Backup OK", text: "texto", html: "<p>html</p>" };

describe("parseAddress", () => {
  it("separa nombre y correo", () => {
    expect(parseAddress("Notificaciones <no-reply@empresa.com>")).toEqual({ name: "Notificaciones", email: "no-reply@empresa.com" });
    expect(parseAddress('"Equipo DBA" <dba@empresa.com>')).toEqual({ name: "Equipo DBA", email: "dba@empresa.com" });
  });

  it("sin <…> todo es el correo", () => {
    expect(parseAddress(" no-reply@empresa.com ")).toEqual({ name: "", email: "no-reply@empresa.com" });
  });
});

describe("buildApiBody", () => {
  it("notify: title, htmlContent y direcciones como objetos", () => {
    const body = buildApiBody(cfg, msg);
    expect(body).toEqual({
      title: "DBKeeper",
      subject: "Backup OK",
      htmlContent: "<p>html</p>",
      from: { name: "Notificaciones", email: "no-reply@empresa.com" },
      to: [{ email: "a@empresa.com" }, { email: "b@empresa.com" }],
    });
  });

  it("notify: sin nombre en el from usa el título", () => {
    const body = buildApiBody({ ...cfg, from: "no-reply@empresa.com" }, msg);
    expect(body.from).toEqual({ name: "DBKeeper", email: "no-reply@empresa.com" });
  });
});
