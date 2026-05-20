import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    minify: "terser",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          settings: ["./src/pages/SettingsPage"],
          movie: ["./src/pages/MoviePage"],
          tv: ["./src/pages/TVPage"],
          downloads: ["./src/pages/DownloadsPage"],
        },
      },
    },
  },
  server: {
    host: "::",
    port: 8080,
    allowedHosts: true,
  },
});
