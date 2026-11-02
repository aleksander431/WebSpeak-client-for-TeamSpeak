import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { noiseSuppressionAudioWorkletVitePlugin } from "@workadventure/noise-suppression/vite";

export default defineConfig({
  // Serves the DeepFilterNet3 worklet, Wasm and model in development; the
  // production build emits them as ordinary assets.
  plugins: [vue(), noiseSuppressionAudioWorkletVitePlugin()],
  // Android's generated asset copies and Gradle reports are not web entries.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3040",
      "/ws": {
        target: "ws://localhost:3040",
        ws: true,
      },
    },
  },
});
