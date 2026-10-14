/**
 * Dependency-free reader for the `.tgz` files `npm pack` produces.
 *
 * Why not shell out to `tar`: the plugin must install on a machine whose
 * package manager is policy-blocked (that is exactly the situation this tool
 * exists for), and a Windows `tar.exe` is an extra assumption. A gzipped ustar
 * archive is a simple format, and the eight files this package ships need none
 * of its exotic corners.
 *
 * What is supported: regular files, directories, and the pax/gnu metadata
 * records that `npm pack` may prepend (skipped, since every path here is well
 * under the 100-byte name field). Symlinks, hardlinks and devices are REFUSED
 * rather than silently created — a published tarball has no business carrying
 * them, and creating them from an archive is how extraction bugs become
 * security bugs.
 *
 * @module tools/tar
 */

import { gunzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

const BLOCK = 512

/** Read one NUL-terminated header field. */
function field(header, offset, length) {
  return header.toString('utf8', offset, offset + length).replace(/\0[\s\S]*$/u, '').trim()
}

/** Read one numeric (octal, possibly space-padded) header field. */
function octal(header, offset, length) {
  const raw = field(header, offset, length)
  return raw === '' ? 0 : Number.parseInt(raw, 8)
}

/**
 * Decide where one archive member lands, or refuse to create it.
 * @param entryPath - the raw member name from the header (`package/lib/host.js`).
 * @returns the path relative to the extraction root.
 * @throws {Error} when the name escapes the root or is absolute.
 */
function safeRelative(entryPath) {
  const stripped = entryPath.replace(/^\.\//u, '').replace(/^package\//u, '')
  if (stripped === '') return ''
  if (/^[A-Za-z]:/u.test(stripped) || stripped.startsWith('/') || stripped.startsWith('\\')) {
    throw new Error(`tarball member "${entryPath}" is an absolute path`)
  }
  const parts = stripped.split(/[/\\]+/u)
  if (parts.includes('..')) throw new Error(`tarball member "${entryPath}" escapes the extraction root`)
  return parts.filter((part) => part !== '').join(sep)
}

/**
 * Extract a package tarball into a directory.
 * @param tarballPath - the `.tgz` produced by `npm pack`.
 * @param destination - directory to create the members in (created as needed).
 * @returns the relative paths written, in archive order.
 */
export function extractTarball(tarballPath, destination) {
  const archive = gunzipSync(readFileSync(tarballPath))
  const written = []
  let offset = 0

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break

    const name = field(header, 0, 100)
    const prefix = field(header, 345, 155)
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156]) || '0'
    const body = archive.subarray(offset + BLOCK, offset + BLOCK + size)
    /* Every member is padded out to a whole block. */
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK

    /* pax/gnu metadata records are not file content. */
    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') continue
    if (name === '') continue

    const relative = safeRelative(prefix === '' ? name : `${prefix}/${name}`)
    if (relative === '') continue

    if (type === '5') {
      mkdirSync(join(destination, relative), { recursive: true })
      continue
    }
    if (type !== '0' && type !== '') {
      throw new Error(`tarball member "${name}" has unsupported type "${type}" (only files and directories are accepted)`)
    }

    const target = join(destination, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
    written.push(relative)
  }

  return written
}

/**
 * List an archive's members without writing anything, for diagnostics.
 * @param tarballPath - the `.tgz` produced by `npm pack`.
 * @returns member names in archive order.
 */
export function listTarball(tarballPath) {
  const archive = gunzipSync(readFileSync(tarballPath))
  const names = []
  let offset = 0
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const name = field(header, 0, 100)
    const prefix = field(header, 345, 155)
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156]) || '0'
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') continue
    if (name !== '') names.push(prefix === '' ? name : `${prefix}/${name}`)
  }
  return names
}
