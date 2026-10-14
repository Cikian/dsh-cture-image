/**
 * Pre-install verification for the Cture Image bundle.
 *
 * A mismatch between the package name and the id a bundle registers with fails
 * the ENTIRE web boot with
 *   `client-modules: duplicate factory registration for "<id>"`
 * or
 *   `bundle <url> loaded without registering "<package>" via __ModuleLoader__.load`
 * which takes the whole application down, not just this plugin. So every place
 * the name appears is checked here, and the client bundle is actually executed
 * against a stub of the module loader rather than merely syntax-checked.
 *
 * Usage: node tools/verify-bundle.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const lines = []
let failed = 0
const ok = (label, pass, extra = '') => {
  if (!pass) failed += 1
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

/* ── 1. the four places the name appears must agree ─────────────────────── */

const pkgPath = join(ROOT, 'package.json')
ok('package.json exists', existsSync(pkgPath))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const NAME = pkg.name
lines.push(`      package name: ${NAME}`)

const clientSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const registeredId = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(clientSrc)?.[1]
ok('client bundle registers under the package name', registeredId === NAME, `registered: ${registeredId}`)

const patchSrc = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
const patchName = /^\s*name:\s*"([^"]+)"/m.exec(patchSrc)?.[1]
ok('patch row names the package', patchName === NAME, `patch: ${patchName}`)

const patchRowId = /^\s*-\s*id:\s*(\S+)/m.exec(patchSrc)?.[1]
ok('patch row declares an id', typeof patchRowId === 'string' && patchRowId.length > 0, `row id: ${patchRowId}`)

/* The plugin hand-rolls these, so they drift silently. */
const clientPkgConst = /const PACKAGE_NAME = '([^']+)'/.exec(clientSrc)?.[1]
ok('client PACKAGE_NAME constant matches', clientPkgConst === NAME, `constant: ${clientPkgConst}`)
const clientRowConst = /const PATCH_ROW_ID = '([^']+)'/.exec(clientSrc)?.[1]
ok('client PATCH_ROW_ID matches the patch row id', clientRowConst === patchRowId, `constant: ${clientRowConst}`)

/* No stale name from a previous rename may survive anywhere in the package. */
const STALE = ['@stargis/dsh-imagegen', 'dsh-imagegen']
for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/host.js', 'lib/client.js']) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const hit = STALE.find((stale) => text.includes(stale))
  ok(`no stale package name in ${file}`, hit === undefined, hit === undefined ? '' : `found "${hit}"`)
}

/* ── 2. discovery contract ──────────────────────────────────────────────── */

ok('declares dsh.bundle.patch', typeof pkg.dsh?.bundle?.patch === 'string', String(pkg.dsh?.bundle?.patch))
ok('patch file exists', existsSync(join(ROOT, String(pkg.dsh?.bundle?.patch))))
ok('declares dsh.client for web', pkg.dsh?.client?.platform === 'web')
ok('exports "./client"', typeof pkg.exports?.['./client'] === 'string', String(pkg.exports?.['./client']))
ok('exports "./cordis.patch.yml"', typeof pkg.exports?.['./cordis.patch.yml'] === 'string')
ok('main points at the host entry', existsSync(join(ROOT, String(pkg.main))))

/* ── 3. execute the client bundle against a loader stub ─────────────────── */

/**
 * A React stub. The bundle only calls these at render time, so identity
 * behaviour is enough to prove the factory body runs and returns its face.
 */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  createContext: (value) => ({ Provider: 'Provider', Consumer: 'Consumer', _value: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  memo: (component) => component,
  Fragment: 'Fragment',
}

let registration
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (value) => {
        if (registration !== undefined) throw new Error(`this bundle registered twice (id: ${value?.id})`)
        registration = value
      },
    },
  },
  document: { createElement: () => ({ style: {}, appendChild: () => {}, remove: () => {}, click: () => {} }), head: { appendChild: () => {} }, body: { appendChild: () => {} }, querySelector: () => null },
  console,
  URL,
  Blob: class {},
  setTimeout,
  clearTimeout,
}
sandbox.globalThis = sandbox

try {
  vm.runInNewContext(clientSrc, vm.createContext(sandbox), { filename: 'client.js' })
  ok('client bundle executes without throwing', true)
} catch (error) {
  ok('client bundle executes without throwing', false, error.message)
}

