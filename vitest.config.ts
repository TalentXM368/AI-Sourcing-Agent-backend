import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

function resolveJsExtensions(): import('vite').Plugin {
  return {
    name: 'resolve-ts-from-js',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (!importer || !source.endsWith('.js')) return null;
      const importerDir = resolve(importer, '..');
      const tsPath = resolve(importerDir, source.replace(/\.js$/, '.ts'));
      if (existsSync(tsPath)) return tsPath;
      const tsxPath = resolve(importerDir, source.replace(/\.js$/, '.tsx'));
      if (existsSync(tsxPath)) return tsxPath;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsExtensions()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
