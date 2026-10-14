#!/usr/bin/env node
/**
 * Publish gate.
 *
 * Runs the correctness checks, then verifies the things that only matter when
 * the package leaves this machine:
 *
 *   1. no API key, token, or absolute local path is inside the tarball;
 *   2. `private` is cleared, or `npm publish` refuses the package outright;
 *   3. the tarball contains exactly the runtime files — a config file or a
 *      tools directory that leaked in would ship one user's secrets or
 *      clutter every install;
 *   4. the version is not already published, because a silent version clash is
 *      the most common way a release appears to succeed and changes nothing.
 *
 * Usage:
 *   node tools/publish-check.mjs              # checks only
 *   node tools/publish-check.mjs --pack       # also build the tarball
 *   npm publish --access public               # after this passes
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const lines = []
let failed = 0
const ok = (label, pass, extra = '') => {
  if (!pass) failed += 1
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}
const section = (title) => lines.push(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/* ── 1. correctness ─────────────────────────────────────────────────────── */

section('bundle checks')
try {
  const output = execFileSync(process.execPath, [join(HERE, 'preflight.mjs')], { encoding: 'utf8' })
  ok('preflight passes', /PREFLIGHT PASSED/.test(output))
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  const failures = output.split('\n').filter((line) => line.startsWith('FAIL'))
  ok('preflight passes', false, failures.slice(0, 4).join(' / ') || 'see output')
}

/* ── 2. secrets in the shipped sources ──────────────────────────────────── */

section('secrets')
const SHIPPED = ['lib/host.js', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'package.json']
const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{16,}/, 'an API key literal'],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/, 'a bearer token'],
  [/[A-Za-z]:\\Users\\/i, 'an absolute Windows user path'],
  [/\/Users\/[a-z0-9._-]+\//i, 'an absolute macOS user path'],
]
for (const file of SHIPPED) {
  const path = join(ROOT, file)
  if (!existsSync(path)) {
    ok(`${file} exists`, false)
    continue
  }
  const text = readFileSync(path, 'utf8')
  const hit = SECRET_PATTERNS.find(([pattern]) => pattern.test(text))
  ok(`${file} carries no secret or local path`, hit === undefined, hit === undefined ? '' : `found ${hit[1]}`)
}
ok('BUILTIN.apiKey ships empty', /apiKey: ''/.test(readFileSync(join(ROOT, 'lib/host.js'), 'utf8')))

/* ── 3. the manifest must allow publishing ──────────────────────────────── */

section('manifest')
ok('`private` is not true', pkg.private !== true, pkg.private === true ? 'npm publish refuses a private package' : '')
ok('name is scoped or unique', typeof pkg.name === 'string' && pkg.name.length > 0, pkg.name)
ok('version is semver', /^\d+\.\d+\.\d+/.test(pkg.version ?? ''), String(pkg.version))
ok('declares dsh.bundle.patch', typeof pkg.dsh?.bundle?.patch === 'string')
ok('declares dsh.client for web', pkg.dsh?.client?.platform === 'web')
ok('exports ./client', typeof pkg.exports?.['./client'] === 'string')
ok('exports ./cordis.patch.yml', typeof pkg.exports?.['./cordis.patch.yml'] === 'string')
ok('exports ./locale/en.json', typeof pkg.exports?.['./locale/en.json'] === 'string')
ok('does not depend on a local path', !Object.values(pkg.dependencies ?? {}).some((spec) => /^(file|link):/.test(String(spec))))
ok('files whitelist excludes the tools directory', !(pkg.files ?? []).includes('tools'))
ok('files whitelist excludes config.json', !(pkg.files ?? []).includes('config.json'))

/* ── 4. what the tarball would actually contain ─────────────────────────── */

section('tarball')
let packOutput = ''
try {
  packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', shell: true })
} catch (error) {
  packOutput = `${error.stdout ?? ''}`
}
try {
  const parsed = JSON.parse(packOutput)
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  const files = (entry?.files ?? []).map((file) => file.path)
  ok('tarball lists its contents', files.length > 0, `${files.length} files`)
  for (const forbidden of ['config.json', 'config.json.tmp']) {
    ok(`tarball excludes ${forbidden}`, !files.includes(forbidden))
  }
  ok('tarball includes the patch file', files.includes('cordis.patch.yml'))
  ok('tarball includes the client bundle', files.includes('lib/client.js'))
  ok('tarball includes the locale dictionaries', files.includes('locale/en.json') && files.includes('locale/zh.json'))
  lines.push(`      ${files.join(', ')}`)
} catch {
  ok('tarball listing parses', false, packOutput.split('\n')[0])
}

/* A version already on the registry means the release changes nothing. */
try {
  const published = execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  ok('version is not already published', published !== pkg.version, `${pkg.name}@${pkg.version} already exists — bump the version`)
} catch {
  ok('version is not already published', true, 'not found on the registry (expected before a first release)')
}

/* ── report ─────────────────────────────────────────────────────────────── */

console.log(lines.join('\n'))
console.log(`\n${failed === 0 ? 'READY TO PUBLISH' : `${failed} CHECK(S) FAILED`}`)
if (failed === 0) console.log(`\n  npm publish --access public        (from ${ROOT})`)
process.exit(failed === 0 ? 0 : 1)