ok('client bundle registered exactly once', registration !== undefined)
if (registration !== undefined) {
  ok('registered id equals the package name', registration.id === NAME, `registered: ${registration.id}`)
  ok('registration carries a factory', typeof registration.factory === 'function')
  if (typeof registration.factory === 'function') {
    /* `require` is the module system's; unknown specifiers throw there too, so
     * answer the seed words the bundle is allowed to ask for. */
    const seed = {
      react: reactStub,
      'react/jsx-runtime': { jsx: reactStub.createElement, jsxs: reactStub.createElement, Fragment: 'Fragment' },
    }
    try {
      const face = registration.factory((spec) => {
        if (spec in seed) return seed[spec]
        throw new Error(`client bundle required "${spec}", which is not a platform seed word`)
      })
      ok('factory returns a plugin face', face !== null && typeof face === 'object')
      ok('face exports apply', typeof face?.apply === 'function')
      ok('face inject is a string array', Array.isArray(face?.inject), JSON.stringify(face?.inject))
      /* apply() must not throw when the slot service is absent: the real host
       * may mount this bundle before slots exist. */
      try {
        face.apply({ get: () => undefined })
        ok('apply() tolerates a missing slot service', true)
      } catch (error) {
        ok('apply() tolerates a missing slot service', false, error.message)
      }
      /* With a slot service present it must register the three contributions. */
      const registered = []
      const slots = {
        inject: (key, callback) => {
          callback()
          registered.push(key)
        },
        register: (options) => {
          registered.push(`${options.name}:${options.key ?? options.id ?? ''}`)
        },
      }
      try {
        face.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
        ok('apply() registers every contribution', registered.length >= 3, registered.join(' | '))
        ok('registers the tool card view', registered.some((entry) => entry.includes('tool.call.toolview:generate_image')))
        ok('registers the bundle config slot keyed by package name', registered.some((entry) => entry === `plugins.bundle.config:${NAME}`))
      } catch (error) {
        ok('apply() registers every contribution', false, error.message)
      }
    } catch (error) {
      ok('factory materializes', false, error.message)
    }
  }
}

/* ── 4. the host half must import and export the plugin face ────────────── */

try {
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  ok('host half imports', true)
  ok('host half exports apply', typeof mod.apply === 'function')
  ok('host half exports inject', Array.isArray(mod.inject), JSON.stringify(mod.inject))
  ok("host inject is exactly ['tools']", JSON.stringify(mod.inject) === '["tools"]', JSON.stringify(mod.inject))
} catch (error) {
  ok('host half imports', false, error.message)
}

/* ── 5. the HTTP routes must match on both sides ───────────────────────── */

const hostSrc = readFileSync(join(ROOT, 'lib', 'host.js'), 'utf8')
const served = [...hostSrc.matchAll(/path: '(\/api\/imagegen\/[^']+)'/g)].map((match) => match[1])
const called = [...clientSrc.matchAll(/const \w+_ROUTE = '(\/api\/imagegen\/[^']+)'/g)].map((match) => match[1])

ok('host half serves configuration routes', served.length > 0, served.join(', '))
for (const route of called) {
  ok(`route ${route} is served by the host`, served.includes(route))
}
ok('no host route is unreachable from the client', served.every((route) => called.includes(route)), served.join(', '))

/* `webServer` mounts after this row, so the routes must be attached through a
 * deferred injection rather than a one-shot lookup — the difference between a
 * working page and an HTTP 404. */
ok('host half waits for webServer via ctx.inject', /ctx\.inject\(\['webServer'\]/.test(hostSrc))
ok('host half guards against a context without inject', /typeof ctx\?\.inject === 'function'/.test(hostSrc))

/* The settings page must use the transport a BUNDLE can reach. `host.call` is
 * a dynamic-plugin builtin; referencing it here is how the form silently
 * failed to render before. */
ok('client does not use the dynamic-plugin builtin', !/host\.call\s*\(/.test(clientSrc))
ok('client reaches the host over fetch', /fetch\(route/.test(clientSrc))
ok('client unwraps the ok envelope', /payload\.ok !== true/.test(clientSrc))

/* The form must render its own failures: a blank panel with no message is
 * indistinguishable from a plugin that did not load. */
ok('client surfaces host errors as text', /error instanceof Error \? error\.message/.test(clientSrc))

/* ── report ─────────────────────────────────────────────────────────────── */

console.log(lines.join('\n'))
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
