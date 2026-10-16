import nodemailer from 'nodemailer';

/**
 * Brevo / Custom SMTP Transporter
 * Mirrors Laravel's send_email_template helper from openaid_laravel
 */
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.MAIL_PORT || 587),
  secure: false, // TLS on port 587
  auth: {
    user: process.env.MAIL_USER || 'b9b6ae001@smtp-brevo.com',
    pass: process.env.MAIL_PASS || 'bskax6tOde2aKxc',
  },
  tls: {
    rejectUnauthorized: false,
  },
});

export interface SendResetEmailOptions {
  to: string;
  name?: string;
  resetLink: string;
  role?: 'admin' | 'user';
}

/**
 * Sends a branded password reset email (HTML + text fallback)
 */
export async function sendPasswordResetEmail(options: SendResetEmailOptions): Promise<boolean> {
  const { to, name = 'Administrator', resetLink, role = 'admin' } = options;
  const fromName = process.env.MAIL_FROM_NAME || 'OpenAid International';
  const fromAddress = process.env.MAIL_FROM || 'info@openaidinternational.com';

  const portalTitle = role === 'admin' ? 'Backoffice Administration' : 'Member Portal';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password - ${fromName}</title>
      <style>
        body { margin: 0; padding: 0; background-color: #03150D; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FFFFFF; }
        .container { max-width: 600px; margin: 40px auto; background-color: #072619; border: 1px solid rgba(212, 167, 44, 0.25); border-radius: 16px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #0B3B27 0%, #03150D 100%); padding: 32px; text-align: center; border-bottom: 1px solid rgba(212, 167, 44, 0.15); }
        .logo-box { display: inline-block; background-color: #000; border: 2px solid #D4A72C; color: #D4A72C; font-weight: 900; font-size: 20px; padding: 8px 18px; border-radius: 10px; letter-spacing: 2px; }
        .content { padding: 40px 32px; }
        h1 { color: #FFFFFF; font-size: 22px; font-weight: 800; margin-top: 0; margin-bottom: 16px; }
        p { color: rgba(255, 255, 255, 0.75); font-size: 15px; line-height: 1.6; margin: 0 0 20px 0; }
        .btn-box { text-align: center; margin: 35px 0; }
        .btn { display: inline-block; background: linear-gradient(90deg, #D4A72C 0%, #F2C14E 100%); color: #000000 !important; text-decoration: none; font-weight: 900; font-size: 15px; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 20px rgba(212, 167, 44, 0.25); }
        .note { background-color: rgba(255, 255, 255, 0.04); border-left: 3px solid #D4A72C; padding: 14px 18px; border-radius: 6px; font-size: 13px; color: rgba(255, 255, 255, 0.6); margin-top: 30px; }
        .footer { padding: 24px 32px; text-align: center; font-size: 12px; color: rgba(255, 255, 255, 0.35); border-top: 1px solid rgba(255, 255, 255, 0.05); }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-box">OAI</div>
          <div style="margin-top: 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #D4A72C; font-weight: 700;">
            ${portalTitle}
          </div>
        </div>
        <div class="content">
          <h1>Password Reset Request</h1>
          <p>Hello <strong>${name}</strong>,</p>
          <p>We received a request to reset your password for your <strong>${fromName}</strong> account. Please click the button below to set a new password:</p>
          <div class="btn-box">
            <a href="${resetLink}" class="btn" target="_blank">Reset Password</a>
          </div>
          <p style="font-size: 13px; color: rgba(255, 255, 255, 0.5);">This password reset link is valid for <strong>60 minutes</strong>. If you did not request this password reset, please ignore this email or contact security immediately.</p>
          <div class="note">
            <strong>Button not working?</strong> Copy and paste this URL into your browser:<br>
            <span style="color: #F2C14E; word-break: break-all;">${resetLink}</span>
          </div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ${fromName}. All rights reserved.<br>
          Automated security message. Please do not reply directly to this email.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Hello ${name},

We received a request to reset your password for your ${fromName} (${portalTitle}) account.

Please visit the link below to set a new password:
${resetLink}

This link is valid for 60 minutes. If you did not request this, please ignore this email.

--
${fromName} Security Team
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to,
      subject: `Reset Your Password - ${fromName}`,
      text,
      html,
    });

    console.log(`[Mail] Password reset email sent successfully to ${to} (MessageId: ${info.messageId})`);
    return true;
  } catch (error) {
    console.error(`[Mail] Failed to deliver password reset email to ${to}:`, error);
    // Don't throw so application flow can proceed gracefully
    return false;
  }
}
