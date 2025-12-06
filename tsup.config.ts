import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  clean: true,
  dts: false,
  minify: false,
  shims: false,
  noExternal: [/^@actions\//],
});
