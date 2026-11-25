import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export function exhibitionConfig(directory: 'exhibition' | 'exhibition-admin') {
  return defineConfig(({ mode, command }) => {
    const suffix = mode === 'development' && command === 'serve' ? '.demo'
      : mode === 'staging' ? '.staging'
        : mode === 'production' && command === 'build' ? '' : null;
    if (suffix === null) throw new Error(`Unsupported exhibition mode: ${mode}`);

    return {
      root: fileURLToPath(new URL(`./${directory}`, import.meta.url)),
      resolve: {
        alias: {
          '@firebase-config': fileURLToPath(new URL(`./firebase-applet-config${suffix}.json`, import.meta.url)),
        },
      },
      build: { assetsInlineLimit: 0 },
    };
  });
}

export default exhibitionConfig('exhibition');
