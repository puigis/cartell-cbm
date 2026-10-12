// Sends the black-and-white communiqué PDF to the club's print mailbox.
// Recipients and subject are fixed here, so this endpoint cannot be used to mail anyone else.
// Needs two environment variables in Vercel: GMAIL_USER and GMAIL_APP_PASSWORD.
const nodemailer = require("nodemailer");

const TO = "monfortebillares@gmail.com";
const CC = "puigis@msn.com";
const SUBJECT = "per imprimir - Isaac";
const MAX_BYTES = 3 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method" }); }
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return res.status(503).json({ error: "not_configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const b64 = body && typeof body.pdf === "string" ? body.pdf : "";
  const pdf = Buffer.from(b64, "base64");
  if (!pdf.length || pdf.length > MAX_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") return res.status(400).json({ error: "bad_pdf" });
  const name = (body.filename && /^[\w.-]{1,80}\.pdf$/.test(body.filename)) ? body.filename : "comunicat.pdf";

  try {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
    await transport.sendMail({
      from: `"CB Monforte" <${user}>`, to: TO, cc: CC, subject: SUBJECT, text: "",
      attachments: [{ filename: name, content: pdf, contentType: "application/pdf" }],
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    const auth = e && (e.code === "EAUTH" || e.responseCode === 535);
    return res.status(502).json({ error: auth ? "auth" : "send_failed" });
  }
};
