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
  html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your fairground seller email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #18181b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f4f5; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e4e4e7; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);">          
          <!-- Header -->
          <td style="padding: 32px 32px 0 32px; text-align: left;">
          <tr>
              <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #18181b;">
                fairground
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 24px 32px 32px 32px;">
              <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 600; line-height: 1.3; color: #18181b;">
                Verify your seller email
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #52525b;">
                Enter the verification code below to confirm your email address and continue setting up your seller account.
              </p>

              <!-- OTP Code Box -->
              <div style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.25em; color: #18181b; display: inline-block; padding-left: 0.25em;">
                  ${code}
                </span>
              </div>

              <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #71717a;">
                This code expires in <strong style="color: #3f3f46;">10 minutes</strong>.
              </p>
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #71717a;">
                If you did not request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 16px 32px; border-top: 1px solid #f4f4f5; text-align: left;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                &copy; ${new Date().getFullYear()} fairground. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim(),
});

}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendSellerOnboardingLink(
  email: string,
  sellerName: string,
  listingTitle: string,
  onboardingUrl: string,
) {
  const user = process.env.GMAIL_USER;
  if (!user) {
    throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD on the server.");
  }

  const safeSellerName = escapeHtml(sellerName);
  const safeListingTitle = escapeHtml(listingTitle);
  const safeOnboardingUrl = escapeHtml(onboardingUrl);
  await getTransporter().sendMail({
    from: { name: "fairground", address: user },
    to: email,
    subject: "Finish setting up your fairground listing",
    text: `Hi ${sellerName},\n\nContinue Stripe seller onboarding for "${listingTitle}" using this link:\n${onboardingUrl}\n\nYour listing will be removed if onboarding is not completed within one hour of creation.`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Finish setting up your fairground listing</title>
</head>
<body style="margin: 0; padding: 32px 16px; background: #f4f4f5; font-family: Arial, sans-serif; color: #18181b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px;">
    <tr><td style="padding: 32px;">
      <p style="margin: 0 0 20px; font-size: 18px; font-weight: 700;">fairground</p>
      <h1 style="margin: 0 0 12px; font-size: 22px;">Finish seller onboarding</h1>
      <p style="font-size: 15px; line-height: 1.6; color: #52525b;">Hi ${safeSellerName}, continue Stripe setup for <strong>${safeListingTitle}</strong>. Your listing stays hidden until Stripe confirms your account can accept payments.</p>
      <p style="margin: 24px 0;"><a href="${safeOnboardingUrl}" style="display: inline-block; padding: 12px 20px; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Continue with Stripe</a></p>
      <p style="font-size: 13px; line-height: 1.5; color: #71717a;">If the button does not work, copy this link into your browser:<br /><a href="${safeOnboardingUrl}" style="color: #3f3f46; word-break: break-all;">${safeOnboardingUrl}</a></p>
      <p style="font-size: 13px; line-height: 1.5; color: #71717a;">The listing will be removed if onboarding is not completed within one hour of creation.</p>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
}

export async function sendBuyerPurchaseReceipt(input: {
  email: string;
  listingTitle: string;
  listingDescription: string;
  listingCategory: string;
  listingLocation: string;
  amountCents: number;
  currency: string;
  orderId: string;
  invoicePdfUrl: string | null;
  hostedInvoiceUrl: string | null;
}) {
  const user = process.env.GMAIL_USER;
  if (!user) {
    throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD on the server.");
  }

  const title = escapeHtml(input.listingTitle);
  const description = escapeHtml(input.listingDescription);
  const category = escapeHtml(input.listingCategory);
  const location = escapeHtml(input.listingLocation);
  const invoicePdfUrl = input.invoicePdfUrl
    ? escapeHtml(input.invoicePdfUrl)
    : null;
  const hostedInvoiceUrl = input.hostedInvoiceUrl
    ? escapeHtml(input.hostedInvoiceUrl)
    : null;
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: input.currency.toUpperCase(),
  }).format(input.amountCents / 100);
  const invoiceLinks = [
    invoicePdfUrl ? `Invoice PDF: ${input.invoicePdfUrl}` : null,
    hostedInvoiceUrl ? `View invoice: ${input.hostedInvoiceUrl}` : null,
  ].filter(Boolean).join("\n");

  await getTransporter().sendMail({
    from: { name: "fairground", address: user },
    to: input.email,
    subject: `Your fairground purchase: ${input.listingTitle}`,
    text: `Thanks for your purchase!\n\nProduct: ${input.listingTitle}\nCategory: ${input.listingCategory}\nLocation: ${input.listingLocation}\nDescription: ${input.listingDescription}\nTotal paid: ${amount}\nOrder: ${input.orderId}\n\n${invoiceLinks || "Your invoice is being prepared. Contact us if you need a copy."}`,
    html: `
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px">
    <tr><td style="padding:32px">
      <p style="margin:0 0 20px;font-size:18px;font-weight:700">fairground</p>
      <h1 style="margin:0 0 12px;font-size:22px">Thanks for your purchase!</h1>
      <p style="margin:0 0 24px;color:#52525b">Your payment was successful. Here are your purchase details.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#71717a">Product</td><td style="padding:8px 0;text-align:right;font-weight:600">${title}</td></tr>
        <tr><td style="padding:8px 0;color:#71717a">Category</td><td style="padding:8px 0;text-align:right">${category}</td></tr>
        <tr><td style="padding:8px 0;color:#71717a">Location</td><td style="padding:8px 0;text-align:right">${location}</td></tr>
        <tr><td style="padding:8px 0;color:#71717a">Total paid</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(amount)}</td></tr>
      </table>
      <p style="margin:20px 0;color:#52525b;line-height:1.6">${description}</p>
      <p style="font-size:13px;color:#71717a">Order reference: ${escapeHtml(input.orderId)}</p>
      ${invoicePdfUrl ? `<p style="margin:24px 0 12px"><a href="${invoicePdfUrl}" style="display:inline-block;padding:12px 18px;background:#18181b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Download invoice PDF</a></p>` : ""}
      ${hostedInvoiceUrl ? `<p style="margin:12px 0"><a href="${hostedInvoiceUrl}" style="color:#3f3f46">View your invoice online</a></p>` : ""}
      ${!invoicePdfUrl && !hostedInvoiceUrl ? `<p style="font-size:13px;color:#71717a">Your invoice is being prepared. Contact us if you need a copy.</p>` : ""}
    </td></tr>
  </table>
</body></html>`.trim(),
  });
}
