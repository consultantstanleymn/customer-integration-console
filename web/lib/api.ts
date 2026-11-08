export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) { super(message); }
}

let csrf = "";
export const setCsrf = (t: string) => { csrf = t; };

/** Calls the API through the same-origin /api proxy. Adds the CSRF header on writes. */
export async function api<T>(path: string, init: { method?: string; json?: unknown; text?: string } = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined || init.text !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (init.text !== undefined) { headers["content-type"] = "text/csv"; body = init.text; }
  else if (method !== "GET") { headers["content-type"] = "application/json"; body = JSON.stringify(init.json ?? {}); }
  if (method !== "GET") headers["x-csrf-token"] = csrf;
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: "same-origin" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.issues ? `: ${data.issues.join("; ")}` : "";
    throw new ApiError(res.status, `${data?.error ?? res.statusText}${detail}`, data);
  }
  return data as T;
}

export type Me = { email: string; name: string; role: "admin" | "engineer" | "viewer"; csrfToken: string };
