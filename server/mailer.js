import nodemailer from "nodemailer";

export function createMailer(env = process.env) {
  const hasSmtp = Boolean(env.SMTP_HOST);
  const appUrl =
    env.APP_URL ||
    (env.NODE_ENV === "production" ? `http://localhost:${env.PORT || 3001}` : "http://localhost:5173");

  const transporter = hasSmtp
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        secure: String(env.SMTP_SECURE || "false") === "true",
        auth: env.SMTP_USER
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASS
            }
          : undefined
      })
    : null;

  async function sendVerificationEmail(email, token) {
    const url = `${appUrl}/api/auth/verify?token=${token}`;
    const message = {
      from: env.SMTP_FROM || "Live to see it <no-reply@example.com>",
      to: email,
      subject: "Подтвердите вход в Live to see it",
      text: `Нажмите на ссылку, чтобы подтвердить почту: ${url}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h1>Live to see it</h1>
          <p>Подтвердите почту, чтобы войти в игру.</p>
          <p><a href="${url}">Подтвердить почту</a></p>
        </div>
      `
    };

    if (!transporter) {
      console.log(`[dev email] Verification link for ${email}: ${url}`);
      return { devUrl: url };
    }

    await transporter.sendMail(message);
    return { devUrl: null };
  }

  return { sendVerificationEmail };
}
