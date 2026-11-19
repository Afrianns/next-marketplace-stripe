import nodemailer from "nodemailer";

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD on the server.");
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    auth: { user, pass: password.replace(/\s/g, "") },
  });
}

export async function sendSellerVerificationCode(email: string, code: string) {
  const user = process.env.GMAIL_USER;
  if (!user) {
    throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD on the server.");
  }

  await getTransporter().sendMail({
    from: { name: "fairground", address: user },
    to: email,
    subject: "Verify your fairground seller email",
    text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
  });
}

export async function sendConnectOnboardingLink(
  email: string,
  sellerName: string,
  link: string,
) {
  const user = process.env.GMAIL_USER;
  if (!user) {
    throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD on the server.");
  }

  await getTransporter().sendMail({
    from: { name: "fairground", address: user },
    to: email,
    subject: "Finish setting up seller payouts",
    text: `Hi ${sellerName},\n\nFinish your Stripe seller onboarding here:\n${link}\n\nThis link is single-use and expires. Do not share it. You can request a fresh link by opening the same link again after it expires.\n`,
  });
}
