import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // Suppress noisy warnings from dependencies
      onLog(level, log, handler) {
        // Suppress PURE annotation warnings from ox/viem dependencies
        if (log.message && log.message.includes('PURE')) {
          return;
        }
        handler(level, log);
      },
    },
  },
});
