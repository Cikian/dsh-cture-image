#!/usr/bin/env node
/**
 * Install this bundle into a profile, without pnpm.
 *
 * `dsh plugin --profile <name> add <dir|tgz>` is the supported path, but it
 * runs a full pnpm install and is subject to the profile's supply-chain policy
 * — which on this machine rejects an unrelated pre-existing dependency
 * (`dshmarket@1.66.20`, published inside the minimum-release-age window) and
 * rolls the whole operation back, leaving a half-written state.
 *
 * What a bundle actually needs is only these, and they are all done here:
 *   1. `dependencies[name]`            — makes it count as installed
 *   2. `dsh.profile.bundles` entry     — makes its patch row mount
 *   3. a `node_modules` entry          — what the name resolves through
 *   4. a lockfile entry                — so a later pnpm run keeps it
 *
 * Two modes, and they are NOT interchangeable:
 *
 *   --profile desktop                 junction into the source directory.
 *                                     Editing the source takes effect on
 *                                     restart: the development loop.
 *   --profile desktop --from-tgz X    unpack the published artifact as a REAL
 *                                     directory. This is what a user gets, so
 *                                     it is the only honest way to verify a
 *                                     release — but source edits no longer
 *                                     reach the host until you repack.
 *
 * Usage:
 *   node tools/install.mjs --profile desktop
 *   node tools/install.mjs --profile desktop --dry-run
 *   node tools/install.mjs --profile desktop --from-tgz dist/cikian-dsh-cture-image-1.0.0.tgz
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describeInstalledDir, removeInstalledDir } from './install-dir.mjs'
import { importerSpecifier, insertImporterEntry, stripLockfileEntries } from './lockfile.mjs'
import { extractTarball } from './tar.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

const args = process.argv.slice(2)
const profileFlag = args.indexOf('--profile')
const profileName = profileFlag === -1 ? undefined : args[profileFlag + 1]
const dryRun = args.includes('--dry-run')
const tgzFlag = args.indexOf('--from-tgz')
const tarball = tgzFlag === -1 ? undefined : resolve(args[tgzFlag + 1] ?? '')

if (profileName === undefined || (tgzFlag !== -1 && args[tgzFlag + 1] === undefined)) {
  console.error('usage: node tools/install.mjs --profile <name> [--dry-run] [--from-tgz <file.tgz>]')
  process.exit(2)
}
if (tarball !== undefined && !existsSync(tarball)) {
  console.error(`no tarball at ${tarball}`)
  process.exit(2)
}

const manifestPath = join(HOME, '.dsh', 'profiles', profileName, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`no profile manifest at ${manifestPath}`)
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NAME = pkg.name
const profileDir = dirname(manifestPath)
const changes = []

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []

/* The specifier describes where the package comes from, so the two modes write
 * different ones: the source directory, or the tarball.
 *
 * The directory form is relative when it can be — that keeps the profile
 * portable and is what pnpm rewrites to `link:` — but Windows cannot express a
 * path on another drive relative to the profile, so the absolute form is used
 * there. The tarball form is always absolute: `npm pack` output is not a
 * location the profile can reason about relatively. */
let spec
if (tarball === undefined) {
  const relativePath = relative(profileDir, ROOT).replace(/\\/g, '/')
  const sameDrive = ROOT.slice(0, 2).toLowerCase() === profileDir.slice(0, 2).toLowerCase()
  spec = sameDrive ? `file:${relativePath}` : `file:${ROOT.replace(/\\/g, '/')}`
} else {
  spec = `file:${tarball.replace(/\\/g, '/')}`
}

if (manifest.dependencies[NAME] !== spec) {
  const previous = manifest.dependencies[NAME]
  manifest.dependencies[NAME] = spec
  changes.push(`dependencies: ${previous === undefined ? 'added' : `changed (was ${previous})`} ${NAME} -> ${spec}`)
}
if (!manifest.dsh.profile.bundles.includes(NAME)) {
  manifest.dsh.profile.bundles.push(NAME)
  changes.push('dsh.profile.bundles: added ' + NAME)
}

