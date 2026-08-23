import { io } from "socket.io-client";
import { API_ORIGIN } from "./api.js";

export function connectSocket(token) {
  // An empty origin means "same origin", but socket.io-client wants that
  // expressed as a missing argument rather than an empty string.
  return io(API_ORIGIN || undefined, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
}
