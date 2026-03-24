import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export async function sendPasswordResetEmail(email: string, token: string, name?: string | null) {
  const resetUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/auth/reset-password?token=${token}`;

  await getResend().emails.send({
    from: "Gnana <noreply@gnanalytica.com>",
    to: email,
    subject: "Reset your password",
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #18181b;">Reset your password</h2>
        <p>Hi${name ? ` ${name}` : ""},</p>
        <p>We received a request to reset your password. Click the button below to choose a new one:</p>
        <a href="${resetUrl}" style="display: inline-block; background: #18181b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">Reset Password</a>
        <p style="color: #71717a; font-size: 14px;">This link expires in 1 hour. If you didn&apos;t request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
        <p style="color: #a1a1aa; font-size: 12px;">Gnana — AI Agent Platform</p>
      </div>
    `,
  });
}

export async function sendInviteEmail(
  email: string,
  workspaceName: string,
  inviterName: string,
  token: string,
  role: string,
) {
  const inviteUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/invite/${token}`;

  await getResend().emails.send({
    from: "Gnana <noreply@gnanalytica.com>",
    to: email,
    subject: `You're invited to ${workspaceName} on Gnana`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #18181b;">You're invited!</h2>
        <p>${inviterName} has invited you to join <strong>${workspaceName}</strong> as a <strong>${role}</strong>.</p>
        <a href="${inviteUrl}" style="display: inline-block; background: #18181b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">Accept Invite</a>
        <p style="color: #71717a; font-size: 14px;">This invite expires in 7 days.</p>
        <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
        <p style="color: #a1a1aa; font-size: 12px;">Gnana — AI Agent Platform</p>
      </div>
    `,
  });
}
