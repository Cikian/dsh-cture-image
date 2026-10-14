#!/usr/bin/env node
/**
 * Repack the plugin and reinstall the built artifact into a profile.
 *
 * The packed install (`install.mjs --from-tgz`) is the only install that proves
 * what a user receives, but it also means source edits stop reaching the host
 * until the artifact is rebuilt. This is that loop in one command, in the order
 * that cannot leave a stale artifact installed:
 *
 *   1. `npm pack` into `dist/`        — a fresh artifact from the current sources
 *   2. `uninstall.mjs`               — the old install goes away first
 *   3. `install.mjs --from-tgz`      — the artifact, as a real directory
 *   4. `preflight.mjs`               — and it must agree with the profile
 *
 * Usage:
 *   node tools/pack-install.mjs --profile desktop
 *   node tools/pack-install.mjs --profile desktop --dry-run
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const args = process.argv.slice(2)
const profileFlag = args.indexOf('--profile')
const profileName = profileFlag === -1 ? undefined : args[profileFlag + 1]
const dryRun = args.includes('--dry-run')

if (profileName === undefined) {
  console.error('usage: node tools/pack-install.mjs --profile <name> [--dry-run]')
  process.exit(2)
}

/* Read the manifest directly: `node -p require(...)` depends on how the eval
 * context is typed, and this must not be the step that fails. */
const { name, version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const fileName = `${name.replace(/^@/u, '').replace(/\//gu, '-')}-${version}.tgz`
const distDir = join(ROOT, 'dist')
const tarball = join(distDir, fileName)

const run = (label, script, argv) => {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`)
  execFileSync(process.execPath, [join(HERE, script), ...argv], { cwd: ROOT, stdio: 'inherit' })
}

if (dryRun) {
  console.log(`would pack ${name}@${version} into ${tarball}`)
  run('uninstall (dry run)', 'uninstall.mjs', ['--profile', profileName, '--dry-run'])
  run('install from tarball (dry run)', 'install.mjs', ['--profile', profileName, '--from-tgz', tarball, '--dry-run'])
  console.log('\ndry run — nothing was written')
  process.exit(0)
}

/* 1. the artifact. `npm pack` reads the `files` whitelist, so what lands here is
 * exactly what a user would receive — which is the point of the whole tool. */
mkdirSync(distDir, { recursive: true })
console.log(`── npm pack ${'─'.repeat(50)}`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packed = execFileSync(npm, ['pack', '--pack-destination', distDir], { cwd: ROOT, encoding: 'utf8', shell: true })
console.log(packed.trim())
if (!existsSync(tarball)) {
  const found = readdirSync(distDir).filter((entry) => entry.endsWith('.tgz'))
  console.error(`\nexpected ${tarball}; dist/ holds: ${found.join(', ') || '(nothing)'}`)
  process.exit(1)
}

/* 2 + 3. replace the install, then 4. prove it agrees with the profile. */
run('uninstall', 'uninstall.mjs', ['--profile', profileName])
run('install from tarball', 'install.mjs', ['--profile', profileName, '--from-tgz', tarball])
run('preflight', 'preflight.mjs', ['--profile', profileName])
