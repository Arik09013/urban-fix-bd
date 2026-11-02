import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'build', emptyOutDir: true, sourcemap: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/uploads': 'http://127.0.0.1:8000' } },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true,
    globals: true,
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
});
