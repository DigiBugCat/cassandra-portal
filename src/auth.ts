/**
 * Shared auth helpers — extract user identity from CF Access headers/JWT.
 */

export function getUserEmail(request: Request): string {
  const headerEmail =
    request.headers.get("Cf-Access-Authenticated-User-Email")?.trim() ||
    request.headers.get("X-Auth-Request-Email")?.trim();
  if (headerEmail) return headerEmail;

  try {
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion") || getCookie(request, "CF_Authorization");
    if (jwt) {
      const payload = parseJwtPayload(jwt);
      if (typeof payload.email === "string" && payload.email.trim()) {
        return payload.email.trim();
      }
    }
  } catch {
    // ignore
  }

  // Fallback for CF Access bypass (IP bypass skips identity injection)
  const fallback = process.env.DEFAULT_USER_EMAIL;
  if (fallback) return fallback;

  return "";
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie");
  if (!cookies) return null;

  for (const chunk of cookies.split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    return trimmed.slice(name.length + 1);
  }

  return null;
}

function parseJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("invalid jwt");
  return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  return atob(padded);
}
