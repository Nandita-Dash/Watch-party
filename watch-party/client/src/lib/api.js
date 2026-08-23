// In production the API is served from the same origin as this app, so an empty
// base yields same-origin requests and there's nothing to configure at build
// time. In dev the client runs on :5173 and the API on :4000, so fall back to
// the local server rather than making every developer create a .env file.
const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function createRoom({ name, displayName, videoUrl }) {
  return request("/api/rooms", { method: "POST", body: { name, displayName, videoUrl } });
}

export function joinRoom(code, { displayName }) {
  return request(`/api/rooms/${code}/join`, { method: "POST", body: { displayName } });
}

export function getRoom(code, token) {
  return request(`/api/rooms/${code}`, { token });
}

export const API_ORIGIN = API_BASE;
