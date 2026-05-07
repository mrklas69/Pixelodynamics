import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Base path se přepíná podle deploy targetu — GitHub Pages servíruje z /Pixelodynamics/
const base = process.env.GITHUB_PAGES === 'true' ? '/Pixelodynamics/' : '/';

export default defineConfig({
  base,
  plugins: [svelte()],
  server: {
    // Rapier WASM potřebuje cross-origin isolation pro SharedArrayBuffer (jen pokud
    // přejdeme na multi-threaded variantu; rapier2d-compat ho nepotřebuje, ale necháváme připravené).
  },
});