if (!dryRun && changes.length > 0) {
  /* Bundles are appended last so an existing order — which decides precedence —
   * is never disturbed. */
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/* ── the package itself ─────────────────────────────────────────────────── */

const installDir = join(profileDir, 'node_modules', ...NAME.split('/'))
const scope = NAME.startsWith('@') ? NAME.split('/')[0] : undefined

if (tarball === undefined) {
  /* A junction on Windows needs no elevation and resolves to the real path, so
   * `import.meta.url` inside the package still points at its source. */
  if (!existsSync(installDir)) {
    changes.push(`node_modules: linked ${installDir}`)
    if (!dryRun) {
      if (scope !== undefined) mkdirSync(join(profileDir, 'node_modules', scope), { recursive: true })
      symlinkSync(ROOT, installDir, 'junction')
    }
  }
} else if (dryRun) {
  const replacing = existsSync(installDir) ? ` (replacing ${describeInstalledDir(installDir)})` : ''
  changes.push(`node_modules: would unpack ${basename(tarball)} into ${installDir}${replacing}`)
} else {
  /* Stage beside the target, then rename: a half-extracted tree never becomes
   * the installed package, and the swap stays on one volume. */
  if (scope !== undefined) mkdirSync(join(profileDir, 'node_modules', scope), { recursive: true })
  const staging = join(profileDir, 'node_modules', `.from-tgz-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    const written = extractTarball(tarball, staging)
    const shipped = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
    if (shipped.name !== NAME) throw new Error(`the tarball holds "${shipped.name}", expected "${NAME}"`)
    if (existsSync(installDir)) {
      changes.push(`node_modules: replaced ${installDir} (${removeInstalledDir(installDir, [NAME])})`)
    }
    renameSync(staging, installDir)
    changes.push(`node_modules: unpacked ${written.length} files — ${shipped.name}@${shipped.version}`)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }

  /* The artifact deliberately excludes `config.json` (it carries the API key),
   * so a packed install would start unconfigured. Carry the local one over —
   * and say so, because a later `pnpm install` may replace this directory. */
  const localConfig = join(ROOT, 'config.json')
  if (existsSync(localConfig) && !existsSync(join(installDir, 'config.json'))) {
    copyFileSync(localConfig, join(installDir, 'config.json'))
    changes.push('config.json: carried over from the source directory (it is not part of the package)')
  }

  /* A tarball older than the sources installs yesterday's code — the exact
   * mistake a packed workflow invites. */
  const newest = Math.max(...['package.json', 'cordis.patch.yml', 'lib/host.js', 'lib/client.js', 'lib/index.js']
    .filter((file) => existsSync(join(ROOT, file)))
    .map((file) => statSync(join(ROOT, file)).mtimeMs))
  if (newest > statSync(tarball).mtimeMs) {
    changes.push('WARNING: the tarball is older than the sources — run `npm pack` again')
  }
}

/* ── the lockfile entry ─────────────────────────────────────────────────── */

/* The manifest is the source of truth, and the lockfile must agree with it.
 * That matters because the specifier MOVES: a repack changes the tarball path,
 * and switching between the two install shapes changes `file:` to `link:`.
 * Keeping a stale entry — which is what a naive "only insert if missing" does —
 * leaves the profile in the state pnpm reports as "the lockfile is stale", and
 * the old `name@<oldspecifier>` keys survive as orphans. */
const lockPath = join(profileDir, 'pnpm-lock.yaml')
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf8')
  const desired = tarball === undefined ? `link:${ROOT.replace(/\\/g, '/')}` : spec
  const block = tarball === undefined
    ? `      '${NAME}':\n        specifier: ${desired}\n        version: link:${spec.slice('file:'.length)}\n`
    : `      '${NAME}':\n        specifier: ${desired}\n        version: ${desired}\n`

  if (importerSpecifier(lock, NAME) === desired) {
    changes.push('pnpm-lock.yaml: entry already matches the manifest')
  } else {
    const { text: stripped, removed } = stripLockfileEntries(lock, [NAME])
    const rewritten = insertImporterEntry(stripped, block)
    if (rewritten === undefined) {
      changes.push('pnpm-lock.yaml: no importer anchor found — left alone (a pnpm run will re-resolve)')
    } else {
      changes.push(`pnpm-lock.yaml: ${removed ? 'replaced' : 'added'} the entry (${desired})`)
      if (!dryRun) writeFileSync(lockPath, rewritten)
    }
  }
}

console.log(changes.length === 0 ? 'already installed — nothing to do' : changes.join('\n'))
if (tarball !== undefined && !dryRun) {
  console.log('\nmode: packed artifact — a real directory, so source edits do NOT reach the host.')
  console.log('      repack and reinstall with: node tools/pack-install.mjs --profile ' + profileName)
}
console.log(dryRun ? '\ndry run — nothing was written' : '\ndone. Verify with: node tools/preflight.mjs --profile ' + profileName)
