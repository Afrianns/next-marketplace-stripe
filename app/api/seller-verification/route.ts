import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest, isValidEmail } from "@/lib/http";
import {
  generateVerificationCode,
  hashVerificationCode,
  normalizeEmail,
} from "@/lib/seller-verification";
import { sendSellerVerificationCode } from "@/lib/marketplace-email";

type VerificationRequest = { email?: unknown };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4_000) {
    return Response.json({ error: "The request is too large." }, { status: 413 });
  }

  let payload: VerificationRequest;
  try {
    payload = (await request.json()) as VerificationRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email =
    typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
  if (!isValidEmail(email)) {
    return Response.json(
      { error: "Enter a valid seller email address." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data: previous, error: lookupError } = await supabase
      .from("seller_email_verifications")
      .select("last_sent_at")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      console.error("Could not check seller verification cooldown:", lookupError);
      return Response.json(
        { error: "Could not send a verification code. Please try again." },
        { status: 500 },
      );
    }

    if (
      previous &&
      Date.now() - new Date(previous.last_sent_at).getTime() < 60_000
    ) {
      return Response.json(
        { error: "Wait one minute before requesting another code." },
        { status: 429 },
      );
    }

    const code = generateVerificationCode();
    const now = new Date();
    const { error: saveError } = await supabase
      .from("seller_email_verifications")
      .upsert({
        email,
        code_hash: hashVerificationCode(email, code),
        expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
        attempts: 0,
        last_sent_at: now.toISOString(),
        verification_token_hash: null,
        verified_until: null,
      });

    if (saveError) {
      console.error("Could not save seller verification:", saveError);
      return Response.json(
        { error: "Could not send a verification code. Please try again." },
        { status: 500 },
      );
    }

    try {
      await sendSellerVerificationCode(email, code);
    } catch (error) {
      console.error("Could not send seller verification email:", error);
      await supabase
        .from("seller_email_verifications")
        .delete()
        .eq("email", email);
      return Response.json(
        { error: "Could not send the verification email. Check the email setup and try again." },
        { status: 503 },
      );
    }

    return Response.json({ sent: true });
  } catch (error) {
    console.error("Seller verification request failed:", error);
    return Response.json(
      { error: "Seller verification is not configured on the server." },
      { status: 503 },
    );
  }
}
