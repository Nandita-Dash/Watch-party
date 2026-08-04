const keyFor = (code) => `watchparty:token:${code.toUpperCase()}`;

export function saveToken(code, token) {
  sessionStorage.setItem(keyFor(code), token);
}

export function loadToken(code) {
  return sessionStorage.getItem(keyFor(code));
}

export function clearToken(code) {
  sessionStorage.removeItem(keyFor(code));
}
