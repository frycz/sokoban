import { defineConfig } from 'vite'
import { defaultSkinPlugin } from './tools/default-skin-plugin'
import { levelExportPlugin } from './tools/level-export-plugin'
import { levelManagePlugin } from './tools/level-manage-plugin'
import { levelOrderPlugin } from './tools/level-order-plugin'
import { liveColorsPlugin } from './tools/live-colors-plugin'

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
    // The live link from the colour picker is serve-only for the same reason,
    // and so is the dev build's level reordering, which writes order.json, and
    // its default skin picker, which writes default-skin.json, and its
    // disabling and deleting of levels, which write disabled.json and levels/.
    plugins: [
      levelExportPlugin(),
      levelOrderPlugin(),
      levelManagePlugin(),
      defaultSkinPlugin(),
      liveColorsPlugin(),
    ],
    build: {
      outDir: isEditor ? 'dist-editor' : 'dist',
      rollupOptions: {
        input: isEditor ? 'editor.html' : 'index.html',
      },
    },
  }
})
