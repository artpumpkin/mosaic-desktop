// Tiny Real-Debrid client. We only need it to validate a pasted API token
// so the user gets a clear "✓ Connected as X (premium until Y)" signal in
// settings. Streaming itself goes through Torrentio's realdebrid={token}
// path — we never need to hit /unrestrict/link or other RD endpoints from
// the frontend.

const BASE = "https://api.real-debrid.com/rest/1.0";

export type RdUser = {
  id: number;
  username: string;
  email?: string;
  type: "free" | "premium";
  premium: number; // seconds remaining on plan
  expiration: string; // ISO date
};

export async function validateToken(token: string): Promise<RdUser> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Empty token");
  const res = await fetch(`${BASE}/user`, {
    headers: { Authorization: `Bearer ${trimmed}` },
  });
  if (!res.ok) {
    throw new Error(`Real-Debrid responded ${res.status}`);
  }
  const data = (await res.json()) as RdUser;
  return data;
}

export function formatExpiry(user: RdUser): string {
  if (user.type !== "premium") return "Free tier";
  try {
    const d = new Date(user.expiration);
    if (Number.isNaN(d.getTime())) return user.expiration;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return user.expiration;
  }
}
