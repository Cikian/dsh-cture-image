#!/usr/bin/env node
/**
 * One-command gate before this bundle is installed into (or removed from) a
 * profile.
 *
 * The reason this exists: a bundle whose client id disagrees with its package
 * name takes the WHOLE web boot down — the app refuses to start, and the only
 * way back is the crash dialog's recovery button. That happened once. Every
 * check that could have caught it runs here, in the order that finds the
 * cheapest failure first.
 *
 * Usage:
 *   node tools/preflight.mjs                 # bundle self-consistency only
 *   node tools/preflight.mjs --profile desktop
 *   node tools/preflight.mjs --profile web
 *
 * With `--profile`, the profile's own files are read too and the bundle is
 * checked against them: the name must appear in `dependencies` (which is what
 * puts it in the "已安装" group) and in `dsh.profile.bundles` (which is what
 * mounts it), its link must resolve, and nothing may disagree.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { describeInstalledDir } from './install-dir.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

const args = process.argv.slice(2)
const profileFlag = args.indexOf('--profile')
const profileName = profileFlag === -1 ? undefined : args[profileFlag + 1]

const lines = []
let failed = 0
const ok = (label, pass, extra = '') => {
  if (!pass) failed += 1
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}
const section = (title) => lines.push(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NAME = pkg.name

/* ── stage 1: bundle self-consistency ───────────────────────────────────── */

for (const script of ['verify-bundle.mjs', 'smoke-host.mjs', 'check-config-roundtrip.mjs', 'check-routes.mjs']) {
  section(`stage 1: ${script}`)
  try {
    const output = execFileSync(process.execPath, [join(HERE, script)], { encoding: 'utf8' })
    const summary = output.trim().split('\n').pop()
    ok(`${script} exits clean`, /ALL CHECKS PASSED/.test(output), summary)
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const failures = output.split('\n').filter((line) => line.startsWith('FAIL'))
    ok(`${script} exits clean`, false, failures.join(' / ') || error.message)
  }
}

/* ── stage 2: profile agreement ─────────────────────────────────────────── */

if (profileName !== undefined) {
  section(`stage 2: profile "${profileName}"`)
  const profileDir = join(HOME, '.dsh', 'profiles', profileName)
  ok('profile directory exists', existsSync(profileDir), profileDir)

  const manifestPath = join(profileDir, 'package.json')
  ok('profile manifest exists', existsSync(manifestPath))

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dependencies = Object.keys(manifest.dependencies ?? {})
    const bundles = manifest.dsh?.profile?.bundles ?? []

    const wantInstalled = dependencies.includes(NAME)
    const wantEnabled = bundles.includes(NAME)
    lines.push(`      in dependencies (已安装 group): ${wantInstalled}`)
    lines.push(`      in dsh.profile.bundles (mounts it): ${wantEnabled}`)

    /* `installed` alone is enough for the profile to try mounting the row the
     * bundle's patch declares, so a half-configured profile is a real state:
     * installed-but-not-enabled still loads the plugin. */
    if (wantInstalled) {
      const linkDir = join(profileDir, 'node_modules', NAME)
      /* Both install shapes are legitimate: a junction into the source (the
       * development loop) and a real unpacked directory (the published
       * artifact). Which one this is decides whether source edits reach the
       * host, so it is reported rather than assumed. */
      const shape = existsSync(linkDir) ? describeInstalledDir(linkDir) : 'missing'
      ok(`installed package is present in node_modules — ${shape}`, existsSync(linkDir), linkDir)
      if (existsSync(linkDir)) {
        try {
          const linked = JSON.parse(readFileSync(join(linkDir, 'package.json'), 'utf8'))
          ok('installed package keeps the expected name', linked.name === NAME, linked.name)
          if (shape === 'installed directory') {
            const carried = existsSync(join(linkDir, 'config.json'))
            lines.push(`      packed install: ${carried ? 'config.json carried over' : 'no config.json — the API key must be entered in the UI'}`)
          }
        } catch (error) {
          ok('installed package.json parses', false, error.message)
        }
      }
      const require = createRequire(manifestPath)
      for (const spec of [NAME, `${NAME}/client`, `${NAME}/cordis.patch.yml`]) {
        try {
          ok(`resolves from the profile: ${spec}`, existsSync(require.resolve(spec)))
        } catch (error) {
          ok(`resolves from the profile: ${spec}`, false, error.message.split('\n')[0])
        }
      }
    } else {
      lines.push('      (not installed into this profile — profile agreement checks skipped)')
    }

    /* A stale entry for a name this bundle used to have is what produced the
     * duplicate-registration crash, so it is checked for explicitly. */
    const staleNames = ['@stargis/dsh-imagegen', 'dsh-imagegen']
    const staleInProfile = [...dependencies, ...bundles].filter((entry) => staleNames.includes(entry))
    ok('profile carries no stale name for this bundle', staleInProfile.length === 0, staleInProfile.join(', '))

    for (const entry of dependencies) {
      if (!existsSync(join(profileDir, 'node_modules', entry))) ok(`dependency ${entry} is present in node_modules`, false, 'missing')
    }
  }
}

/* ── report ─────────────────────────────────────────────────────────────── */

console.log(lines.join('\n'))
console.log(`\n${failed === 0 ? 'PREFLIGHT PASSED' : `${failed} CHECK(S) FAILED`}`)
if (failed === 0 && profileName !== undefined) {
  console.log('\nSafe to (re)start the host for this profile.')
}
process.exit(failed === 0 ? 0 : 1)
