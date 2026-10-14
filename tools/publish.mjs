#!/usr/bin/env node
/**
 * Publish this bundle.
 *
 * `package.json` keeps `"private": true` so the package cannot be published by
 * accident from a working copy — but npm refuses to publish a private package,
 * so the flag has to come off for exactly one command and go back on
 * afterwards, even if the publish fails.
 *
 * This does the round trip in one step and verifies the result:
 *
 *   1. `tools/publish-check.mjs` must pass first;
 *   2. `private` is removed, `npm publish` runs, and the flag is restored;
 *   3. the published version is read back from the registry.
 *
 * Usage:
 *   node tools/publish.mjs --access public
 *   node tools/publish.mjs --access public --tag beta
 *   node tools/publish.mjs --access public --dry-run
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MANIFEST = join(ROOT, 'package.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

/* ── 1. the gate must pass ──────────────────────────────────────────────── */

console.log('· running the publish gate\n')
try {
  execFileSync(process.execPath, [join(HERE, 'publish-check.mjs')], { stdio: 'inherit' })
} catch {
  console.error('\npublish gate failed — nothing was published')
  process.exit(1)
}

/* ── 2. publish with `private` lifted, then always put it back ──────────── */

const original = readFileSync(MANIFEST, 'utf8')
const manifest = JSON.parse(original)
const { private: _private, ...publishable } = manifest

const restore = () => {
  if (readFileSync(MANIFEST, 'utf8') !== original) writeFileSync(MANIFEST, original)
}

try {
  writeFileSync(MANIFEST, `${JSON.stringify(publishable, undefined, 2)}\n`)
  console.log(`\n· publishing ${manifest.name}@${manifest.version}${dryRun ? ' (dry run)' : ''}\n`)
  execFileSync('npm', ['publish', ...args], { cwd: ROOT, stdio: 'inherit', shell: true })
} catch (error) {
  restore()
  console.error(`\npublish failed: ${error?.message ?? error}`)
  console.error('`private` was restored; the working copy is unchanged')
  process.exit(1)
} finally {
  restore()
}

/* ── 3. confirm it landed ───────────────────────────────────────────────── */

if (dryRun) {
  console.log('\ndry run complete — nothing was published')
  process.exit(0)
}

try {
  const published = execFileSync('npm', ['view', `${manifest.name}@${manifest.version}`, 'version'], { encoding: 'utf8', shell: true }).trim()
  console.log(`\npublished: ${manifest.name}@${published}`)
  console.log('\nusers install it with:')
  console.log(`  dsh plugin --profile <profile> add ${manifest.name}`)
} catch {
  console.warn('\nnpm publish reported success but the version could not be read back yet; check the registry in a moment')
}
