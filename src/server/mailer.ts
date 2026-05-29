import nodemailer from "nodemailer";

// Transport SMTP (Nodemailer) — remplace PHPMailer.
// Variables d'env : SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM
export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT ?? 587) === 465,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    : undefined,
});

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
  return mailer.sendMail({
    from: process.env.SMTP_FROM ?? "CultuRésa <no-reply@example.com>",
    ...opts,
  });
}
