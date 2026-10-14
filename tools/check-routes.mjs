/**
 * End-to-end check of the configuration routes, over a real HTTP server.
 *
 * The settings page talks to the host with `fetch`, so the contract that
 * matters is not "the handler is registered" but "a POST to that path answers
 * the JSON envelope the page unwraps". This mounts the host half with a stub
 * `webServer`, serves the registered routes on a loopback port, and drives
 * them with `fetch` exactly as the browser does.
 *
 * Usage: node tools/check-routes.mjs
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/* `config.json` belongs to the user — it holds their API key, model and save
 * directory. This script never writes it, so cleanup must put back whatever it
 * found rather than delete the file: an unconditional `rmSync` here used to wipe
 * a real configuration every time `preflight.mjs` ran. */
const CONFIG = join(ROOT, 'config.json')
const savedConfig = existsSync(CONFIG) ? readFileSync(CONFIG) : null

const lines = []
let failed = 0
const ok = (label, pass, extra = '') => {
  if (!pass) failed += 1
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

/* A stub webServer that records routes so they can be served for real. */
const routes = new Map()
const services = {
  tools: { register: () => () => {} },
  webServer: {
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  },
}
/* The host half waits for `webServer` through `ctx.inject`, because the profile
 * mounts this bundle's row before the web carrier exists. The stub models that:
 * `inject` invokes its callback with a context resolving the named service,
 * exactly as Cordis does once the service appears. */
const makeCtx = () =>
  new Proxy(
    {
      get: (name) => services[name],
      effect: () => () => {},
      inject(names, callback) {
        const missing = names.filter((name) => services[name] === undefined)
        if (missing.length > 0) {
          ok(`inject(${names.join(',')}) resolves`, false, `no stub for ${missing.join(', ')}`)
          return
        }
        callback(makeCtx())
      },
    },
    {
      get(target, key) {
        if (key in target) return target[key]
        return typeof key === 'string' ? services[key] : undefined
      },
    },
  )
const ctx = makeCtx()
globalThis.harness = undefined

const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
mod.apply(ctx, {})

ok('apply() registered routes through webServer', routes.size >= 3, [...routes.keys()].join(', '))

/* The failure this guards against: the profile mounts this bundle's row BEFORE
 * the web carrier, so a one-shot `ctx.get('webServer')` finds nothing and the
 * page reports "HTTP 404" for a route that was never served. Applying with the
 * service absent must not throw, and registering it later must still attach the
 * routes — that is the whole reason the host half uses `inject`. */
{
  const late = new Map()
  const missingServer = new Proxy(
    {
      /* `tools` is present because the plugin declares it as a hard dependency,
       * so Cordis guarantees it before apply runs. Only `webServer` is absent,
       * which is what this scenario is about. */
      tools: services.tools,
      get: (name) => (name === 'tools' ? services.tools : undefined),
      effect: () => () => {},
      inject(names, callback) {
        /* Cordis defers the callback until the service exists; the stub records
         * it and runs it once the service is (pretended to be) mounted. */
        deferred = () =>
          callback(
            new Proxy(
              {
                tools: services.tools,
                get: (name) =>
                  name === 'webServer'
                    ? {
                        register: (route) => {
                          late.set(route.path, route.handler)
                          return () => late.delete(route.path)
                        },
                      }
                    : name === 'tools'
                      ? services.tools
                      : undefined,
                effect: () => () => {},
              },
              { get: (target, key) => (key in target ? target[key] : undefined) },
            ),
          )
      },
    },
    { get: (target, key) => (key in target ? target[key] : undefined) },
  )
  let deferred
  try {
    mod.apply(missingServer, {})
    ok('apply() tolerates a webServer that has not mounted yet', true)
  } catch (error) {
    ok('apply() tolerates a webServer that has not mounted yet', false, error.message)
  }
  if (deferred === undefined) {
    ok('host half waits for webServer instead of giving up', false, 'ctx.inject was never called')
  } else {
    ok('host half waits for webServer instead of giving up', true)
    deferred()
    ok('routes attach once webServer appears', late.size >= 3, [...late.keys()].join(', '))
  }
}

/* Serve them the way the host does: match by exact pathname, no auth layer. */
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  const handler = routes.get(path)
  if (handler === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  Promise.resolve(handler(req, res)).catch((error) => {
    res.writeHead(500)
    res.end(String(error))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}`
lines.push(`      serving ${routes.size} routes on ${base}`)

/** POST one route the way the browser does, and unwrap the envelope. */
async function call(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  ok(`${path} answers HTTP 200`, response.status === 200, String(response.status))
  const payload = await response.json()
  ok(`${path} answers the ok envelope`, payload !== null && typeof payload === 'object' && 'ok' in payload, JSON.stringify(payload).slice(0, 120))
  return payload
}

try {
  const config = await call('/api/imagegen/config', { action: 'get' })
  ok('config route returns a configuration', config.ok === true && typeof config.value === 'object', JSON.stringify(config.value ?? {}).slice(0, 160))
  ok('config route masks the API key', config.value?.apiKey === '***set***' || config.value?.apiKey === '', String(config.value?.apiKey))
  ok('config route reports the base URL', typeof config.value?.baseUrl === 'string' && config.value.baseUrl.length > 0, String(config.value?.baseUrl))

  const models = await call('/api/imagegen/models', {})
  ok('models route answers without throwing', models.ok === true || typeof models.error === 'string', JSON.stringify(models).slice(0, 160))

  const bad = await call('/api/imagegen/config', { action: 'set', fields: { quality: 'nonsense' } })
  ok('an invalid write is refused through the envelope', bad.ok === false && /quality must be one of/.test(String(bad.error)), String(bad.error))

  const empty = await call('/api/imagegen/config', { action: 'set', fields: {} })
  ok('an empty write is refused through the envelope', empty.ok === false, String(empty.error))

  /* An unmatched path must 404, proving the routes are the only thing served. */
  const missing = await fetch(`${base}/api/imagegen/nope`, { method: 'POST' })
  ok('an unknown path answers 404', missing.status === 404, String(missing.status))
} finally {
  await new Promise((resolve) => server.close(resolve))
  if (savedConfig === null) rmSync(CONFIG, { force: true })
  else writeFileSync(CONFIG, savedConfig)
}

console.log(lines.join('\n'))
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
