import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The web app lives in dashboard/web and builds to dashboard/dist, which the Express
// server serves in production. In dev, the server mounts Vite as middleware.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "..", "dist"),
    emptyOutDir: true,
  },
  preview: { port: 4310, strictPort: true },
});
