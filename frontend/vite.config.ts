import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const CERT_PATH = path.resolve(__dirname, "certs", "server.crt");
const KEY_PATH = path.resolve(__dirname, "certs", "server.key");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
