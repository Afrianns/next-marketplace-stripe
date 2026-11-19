import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest, isValidEmail } from "@/lib/http";
import {
  createSellerVerificationToken,
  hashSellerVerificationToken,
  hashVerificationCode,
  normalizeEmail,
  sellerVerificationCookie,
} from "@/lib/seller-verification";

type VerificationConfirmation = {
  email?: unknown;
  code?: unknown;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let payload: VerificationConfirmation;
  try {
    payload = (await request.json()) as VerificationConfirmation;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email =
    typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return Response.json(
      { error: "Enter the email address and six-digit code." },
      { status: 400 },
    );
  }

  try {
    const token = createSellerVerificationToken();
    const supabase = createAdminClient();
    const { data: verified, error } = await supabase.rpc(
      "verify_seller_email_code",
      {
        p_email: email,
        p_code_hash: hashVerificationCode(email, code),
        p_token_hash: hashSellerVerificationToken(token),
        p_now: new Date().toISOString(),
      },
    );

    if (error) {
      console.error("Could not verify seller email:", error);
      return Response.json(
        { error: "Could not verify the email. Please try again." },
        { status: 500 },
      );
    }
    if (!verified) {
      return Response.json(
        { error: "The verification code is invalid, expired, or has too many attempts." },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(sellerVerificationCookie, token, {
      httpOnly: true,
      maxAge: 60 * 60,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });

    return Response.json({ verified: true });
  } catch (error) {
    console.error("Seller email verification failed:", error);
    return Response.json(
      { error: "Seller verification is not configured on the server." },
      { status: 503 },
    );
  }
}
