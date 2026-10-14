// Fotos ZIP: rep un ZIP de fotos des de l'app (fotos-zip.vercel.app) i l'envia per correu
// des del Gmail del club (les mateixes variables que api/print.js: GMAIL_USER i GMAIL_APP_PASSWORD).
// El destinatari és fix, així aquest endpoint no es pot fer servir per enviar correus a ningú més.
const nodemailer = require("nodemailer");

const TO = "ipuigl@bcn.cat";
const ORIGINS = ["https://fotos-zip.vercel.app", "https://cartell-cbm.vercel.app"];
const MAX_BYTES = 4.4 * 1024 * 1024; // Vercel accepta com a màxim 4,5 MB per petició

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o))) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}
async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BYTES) throw Object.assign(new Error("too_large"), { code: "too_large" }); chunks.push(c); }
  return Buffer.concat(chunks);
}
const clean = (s, max) => String(s || "").replace(/[\r\n\t]+/g, " ").slice(0, max).trim();

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (req.method === "GET") return res.status(200).json({ ok: !!(user && pass), from: user || null, to: TO, maxBytes: Math.floor(MAX_BYTES) });
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ ok: false, error: "method" }); }
  if (!user || !pass) return res.status(503).json({ ok: false, error: "not_configured" });

  let zip;
  try { zip = await rawBody(req); } catch (e) { return res.status(413).json({ ok: false, error: "too_large" }); }
  if (!zip.length || zip.length > MAX_BYTES || zip.readUInt32LE(0) !== 0x04034b50) return res.status(400).json({ ok: false, error: "bad_zip" });

  const q = req.query || {};
  const name = /^[^\\/:*?"<>|]{1,120}\.zip$/.test(q.nom || "") ? q.nom : "fotos.zip";
  const subject = clean(q.assumpte, 150) || name.replace(/\.zip$/, "");
  const text = String(q.text || "").slice(0, 2000);

  try {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
    await transport.sendMail({
      from: `"CB Monforte" <${user}>`, to: TO, subject, text,
      attachments: [{ filename: name, content: zip, contentType: "application/zip" }],
    });
    return res.status(200).json({ ok: true, from: user, to: TO });
  } catch (e) {
    const auth = e && (e.code === "EAUTH" || e.responseCode === 535);
    return res.status(502).json({ ok: false, error: auth ? "auth" : "send_failed" });
  }
};

// El ZIP arriba en brut (application/octet-stream); no cal que Vercel l'interpreti
module.exports.config = { api: { bodyParser: false } };
