#!/usr/bin/env node
/**
 * Rollback: remove this bundle from a profile, without needing the app.
 *
 * The crash dialog's own recovery button rewrites `cordis.patch.yml`, but a
 * bundle is mounted from the profile MANIFEST, so a bundle whose client half
 * fails to activate keeps the profile unbootable until the manifest is edited.
 * This is that edit, done from a terminal, in the order that cannot leave a
 * half-removed state:
 *
 *   1. drop it from `dsh.profile.bundles`  (stops the bundle patch from mounting)
 *   2. drop it from `dependencies`         (stops it counting as installed)
 *   3. remove its link from `node_modules`
 *   4. drop its lockfile entry
 *   5. prune any stale name from a previous rename
 *
 * Usage:
 *   node tools/uninstall.mjs --profile desktop
 *   node tools/uninstall.mjs --profile desktop --dry-run
 */

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describeInstalledDir, removeInstalledDir } from './install-dir.mjs'
import { stripLockfileEntries } from './lockfile.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

const args = process.argv.slice(2)
const profileFlag = args.indexOf('--profile')
const profileName = profileFlag === -1 ? undefined : args[profileFlag + 1]
const dryRun = args.includes('--dry-run')

if (profileName === undefined) {
  console.error('usage: node tools/uninstall.mjs --profile <name> [--dry-run]')
  process.exit(2)
}

const NAME = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
/* Names this bundle has been installed under. A rename that leaves one behind
 * is what produced the duplicate-registration crash, so removal is thorough. */
const NAMES = [NAME, '@stargis/dsh-imagegen', 'dsh-imagegen']

const profileDir = join(HOME, '.dsh', 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

if (!existsSync(manifestPath)) {
  console.error(`no profile manifest at ${manifestPath}`)
  process.exit(2)
}

const changes = []
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

/* 1 + 2: the manifest is the only thing that decides whether the bundle is
 * mounted, so it is edited first and rewritten atomically. */
const bundles = manifest.dsh?.profile?.bundles ?? []
const keptBundles = bundles.filter((entry) => !NAMES.includes(entry))
if (keptBundles.length !== bundles.length) {
  changes.push(`bundles: removed ${bundles.filter((e) => NAMES.includes(e)).join(', ')}`)
  manifest.dsh.profile.bundles = keptBundles
}

const dependencies = manifest.dependencies ?? {}
const removedDeps = Object.keys(dependencies).filter((entry) => NAMES.includes(entry))
for (const entry of removedDeps) delete dependencies[entry]
if (removedDeps.length > 0) changes.push(`dependencies: removed ${removedDeps.join(', ')}`)

if (!dryRun && changes.length > 0) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/* 3: the node_modules link. A junction must be removed as a directory, never
 * followed — deleting through it would erase the package source. */
const nodes = []
for (const name of NAMES) {
  const link = join(profileDir, 'node_modules', ...name.split('/'))
  if (existsSync(link)) nodes.push(link)
}
for (const link of nodes) {
  if (dryRun) {
    changes.push(`node_modules: would remove ${link} (${describeInstalledDir(link)})`)
  } else {
    changes.push(`node_modules: removed ${link} (${removeInstalledDir(link, NAMES)})`)
  }
}
/* A scope directory left empty by the removal is dead weight, and pnpm treats
 * an empty scope as a broken dependency tree. */
if (!dryRun) {
  for (const scope of new Set(NAMES.filter((name) => name.startsWith('@')).map((name) => name.split('/')[0]))) {
    const scopeDir = join(profileDir, 'node_modules', scope)
    try {
      if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) {
        rmSync(scopeDir, { recursive: true, force: true })
        changes.push(`node_modules: removed the empty scope ${scope}`)
      }
    } catch {
      /* a scope that cannot be read is left alone */
    }
  }
}

/* 4: the lockfile entries. A package installed from a tarball appears in THREE
 * places — the importer's `dependencies` map (bare name), the `packages` map
 * and the `snapshots` map (both `name@<specifier>`) — so matching only the bare
 * key leaves two orphans behind and the next `pnpm install` trips over them. */
const lockPath = join(profileDir, 'pnpm-lock.yaml')
if (existsSync(lockPath)) {
  const { text, removed } = stripLockfileEntries(readFileSync(lockPath, 'utf8'), NAMES)
  if (removed) {
    changes.push('pnpm-lock.yaml: removed the entries (importer, packages, snapshots)')
    if (!dryRun) writeFileSync(lockPath, text)
  }
}

/* 5: the source must still exist. Removing a junction recursively would have
 * taken the package itself with it, so assert it rather than assume it. */
if (!dryRun && !existsSync(join(ROOT, 'package.json'))) {
  console.error(`\nABORT: the package source at ${ROOT} is gone — a removal followed a link.`)
  process.exit(1)
}

/* 6: report anything left, so a stale entry cannot hide. */
const leftovers = []
for (const file of readdirSync(profileDir)) {
  if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
    const text = readFileSync(join(profileDir, file), 'utf8')
    for (const name of NAMES) if (text.includes(name)) leftovers.push(`${file}: ${name}`)
  }
}

console.log(changes.length === 0 ? 'nothing to remove — the profile does not reference this bundle' : changes.join('\n'))
if (leftovers.length > 0) {
  console.log(`\nstill referenced (check by hand):\n  ${leftovers.join('\n  ')}`)
}
console.log(dryRun ? '\ndry run — nothing was written' : '\ndone. Restart the host for this profile.')
