import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/auth": {
        target: "http://backend:3000",
        changeOrigin: true,
      },
      "/wallet": {
        target: "http://backend:3000",
        changeOrigin: true,
      },
    },
  }
});
