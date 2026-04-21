import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/';
  const apiBase = env.VITE_API_BASE_URL || '';

  return {
    base,
    plugins: [react()],
    server: {
      port: 4173,
      proxy: apiBase ? undefined : {
        '/api': 'http://localhost:8787'
      }
    },
    build: {
      outDir: 'dist'
    }
  };
});
