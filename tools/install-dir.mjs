/**
 * One place that knows how to delete an installed package path safely.
 *
 * A local install comes in two shapes and they must be removed differently:
 *
 *   - a JUNCTION/symlink into the package source — removing it recursively
 *     would erase the source tree the user is editing;
 *   - a REAL directory — what `--from-tgz` (and pnpm's hoisted linker) put
 *     there, which is removed recursively, but only after checking that it
 *     really holds this package.
 *
 * Both install.mjs and uninstall.mjs must agree on this, so the rule lives
 * here rather than being copied into each entry point.
 *
 * @module tools/install-dir
 */

import { existsSync, lstatSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Remove an installed package path without ever following a link into source.
 * @param target - absolute path inside a profile's `node_modules`.
 * @param names - package names this bundle may legally be installed under.
 * @returns which shape was removed, for the change report.
 * @throws {Error} when the path is a real directory holding a different package.
 */
export function removeInstalledDir(target, names) {
  if (lstatSync(target).isSymbolicLink()) {
    try {
      rmSync(target, { force: true })
    } catch (error) {
      /* Windows needs RemoveDirectory for a directory reparse point. */
      if (error?.code === 'ERR_FS_EISDIR' || error?.code === 'EPERM' || error?.code === 'EISDIR') rmdirSync(target)
      else throw error
    }
    return 'link (source untouched)'
  }

  const manifestPath = join(target, 'package.json')
  const installed = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).name : undefined
  if (typeof installed !== 'string' || !names.includes(installed)) {
    const holds = installed === undefined ? 'no package.json' : `package "${installed}"`
    throw new Error(`refusing to delete ${target}: it holds ${holds}, not this bundle`)
  }
  rmSync(target, { recursive: true, force: true })
  return 'installed directory'
}

/**
 * Describe an installed path without touching it, for dry runs.
 * @param target - absolute path inside a profile's `node_modules`.
 * @returns a short shape label.
 */
export function describeInstalledDir(target) {
  return lstatSync(target).isSymbolicLink() ? 'link' : 'installed directory'
}
