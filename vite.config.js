import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The ElevenLabs STT SDK (~630 kB) is split into a lazy chunk loaded on first voice use;
// the initial kiosk bundle stays well below this limit.
export default defineConfig({ plugins: [react()], build: { chunkSizeWarningLimit: 700 } });
