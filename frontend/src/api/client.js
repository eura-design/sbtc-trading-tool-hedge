import { API_BASE } from "../constants";

export async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg;
    try { msg = JSON.parse(text).error || text; }
    catch { msg = text || `HTTP ${res.status}`; }
    throw new Error(msg);
  }
  return res.json();
}
