import { defineConfig } from 'vite';

export default defineConfig({
  // tools/ holds offline asset pipelines (including a Python environment); the game never imports from it.
  server: { port: 5173, watch: { ignored: ['**/tools/**'] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
});
