import { io } from "socket.io-client";
import { API_ORIGIN } from "./api.js";

export function connectSocket(token) {
  return io(API_ORIGIN, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
}
