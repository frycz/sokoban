import { defineConfig } from 'vite'
import { levelExportPlugin } from './tools/level-export-plugin'

/**
 * The game is the product; the level editor is an internal tool. They share
 * `core/`, but not a build — `npm run build` ships only the game, and the
 * editor is built separately, into its own directory, when it needs hosting.
 */
export default defineConfig(({ mode }) => {
  const isEditor = mode === 'editor'

  return {
    // The editor's Export to levels/ writes into the working tree, so it is the
    // dev server's job and the plugin is serve-only. Both dev servers get it:
    // the editor runs on the same config, just a different port and entry.
    plugins: [levelExportPlugin()],
    build: {
      outDir: isEditor ? 'dist-editor' : 'dist',
      rollupOptions: {
        input: isEditor ? 'editor.html' : 'index.html',
      },
    },
  }
})
