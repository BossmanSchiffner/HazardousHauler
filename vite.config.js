import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, searchForWorkspaceRoot} from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const localArtDirection = resolve(projectRoot, 'art-direction');
const usesParentArtDirection = !existsSync(localArtDirection);
const artDirection = usesParentArtDirection ? resolve(projectRoot, '../art-direction') : localArtDirection;

export default defineConfig({
  resolve: {
    alias: [{find: '@art-direction', replacement: artDirection}],
  },
  ...(usesParentArtDirection ? {server: {fs: {allow: [searchForWorkspaceRoot(projectRoot), artDirection]}}} : {}),
});