/**
 * Round-trip check for the configuration file, against the REAL filesystem.
 *
 * The smoke test runs `apply()` with a stub context, which proves the handlers
 * are wired but not that a write survives and is read back by the next call.
 * This drives the same handlers the settings page drives, then inspects the
 * file the plugin owns.
 *
 * It restores whatever was there before, so it is safe to run at any time.
 *
 * Usage: node tools/check-config-roundtrip.mjs
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CONFIG = join(ROOT, 'config.json')

const lines = []
let failed = 0
const ok = (label, pass, extra = '') => {
  if (!pass) failed += 1
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

const before = existsSync(CONFIG) ? readFileSync(CONFIG, 'utf8') : undefined

/* Same stub context as the smoke test: enough for apply() to install its RPC
 * handlers without a live harness. */
const tools = []
const handlers = new Map()
const services = { tools: { register: (definition) => (tools.push(definition), () => {}) } }
const ctx = new Proxy(
  {
    get: (name) => services[name],
    effect: () => () => {},
  },
  {
    get(target, key) {
      if (key in target) return target[key]
      return typeof key === 'string' ? services[key] : undefined
    },
  },
)
globalThis.harness = {
  handle: (method, handler) => (handlers.set(method, handler), () => handlers.delete(method)),
  defineTool: (definition) => definition,
  registerTool: () => () => {},
}

const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
mod.apply(ctx, {})
ok('apply() installed its handlers', handlers.size >= 4, `${handlers.size} handlers`)

const get = handlers.get('imagegen/config/get')
const set = handlers.get('imagegen/config/set')

try {
  /* Deliberately not asserting what the config starts as: this runs alongside
   * other checks that write it, and the round trip is the subject here. A
   * distinctive probe value goes in first, so every later assertion is about
   * this run's own write. */
  await set({ fields: { quality: 'medium', resolution: '2K', model: 'gpt-image-2.5-flare', apiKey: 'sk-roundtrip-probe' } })
  ok('write created the config file', existsSync(CONFIG))

  const written = JSON.parse(readFileSync(CONFIG, 'utf8'))
  ok('file holds the written values', written.quality === 'medium' && written.resolution === '2K' && written.model === 'gpt-image-2.5-flare', JSON.stringify(written))
  ok('the API key is stored in the file', written.apiKey === 'sk-roundtrip-probe')

  const reread = await get({})
  ok('read reflects the write', reread.quality === 'medium' && reread.resolution === '2K' && reread.model === 'gpt-image-2.5-flare')
  ok('read never returns the raw API key', reread.apiKey === '***set***', `apiKey=${reread.apiKey}`)

  /* A patch must merge, not replace: an unspecified field keeps its value. */
  await set({ fields: { resolution: '4K' } })
  const merged = JSON.parse(readFileSync(CONFIG, 'utf8'))
  ok('a patch merges into the stored values', merged.quality === 'medium' && merged.model === 'gpt-image-2.5-flare' && merged.resolution === '4K', JSON.stringify(merged))

  /* An empty key field from the page means "keep the current key". */
  await set({ fields: { quality: 'high' } })
  const kept = JSON.parse(readFileSync(CONFIG, 'utf8'))
  ok('an omitted API key is preserved', kept.apiKey === 'sk-roundtrip-probe')

  /* An invalid value must be refused before anything reaches the file. */
  try {
    await set({ fields: { resolution: '8K' } })
    ok('an invalid value is refused', false, 'no error thrown')
  } catch (error) {
    ok('an invalid value is refused', /resolution must be one of/.test(error.message), error.message)
    ok('a refused write left the file untouched', JSON.parse(readFileSync(CONFIG, 'utf8')).resolution === '4K')
  }

  /* With no file at all — a fresh install — a read must fall back to the
   * built-in defaults rather than failing. */
  rmSync(CONFIG, { force: true })
  const defaults = await get({})
  ok('a missing file falls back to built-in defaults', defaults.quality === 'high' && String(defaults.baseUrl).startsWith('https://'), JSON.stringify({ quality: defaults.quality, baseUrl: defaults.baseUrl }))
} catch (error) {
  ok('round trip completes', false, error.message)
} finally {
  /* The factory state of this plugin is "no config.json" — every value then
   * comes from the built-in defaults. Restoring a pre-run snapshot would be
   * wrong: an earlier failing run can have left a dirty snapshot behind, and
   * that is exactly how a stray `quality: low` survived once. Any real user
   * configuration is theirs to keep, so this only ever removes a file this
   * check itself produced. */
  if (before === undefined) {
    rmSync(CONFIG, { force: true })
    ok('no config file left behind', !existsSync(CONFIG))
  } else {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(CONFIG, before)
    ok('existing user configuration preserved', existsSync(CONFIG))
  }
}

console.log(lines.join('\n'))
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
