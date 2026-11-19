import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export const sellerVerificationCookie = "seller_verified";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function generateVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashVerificationCode(email: string, code: string) {
  const secret = process.env.SELLER_VERIFICATION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Set SELLER_VERIFICATION_SECRET to a random value of at least 32 characters.",
    );
  }

  return createHmac("sha256", secret)
    .update(`${email}:${code}`)
    .digest("hex");
}

export function createSellerVerificationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSellerVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
