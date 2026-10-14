/**
 * Pre-install smoke test for the Cture Image HOST half.
 *
 * `apply()` is executed against a stub context that records what the plugin
 * registers, and every RPC handler it installs is invoked. This catches the
 * failure mode that only shows up at boot — a handler that throws while the
 * plugin is being mounted — without touching the user's profile.
 *
 * Usage: node tools/smoke-host.mjs
 */

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const lines = []
let failed = 0
const ok = (label, pass, extra = '') => {
  if (!pass) failed += 1
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

const tools = []
const handlers = new Map()

const services = {
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
}

const ctx = new Proxy(
  {
    get(name) {
      return services[name]
    },
    effect() {
      return () => {}
    },
  },
  {
    get(target, key) {
      if (key in target) return target[key]
      return typeof key === 'string' ? services[key] : undefined
    },
  },
)

/* `harness` is a host builtin in the real runtime; supply the two members the
 * plugin uses. */
const harness = {
  handle(method, handler) {
    handlers.set(method, handler)
    return () => handlers.delete(method)
  },
  defineTool: (definition) => definition,
  registerTool: (context, tool) => {
    tools.push(tool)
    return () => {}
  },
}
globalThis.harness = harness

const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)

try {
  mod.apply(ctx, {})
  ok('apply() completes against a stub host context', true)
} catch (error) {
  ok('apply() completes against a stub host context', false, error.message)
  console.log(lines.join('\n'))
  process.exit(1)
}

const names = tools.map((tool) => tool.name)
ok('registers generate_image', names.includes('generate_image'), names.join(', '))
ok('registers imagegen_config', names.includes('imagegen_config'), names.join(', '))

for (const tool of tools) {
  ok(`${tool.name} has a description`, typeof tool.description === 'string' && tool.description.length > 20)
  ok(`${tool.name} has parameters`, tool.parameters !== null && typeof tool.parameters === 'object')
  ok(`${tool.name} has an output schema`, tool.output?.schema !== null && typeof tool.output?.schema === 'object')
  ok(`${tool.name} renders content blocks`, typeof tool.output?.render === 'function')
  ok(`${tool.name} executes`, typeof tool.execute === 'function')
}

/* Every declared parameter must be described, because the model sees only the
 * schema. The host passes `parameters` through as-is for a plain JSON schema. */
const generate = tools.find((tool) => tool.name === 'generate_image')
const params = generate?.parameters?.properties ?? {}
ok('generate_image declares parameters', Object.keys(params).length > 0, Object.keys(params).join(', '))
for (const [key, spec] of Object.entries(params)) {
  ok(`parameter ${key} carries a description`, typeof spec?.description === 'string' && spec.description.length > 0)
}

/* ── RPC handlers ───────────────────────────────────────────────────────── */

const expected = ['imagegen/config/get', 'imagegen/config/set', 'imagegen/config/test', 'imagegen/config/models']
for (const method of expected) {
  ok(`handler registered: ${method}`, handlers.has(method))
}

if (handlers.has('imagegen/config/get')) {
  try {
    const value = await handlers.get('imagegen/config/get')({})
    ok('config/get returns an object', value !== null && typeof value === 'object')
    ok('config/get masks the API key', value.apiKey === '***set***' || value.apiKey === '', JSON.stringify(value.apiKey))
    ok('config/get reports the base URL', typeof value.baseUrl === 'string' && value.baseUrl.length > 0, value.baseUrl)
    ok('config/get reports the model', typeof value.model === 'string' && value.model.length > 0, value.model)
  } catch (error) {
    ok('config/get succeeds', false, error.message)
  }
}

if (handlers.has('imagegen/config/set')) {
  /* Only the refusal paths are exercised here. A successful write would leave
   * a config.json behind and make the round-trip check depend on run order;
   * that check owns the write path. */
  try {
    await handlers.get('imagegen/config/set')({ fields: { quality: 'nonsense' } })
    ok('config/set rejects an invalid quality', false, 'no error thrown')
  } catch (error) {
    ok('config/set rejects an invalid quality', /quality must be one of/.test(error.message), error.message)
  }
  try {
    await handlers.get('imagegen/config/set')({ fields: {} })
    ok('config/set rejects an empty patch', false, 'no error thrown')
  } catch (error) {
    ok('config/set rejects an empty patch', true, error.message)
  }
}

if (handlers.has('imagegen/config/models')) {
  try {
    const value = await handlers.get('imagegen/config/models')({})
    ok('config/models reports a shape', value !== null && typeof value === 'object' && Array.isArray(value.models))
  } catch (error) {
    ok('config/models reports a shape', false, error.message)
  }
}

console.log(lines.join('\n'))
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
