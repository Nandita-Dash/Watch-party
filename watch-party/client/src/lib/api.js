const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

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
