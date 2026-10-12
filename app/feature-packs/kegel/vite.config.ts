import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    plugins: [react()],
    build: { outDir: '../../tmp/kegel-module/dist', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 1422, strictPort: true },
});
