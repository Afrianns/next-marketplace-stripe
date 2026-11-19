export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isValidEmail(email: string) {
  return (
    email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}
