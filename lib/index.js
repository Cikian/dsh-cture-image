/**
 * @cikian/dsh-cture-image — Host entry.
 *
 * The Cordis loader mounts this file (by absolute path or file URL) and hands
 * it the plugin's `apply`/`inject`. The implementation lives in `./host.js`.
 *
 * NOTE ON CACHING: this file re-exports from a module whose URL never changes,
 * so ESM serves the cached `host.js` for the life of the process. Editing the
 * implementation therefore still requires a host restart; the split exists so
 * the entry stays trivially inspectable, not to make edits live.
 *
 * @module @cikian/dsh-cture-image
 */
export { apply, inject, name } from './host.js'
