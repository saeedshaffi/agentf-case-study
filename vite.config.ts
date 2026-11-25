import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Customer folders (config + engine output) are served as static files,
// exactly like the product API would return them: /<customer>/engine-output/<file>.json
export default defineConfig({
  plugins: [react()],
  publicDir: 'customers',
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
} as any);
