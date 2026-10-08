import { defineConfig } from 'vite'

/**
 * The game is the product; the level editor is an internal tool. They share
 * `core/`, but not a build — `npm run build` ships only the game, and the
 * editor is built separately, into its own directory, when it needs hosting.
 */
export default defineConfig(({ mode }) => {
  const isEditor = mode === 'editor'

  return {
    build: {
      outDir: isEditor ? 'dist-editor' : 'dist',
      rollupOptions: {
        input: isEditor ? 'editor.html' : 'index.html',
      },
    },
  }
})
