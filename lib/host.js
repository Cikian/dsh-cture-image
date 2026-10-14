/**
 * dsh-cture-image — Host half.
 *
 * A self-contained image generation capability for the DeepSeek Harness,
 * talking to an OpenAI-compatible image API:
 *
 *   POST {baseUrl}/images/generations   text -> image
 *   POST {baseUrl}/images/edits         image + prompt -> image (multipart)
 *
 * Deliberately imports NOTHING — no `@deepseek-ai/*` package and no Node
 * built-in. The Cordis loader mounts this file by absolute path, and a plugin
 * outside the installation tree cannot be assumed to resolve the
 * installation's dependency closure: the CLI profile resolves through a
 * junction into the npx cache, while the desktop host resolves through its own
 * asar, and neither is reachable from a plugin directory in a portable way.
 * Everything this half needs is therefore either a platform global (`fetch`,
 * `FormData`, `Blob`, `Buffer`), a Node builtin, or a service read through
 * `ctx.get(...)` — and the `Config` schema the settings system reads is
 * emitted in schemastery's wire format by hand (see `buildConfig`).
 *
 * @module @cikian/dsh-cture-image
 */

import { existsSync, readFileSync } from 'node:fs'

/** Stable Loader identity. */
export const name = 'imagegen'

/**
 * Shipped defaults.
 *
 * `apiKey` is deliberately EMPTY: this file is published, so a key here would
 * be handed to every user and billed to its owner. Each user supplies their own
 * through the plugin's configuration page, which stores it in the config file
 * beside this module rather than in the package.
 *
 * `baseUrl` points at the maintainer's relay as a convenience default, and any
 * OpenAI-compatible endpoint can be substituted on the same page.
 */
const BUILTIN = {
  /* Default image endpoint. It is OpenAI-compatible; a single machine can point
   * somewhere else with `config.json`, which takes precedence over this value. */
  baseUrl: 'https://api.cikhub.com/v1',
  apiKey: '',
  model: 'gpt-image-2.5-sunburst',
  quality: 'high',
  resolution: '1K',
  aspectRatio: '16:9',
  count: 1,
  saveDir: 'saved-images',
  optimizePrompt: true,
  concurrency: 2,
}

/** Image models this plugin knows about, with the task each one suits. */
const MODELS = [
  { id: 'gpt-image-2.5-sunburst', use: 'character design, key visuals, complex composition' },
  { id: 'gpt-image-2.5-flare', use: 'batch product sketches, cover candidates, social images' },
  { id: 'gpt-image-2.5', use: 'general purpose' },
]

const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max']
const RESOLUTIONS = ['1K', '2K', '4K']
const ASPECT_RATIOS = ['1:1', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21']

/** Aspect ratio as a reduced pair. */
const RATIO = {
  '1:1': [1, 1],
  '2:3': [2, 3],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '21:9': [21, 9],
  '9:21': [9, 21],
}

/** Target long-edge pixels per resolution tier. */
const TIER_LONG_EDGE = { '1K': 1024, '2K': 2048, '4K': 4096 }
/** Target pixel budget per resolution tier. */
const TIER_PIXELS = { '1K': 1280 * 720, '2K': 2048 * 1152, '4K': 4096 * 2304 }

/** Keys a caller may change through `imagegen_config` and the settings tab. */
const SETTABLE = ['baseUrl', 'apiKey', 'model', 'quality', 'resolution', 'aspectRatio', 'count', 'saveDir', 'optimizePrompt', 'concurrency']

/**
 * The plugin's configuration schema.
 *
 * Every field is `volatile()` because that is what makes it appear in the
 * settings form and let the settings page write it without remounting the
 * plugin. A volatile field arrives as a reference object (`{ get() }`) rather
 * than a plain value, which is why every read below goes through `field()`.
 *
 * The schema carries the same defaults as `BUILTIN` so a composition row with
 * no `config` block still resolves to a working capability.
 */
/**
 * The plugin's configuration schema, emitted in schemastery's wire format.
 *
 * Three consumers read it, and each needs a different facet:
 *
 *   - cordis `resolveConfig` calls `Config['~standard'].validate(config)` to
 *     validate the composition row and to materialize defaults;
 *   - `dsh-settings` checks `'toJSON' in Config` and rebuilds the schema with
 *     `new z(Config.toJSON())` to render the settings form, so `toJSON()` must
 *     return the `{ uid, refs }` envelope with numeric uids in each `dict`;
 *   - `volatileForm` looks for `meta.volatile` to decide which fields the
 *     settings page may write live.
 *
 * Building that by hand is what lets this plugin import nothing.
 * @param spec - field name to `{ type, default, role?, description? }`.
 * @returns a callable schema carrying `toJSON` and `~standard`.
 */
function buildConfig(spec) {
  const refs = {}
  const dict = {}
  let uid = 1
  for (const [key, field] of Object.entries(spec)) {
    const id = uid++
    const meta = { default: field.default, volatile: true }
    if (field.role !== undefined) meta.role = field.role
    if (field.description !== undefined) meta.description = field.description
    refs[id] = { uid: id, type: field.type, meta }
    dict[key] = id
  }
  const root = uid++
  refs[root] = { uid: root, type: 'object', meta: { default: {} }, dict }
  const defaults = Object.fromEntries(Object.entries(spec).map(([key, field]) => [key, field.default]))

  const resolve = (input) => {
    const source = input === null || typeof input !== 'object' || Array.isArray(input) ? {} : input
    const out = { ...defaults }
    for (const [key, field] of Object.entries(spec)) {
      if (!(key in source)) continue
      const value = source[key]
      if (value === undefined) continue
      if (field.type === 'number') {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) throw new TypeError(`${key} must be a number`)
        out[key] = numeric
      } else if (field.type === 'boolean') {
        out[key] = Boolean(value)
      } else {
        const asText = String(value)
        if (asText.trim().length === 0) throw new TypeError(`${key} must be a non-empty string`)
        out[key] = asText
      }
    }
    return out
  }

  resolve.toJSON = () => ({ uid: root, refs })
  resolve['~standard'] = {
    version: 1,
    vendor: 'imagegen',
    validate(value) {
      try {
        return { value: resolve(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error), path: [] }] }
      }
    },
  }
  return resolve
}

/**
 * The plugin's configuration schema.
 *
 * Every field is volatile because that is what makes it appear in the settings
 * form and lets the settings page write it without remounting the plugin. The
 * defaults mirror `BUILTIN` so a composition row with no `config` block still
 * resolves to a working capability.
 */
export const Config = buildConfig({
  baseUrl: { type: 'string', default: BUILTIN.baseUrl, description: 'OpenAI-compatible API root, e.g. https://api.cikhub.com/v1' },
  apiKey: { type: 'string', default: BUILTIN.apiKey, role: 'secret', description: 'Bearer token for the image API' },
  model: { type: 'string', default: BUILTIN.model, description: 'Default image model id' },
  quality: { type: 'string', default: BUILTIN.quality, description: 'Default quality tier' },
  resolution: { type: 'string', default: BUILTIN.resolution, description: 'Default resolution tier (1K/2K/4K)' },
  aspectRatio: { type: 'string', default: BUILTIN.aspectRatio, description: 'Default aspect ratio' },
  count: { type: 'number', default: BUILTIN.count, description: 'Default images per call' },
  saveDir: { type: 'string', default: BUILTIN.saveDir, description: 'Workspace-relative directory for saved originals' },
  optimizePrompt: { type: 'boolean', default: BUILTIN.optimizePrompt, description: 'Append rendering guidance to the prompt automatically' },
  concurrency: { type: 'number', default: BUILTIN.concurrency, description: 'Parallel requests for batch generation' },
})

/**
 * Required services.
 *
 * `tools` is where this plugin's whole contribution lands: a pair of
 * model-facing tools. `settings` carries the runtime configuration namespace,
 * declared as required because a composition that mounts this row but no
 * settings provider could not persist or edit anything, and failing loudly at
 * boot beats a tool that can never be configured.
/**
 * Required services.
 *
 * `tools` is where this plugin's whole contribution lands: a pair of
 * model-facing tools. Nothing else is required — the configuration lives in a
 * file this plugin owns, so there is no settings namespace to wait for and no
 * profile patch schema to keep in step.
 *
 * The Cordis inject declaration is an ARRAY of service names — there is no
 * `{ required, optional }` form, and an object here is read as one service per
 * key, which leaves the entry waiting forever for services literally named
 * `required` and `optional`.
 */
export const inject = ['tools']

/* ─────────────────────────── shared helpers ───────────────────────────── */

/** Narrow a value to a plain record. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty trimmed string, or undefined. */
function text(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** First array element when the value is an array, else the value itself. */
function list(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Strip every `undefined` reachable from a tool result.
 *
 * Every value a tool returns is serialized into the session log, and the
 * registry rejects a result where `undefined` is reachable — a present-and-
 * undefined field is not lossless JSON. The check runs before render
 * presentation, so it must be applied to the whole returned tree rather than
 * to the fields a particular code path happened to remember.
 * @param value - a JSON-ish value.
 * @returns the same shape with absent optional fields actually absent.
 */
function lossless(value) {
  if (Array.isArray(value)) return value.map(lossless)
  if (isRecord(value)) {
    const out = {}
    for (const [key, entry] of Object.entries(value)) if (entry !== undefined) out[key] = lossless(entry)
    return out
  }
  return value
}

/** Join a base URL with a suffix without doubling or dropping the slash. */
function joinUrl(baseUrl, suffix) {
  return `${String(baseUrl).replace(/\/+$/u, '')}/${suffix}`
}

/**
 * Reduce an aspect ratio to its smallest integer pair.
 * @param width - ratio numerator.
 * @param height - ratio denominator.
 * @returns the reduced pair.
 */
function reduceRatio(width, height) {
  let a = Math.max(1, Math.round(width))
  let b = Math.max(1, Math.round(height))
  while (b !== 0) {
    const rest = a % b
    a = b
    b = rest
  }
  const divisor = Math.max(1, a)
  return [Math.max(1, Math.round(width / divisor)), Math.max(1, Math.round(height / divisor))]
}

/**
 * Reduce a free-form aspect label such as `16:9`, `3x2`, or `1.5` to a pair.
 * @param value - candidate label.
 * @returns the ratio pair, or undefined when it is unusable.
 */
function parseRatio(value) {
  const raw = text(value)
  if (raw === undefined) return undefined
  const pair = /^(\d+(?:\.\d+)?)\s*[:xX/]\s*(\d+(?:\.\d+)?)$/u.exec(raw)
  if (pair !== null) {
    const width = Number(pair[1])
    const height = Number(pair[2])
    if (width > 0 && height > 0) return reduceRatio(width, height)
  }
  const scalar = Number(raw)
  if (Number.isFinite(scalar) && scalar > 0) return reduceRatio(scalar, 1)
  return undefined
}

/**
 * Map a resolution tier plus aspect ratio onto the pixel size sent upstream.
 * gpt-image models take `size` as pixels, so the aspect ratio is expressed
 * through the dimensions themselves.
 * @param resolution - `1K`, `2K`, or `4K`.
 * @param ratio - reduced aspect pair.
 * @returns the request size and the tier's nominal target.
 */
function planSize(resolution, ratio) {
  const [rw, rh] = ratio
  const longEdge = TIER_LONG_EDGE[resolution] ?? TIER_LONG_EDGE['1K']
  const budget = TIER_PIXELS[resolution] ?? TIER_PIXELS['1K']
  const byLongEdge = longEdge / Math.max(rw, rh)
  const byBudget = Math.sqrt(budget / (rw * rh))
  const unit = Math.max(16, Math.floor(Math.min(byLongEdge, byBudget) / 16) * 16)
  return { width: rw * unit, height: rh * unit, target: `${longEdge}px long edge` }
}

/** Media type of an encoded image, or undefined when it is not a known format. */
function mediaTypeOf(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length > 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  return undefined
}

/** Intrinsic size of a PNG, JPEG, or GIF buffer when it can be read cheaply. */
function measure(bytes, mediaType) {
  const be32 = (at) => (bytes[at] * 16777216) + (bytes[at + 1] * 65536) + (bytes[at + 2] * 256) + bytes[at + 3]
  const be16 = (at) => (bytes[at] * 256) + bytes[at + 1]
  try {
    if (mediaType === 'image/png' && bytes.length > 24) return { width: be32(16), height: be32(20) }
    if (mediaType === 'image/gif' && bytes.length > 10) return { width: bytes[6] + (bytes[7] * 256), height: bytes[8] + (bytes[9] * 256) }
    if (mediaType === 'image/jpeg') {
      let at = 2
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) {
          at += 1
          continue
        }
        const marker = bytes[at + 1]
        const length = be16(at + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: be16(at + 7), height: be16(at + 5) }
        }
        at += 2 + Math.max(2, length)
      }
    }
  } catch {
    return { width: 0, height: 0 }
  }
  return { width: 0, height: 0 }
}

/** File extension for a media type. */
function extensionOf(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

/** Filesystem-safe slug of a prompt, used in generated file names. */
function slug(prompt) {
  const ascii = String(prompt).replace(/[^\w\s-]/gu, ' ').trim().replace(/[\s_-]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (ascii.length > 0) return ascii.slice(0, 48).toLowerCase()
  return `image-${Date.now().toString(36)}`
}

/** Timestamp used in generated file names: 20260909-143012. */
function stamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Strengthen a prompt without a second model call: keep the user's words and
 * append the rendering vocabulary these models respond to.
 * @param prompt - the caller's original prompt.
 * @param spec - the resolved generation plan.
 * @returns the prompt actually sent upstream.
 */
function enhancePrompt(prompt, spec) {
  const body = String(prompt).trim()
  const strength = MODELS.find((model) => model.id === spec.model)?.use ?? 'general purpose'
  return `${body}\n\n[Rendering guidance] aspect ratio ${spec.ratio}; output size ${spec.width}x${spec.height} px; quality ${spec.quality}; strength ${strength}. Keep the subject exactly as described above.`
}

/* ─────────────────────────────── the plugin ───────────────────────────── */

/**
 * Configuration file this plugin owns, beside the module itself.
 *
 * Keeping it here (rather than in the harness settings document) means a
 * settings change needs no schema, no namespace, and no profile patch row —
 * and it survives both the CLI and the desktop host, which do not share a
 * settings path.
 */
const CONFIG_URL = new URL('../config.json', import.meta.url)

/** Last configuration read from disk, refreshed on every write. */
let cache = {}

/**
 * Read the configuration file.
 *
 * A missing file is the normal first-run state and yields an empty patch; a
 * malformed one is reported and ignored, so the plugin still starts on the
 * built-in defaults instead of failing to mount.
 * @returns the stored patch.
 */
function loadConfig() {
  try {
    if (!existsSync(CONFIG_URL)) return {}
    const parsed = JSON.parse(readFileSync(CONFIG_URL, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    console.error('[imagegen] ignoring an unreadable config.json:', error)
    return {}
  }
}

cache = loadConfig()

/**
 * Build the plugin.
 * @param ctx - the plugin's context.
 * @param config - validated composition config.
 */
export function apply(ctx, config = {}) {
  const composition = isRecord(config) ? config : {}

  /**
   * Resolve one effective configuration field.
   *
   * Precedence, highest first: the file this plugin owns (`config.json`, what
   * the settings tab writes), then the composition row's `config` block, then
   * the built-in defaults. A composition value may arrive as a live reference
   * (`{ get() }`) rather than a plain value, so both shapes are accepted.
   * @param key - field name.
   * @returns the effective value.
   */
  const field = (key) => {
    const stored = cache[key]
    if (stored !== undefined && stored !== null) return stored
    const value = composition[key]
    if (value !== undefined && value !== null) {
      if (typeof value === 'object' && typeof value.get === 'function') {
        const live = value.get()
        if (live !== undefined && live !== null) return live
        return BUILTIN[key]
      }
      return value
    }
    return BUILTIN[key]
  }

  /**
   * Persist a configuration patch.
   *
   * The values live in `config.json` beside this module, which keeps the whole
   * mechanism inside the plugin: no settings namespace, no profile patch
   * schema, and nothing that can silently drop a section at import time. A
   * write is atomic (temp file + rename) so a crash mid-write cannot leave a
   * truncated document behind.
   * @param patch - fields to change.
   * @returns the applied fields.
   */
  const writeConfig = async (patch) => {
    const fs = await import('node:fs/promises')
    const next = { ...cache, ...patch }
    const temporary = new URL('../config.json.tmp', import.meta.url)
    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`)
    await fs.rename(temporary, CONFIG_URL)
    cache = next
    return patch
  }

  /* upstream calls */

  /**
   * Decode one image entry of an image API response into durable bytes.
   * @param entry - one `data[]` element.
   * @param signal - cancellation.
   * @returns the encoded bytes.
   */
  const decodeImage = async (entry, signal) => {
    if (!isRecord(entry)) throw new Error('imagegen: the API returned a malformed image entry')
    if (typeof entry.b64_json === 'string' && entry.b64_json.length > 0) {
      return new Uint8Array(Buffer.from(entry.b64_json, 'base64'))
    }
    if (typeof entry.url === 'string' && entry.url.length > 0) {
      const response = await fetch(entry.url, { signal })
      if (!response.ok) throw new Error(`imagegen: downloading ${entry.url} failed with HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    }
    throw new Error('imagegen: the API response carried neither b64_json nor url')
  }

  /**
   * Report a JSON or HTTP failure in the API's own words.
   * @param response - the failed response.
   * @returns a diagnostic string.
   */
  const failureText = async (response) => {
    let detail = ''
    try {
      const body = await response.text()
      detail = body.length > 600 ? `${body.slice(0, 600)}…` : body
    } catch {
      detail = ''
    }
    return `imagegen: the image API returned HTTP ${response.status}${detail.length === 0 ? '' : ` — ${detail}`}`
  }

  /**
   * One upstream generation or edit call.
   * @param spec - the resolved plan.
   * @param options - prompt, references, optional mask, cancellation.
   * @returns decoded images in response order.
   */
  const callApi = async (spec, options) => {
    const { signal } = options
    /* An override lets the connectivity test exercise a candidate base URL and
     * key before they are saved. */
    const override = isRecord(options.credentials) ? options.credentials : {}
    const baseUrl = text(override.baseUrl) ?? text(field('baseUrl')) ?? BUILTIN.baseUrl
    const apiKey = text(override.apiKey) ?? text(field('apiKey'))
    if (apiKey === undefined) throw new Error('imagegen: no API key is configured; set one through `imagegen_config` action:"set"')
    const size = `${spec.width}x${spec.height}`
    const endpoint = options.references.length > 0 ? 'images/edits' : 'images/generations'
    const headers = { authorization: `Bearer ${apiKey}` }
    let body

    if (endpoint === 'images/generations') {
      headers['content-type'] = 'application/json'
      body = JSON.stringify({ model: spec.model, prompt: options.prompt, n: spec.count, size, quality: spec.quality })
    } else {
      const form = new FormData()
      form.append('model', spec.model)
      form.append('prompt', options.prompt)
      form.append('size', size)
      form.append('quality', spec.quality)
      if (spec.count > 1) form.append('n', String(spec.count))
      for (const reference of options.references) {
        if (reference.bytes.byteLength > 4 * 1024 * 1024) {
          throw new Error(`imagegen: reference image ${reference.path} is too large to upload for editing (${reference.bytes.byteLength} bytes); downscale it first`)
        }
        form.append('image', new Blob([reference.bytes], { type: reference.mediaType }), reference.path.split(/[\\/]/u).pop() ?? 'reference.png')
      }
      if (options.mask !== undefined) {
        form.append('mask', new Blob([options.mask.bytes], { type: options.mask.mediaType }), options.mask.path.split(/[\\/]/u).pop() ?? 'mask.png')
      }
      body = form
    }

    const response = await fetch(joinUrl(baseUrl, endpoint), { method: 'POST', headers, body, signal })
    if (!response.ok) throw new Error(await failureText(response))
    const payload = await response.json()
    if (!isRecord(payload) || payload.error !== undefined) {
      const message = isRecord(payload) && isRecord(payload.error) ? String(payload.error.message ?? JSON.stringify(payload.error)) : 'malformed response'
      throw new Error(`imagegen: the image API reported an error — ${message}`)
    }
    const entries = list(payload.data)
    if (entries.length === 0) throw new Error('imagegen: the image API returned no images')
    const images = []
    for (const entry of entries) {
      const bytes = await decodeImage(entry, signal)
      const mediaType = mediaTypeOf(bytes) ?? 'image/png'
      const measured = measure(bytes, mediaType)
      images.push({
        bytes,
        mediaType,
        width: measured.width,
        height: measured.height,
        revisedPrompt: isRecord(entry) ? text(entry.revised_prompt) : undefined,
      })
    }
    return images
  }

  /* workspace + attachments */

  /**
   * Read one local file as bytes through the filesystem seam.
   * @param path - workspace-relative or absolute path.
   * @param exec - the tool run context.
   * @returns the bytes and resolved display path.
   */
  const readLocalFile = async (path, exec) => {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('imagegen: no filesystem provider is mounted')
    const cwd = exec.agent?.session?.header?.cwd
    const target = await fs.resolve(path, { cwd, signal: exec.signal })
    const info = await fs.stat(target, exec.signal)
    if (info === undefined || info.type !== 'file') throw new Error(`imagegen: reference image ${path} is not a regular file`)
    const bytes = await fs.readBytes(target, exec.signal, 32 * 1024 * 1024)
    const mediaType = mediaTypeOf(bytes)
    if (mediaType === undefined) throw new Error(`imagegen: reference image ${path} is not a PNG, JPEG, WebP, or GIF`)
    return { bytes, mediaType, path: target.displayPath }
  }

  /**
   * Persist one generated image: the original bytes in the workspace, plus a
   * durable attachment for in-conversation rendering.
   * @param image - decoded image.
   * @param label - prompt label used in the file name.
   * @param index - position within the response.
   * @param exec - the tool run context.
   * @returns the durable reference and the saved path.
   */
  const persist = async (image, label, index, exec) => {
    const cwd = exec.agent?.session?.header?.cwd
    if (cwd === undefined) throw new Error('imagegen: this tool needs an agent session with a workspace')
    const saveDir = text(field('saveDir')) ?? BUILTIN.saveDir
    const separator = cwd.includes('\\') ? '\\' : '/'
    const directory = `${cwd.replace(/[\\/]+$/u, '')}${separator}${saveDir}`
    const fileName = `${stamp()}-${slug(label)}-${index + 1}.${extensionOf(image.mediaType)}`
    const absolute = `${directory}${separator}${fileName}`

    const fs = ctx.get('fs')
    let savedPath = `${saveDir.replace(/\\/gu, '/')}/${fileName}`
    let hostPath = absolute

    /* The filesystem seam exposes no byte write, so the bytes are published
     * through the host's own fs module. Static `import` is impossible here: a
     * plugin outside the installation tree cannot resolve the installation's
     * dependency closure, which is why this package imports nothing at all. A
     * builtin has no closure to resolve, so importing it by name is the one
     * form that works from every context this module is loaded in. */
    const nodeFs = await import('node:fs/promises')
    await nodeFs.mkdir(directory, { recursive: true })
    await nodeFs.writeFile(absolute, image.bytes)

    const target = await fs.resolve(absolute, { signal: exec.signal })
    savedPath = target.displayPath
    hostPath = typeof fs.processPath === 'function' ? fs.processPath(target) : absolute

    const attachments = ctx.get('attachments')
    if (attachments === undefined) {
      return { savedPath, hostPath, attachment: undefined, note: 'no attachment service is mounted, so the image is available as a workspace file only' }
    }
    try {
      const ref = await attachments.saveImage({ data: image.bytes, mediaType: image.mediaType, name: fileName })
      return { savedPath, hostPath, attachment: ref, note: undefined }
    } catch (error) {
      return {
        savedPath,
        hostPath,
        attachment: undefined,
        note: `the attachment store refused the image (${error instanceof Error ? error.message : String(error)}), so it is available as a workspace file only`,
      }
    }
  }

  /* shared plumbing */

  /**
   * Narrow and default one raw argument set into a plan.
   * @param args - raw tool arguments.
   * @returns the resolved plan.
   */
  const normalize = (args) => {
    const action = ['generate', 'edit', 'batch'].includes(args.action) ? args.action : 'generate'
    const model = text(args.model) ?? text(field('model')) ?? BUILTIN.model
    const quality = QUALITIES.includes(args.quality) ? args.quality : (text(field('quality')) ?? BUILTIN.quality)
    const resolution = RESOLUTIONS.includes(args.resolution) ? args.resolution : (text(field('resolution')) ?? BUILTIN.resolution)
    const ratioLabel = ASPECT_RATIOS.includes(args.aspect_ratio) ? args.aspect_ratio : (text(field('aspectRatio')) ?? BUILTIN.aspectRatio)
    const ratio = RATIO[ratioLabel] ?? parseRatio(ratioLabel) ?? RATIO['16:9']
    const ratioText = RATIO[ratioLabel] !== undefined ? ratioLabel : `${ratio[0]}:${ratio[1]}`
    const requested = Number.isSafeInteger(args.count) && args.count > 0 ? args.count : Number(field('count')) || BUILTIN.count
    const count = Math.min(8, Math.max(1, Math.trunc(requested)))
    const plan = {
      action,
      model,
      quality,
      resolution,
      ratio: ratioText,
      count,
      ...planSize(resolution, ratio),
    }
    plan.enhance = args.optimize_prompt === false ? false : (args.optimize_prompt === true ? true : field('optimizePrompt') !== false)
    plan.prompts = list(args.prompts).map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
    return plan
  }

  /** Content blocks for one settled image call. */
  const imageContent = (value) => {
    const lines = value.images.map((image) => {
      const size = image.width > 0 && image.height > 0 ? `${image.width}x${image.height} px` : 'size unknown'
      const revised = image.revised_prompt === undefined ? '' : `\n  revised prompt: ${image.revised_prompt}`
      return `<path>${image.path}</path>\n<type>image</type>\n<content>\n${image.media_type} image, ${size}, ${image.bytes} bytes${revised}\n</content>`
    })
    const blocks = [{ type: 'text', text: lines.join('\n') }]
    for (const image of value.images) {
      if (image.attachment_id === undefined) continue
      blocks.push({
        type: 'image',
        attachment: {
          attachmentId: image.attachment_id,
          mediaType: image.media_type,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          /* A present-and-undefined field would make this block — mirrored into
           * the session log — reject as non-lossless JSON. */
          ...image.name === undefined ? {} : { name: image.name },
        },
      })
    }
    return blocks
  }

  /**
   * Run one prompt end to end.
   * @param plan - the resolved plan.
   * @param prompt - the caller's prompt.
   * @param references - reference images for an edit.
   * @param mask - optional mask.
   * @param label - file-name label.
   * @param exec - the tool run context.
   * @returns the persisted images.
   */
  const runOne = async (plan, prompt, references, mask, label, exec) => {
    const outbound = plan.enhance ? enhancePrompt(prompt, plan) : prompt
    const images = await callApi({ ...plan, prompt: outbound }, { prompt: outbound, references, mask, signal: exec.signal })
    const results = []
    let at = 0
    for (const image of images) {
      const stored = await persist(image, label, at, exec)
      /* Built from scratch, conditionally: a present-and-undefined field would
       * make the tool result reject as non-lossless JSON. */
      const entry = {
        index: at + 1,
        path: stored.savedPath,
        host_path: stored.hostPath,
        media_type: image.mediaType,
        bytes: image.bytes.byteLength,
        width: image.width,
        height: image.height,
        name: stored.attachment?.name ?? (stored.savedPath.split(/[\\/]/u).pop() ?? 'image.png'),
      }
      if (stored.attachment !== undefined) entry.attachment_id = stored.attachment.attachmentId
      if (image.revisedPrompt !== undefined) entry.revised_prompt = image.revisedPrompt
      if (stored.note !== undefined) entry.note = stored.note
      results.push(entry)
      at += 1
    }
    return results
  }

  /**
   * Assemble the durable tool result and collect advisory notes.
   * @param plan - resolved plan.
   * @param images - persisted images.
   * @param prompts - prompts the call ran.
   * @param notes - accumulated notes.
   * @param exec - the tool run context.
   * @returns the JSON value the model and the card see.
   */
  const shape = (plan, images, prompts, notes, exec) => {
    const rendered = `${plan.width}x${plan.height}`
    const widest = images.reduce((max, image) => Math.max(max, image.width * image.height), 0)
    const target = plan.width * plan.height
    if (images.length > 0 && target > 0 && widest > 0 && widest < target * 0.92) {
      const sample = images[0]
      notes.push(`the API capped the output at ${sample.width}x${sample.height} (about 1.6 megapixels tops) instead of the requested ${rendered}; use the workspace file for downstream resizing`)
    }
    for (const image of images) if (typeof image.note === 'string') notes.push(image.note)
    /* The registry demands lossless JSON, where `undefined` is not a value:
     * an absent optional field must be absent, not present-and-undefined. */
    const shapedImages = images.map((image) => {
      const out = {}
      for (const [key, field] of Object.entries(image)) if (field !== undefined) out[key] = field
      return out
    })
    const value = {
      operation: plan.action,
      model: plan.model,
      quality: plan.quality,
      resolution: plan.resolution,
      aspect_ratio: plan.ratio,
      rendered,
      workspace: exec.agent?.session?.header?.cwd,
      images: shapedImages,
      prompts,
      notes,
    }
    for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key]
    return lossless(value)
  }

  /* tools */

  const generateTool = {
    name: 'generate_image',
    description: 'Generate or edit images through an OpenAI-compatible image API. action:"generate" renders a text prompt; action:"edit" modifies local reference images (retouch, restyle, add or remove elements, extend a scene); action:"batch" renders several prompts in one call. Every image is written as a real original file under the session workspace (default saved-images/) and stored as a durable attachment, so the user sees it in the conversation and can download it. The aspect ratio is expressed through the pixel size sent upstream. Prefer aspect_ratio and resolution over inventing pixel sizes, and pass Chinese prompts straight through: rendering guidance is appended automatically unless optimize_prompt is false. Use imagegen_config to switch model, quality, resolution, or API key.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['generate', 'edit', 'batch'],
          description: 'generate: text to image (default). edit: transform the image_paths references. batch: one image per entry of prompts.',
        },
        prompt: {
          type: 'string',
          description: 'What to draw (generate) or how to change the reference images (edit). Chinese is accepted as-is.',
        },
        image_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'action:"edit" only. Workspace-relative or absolute paths of the reference images.',
        },
        mask_path: {
          type: 'string',
          description: 'action:"edit" only. Optional mask image; the transparent areas are the ones the model may repaint.',
        },
        prompts: {
          type: 'array',
          items: { type: 'string' },
          description: 'action:"batch" only. One prompt per generated image; each gets its own generation call.',
        },
        model: { type: 'string', enum: MODELS.map((entry) => entry.id), description: 'Image model override.' },
        quality: { type: 'string', enum: QUALITIES, description: 'Quality tier. Defaults to the configured value (high).' },
        resolution: { type: 'string', enum: RESOLUTIONS, description: 'Target resolution tier. The API caps output near 1.6 megapixels, so 2K/4K may come back smaller; the actual pixel size is always reported.' },
        aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, description: 'Aspect ratio. Defaults to the configured value (16:9).' },
        count: { type: 'integer', description: 'Images per prompt, 1-8. Defaults to the configured value (1).' },
        save_dir: { type: 'string', description: 'Workspace-relative directory for the saved originals. Defaults to saved-images.' },
        optimize_prompt: { type: 'boolean', description: 'Append rendering guidance (aspect, size, quality, model strength) to the prompt. Defaults to true.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: { type: 'string' },
          model: { type: 'string' },
          quality: { type: 'string' },
          resolution: { type: 'string' },
          aspect_ratio: { type: 'string' },
          rendered: { type: 'string', description: 'Pixel size requested upstream as WIDTHxHEIGHT.' },
          workspace: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer' },
                path: { type: 'string' },
                host_path: { type: 'string' },
                attachment_id: { type: 'string' },
                media_type: { type: 'string' },
                bytes: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                name: { type: 'string' },
                revised_prompt: { type: 'string' },
                note: { type: 'string' },
              },
            },
          },
          prompts: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => imageContent(value),
      presentationMeta: (_args, value) => ({ paths: value.images.map((image) => image.path) }),
    },
    presentCall(args) {
      const action = typeof args?.action === 'string' ? args.action : 'generate'
      const label = action === 'edit' ? 'Edit image' : action === 'batch' ? 'Batch images' : 'Generate image'
      const subject = text(args?.prompt) ?? (Array.isArray(args?.prompts) ? `${args.prompts.length} prompt(s)` : label)
      return { card: 'generic', title: `${label}: ${String(subject).slice(0, 80)}`, kind: 'other', locations: list(args?.image_paths).map((path) => ({ path: String(path) })) }
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const raw = isRecord(args) ? args : {}
      const plan = normalize(raw)
      const notes = []

      if (plan.action === 'edit') {
        const paths = list(raw.image_paths).map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
        if (paths.length === 0) throw new Error('imagegen: action:"edit" needs at least one path in image_paths')
        const prompt = text(raw.prompt)
        if (prompt === undefined) throw new Error('imagegen: action:"edit" needs a prompt describing the change')
        const references = []
        for (const path of paths) references.push(await readLocalFile(path, exec))
        let mask
        if (text(raw.mask_path) !== undefined) mask = await readLocalFile(String(raw.mask_path), exec)
        return shape(plan, await runOne(plan, prompt, references, mask, prompt, exec), [prompt], notes, exec)
      }

      if (plan.action === 'batch') {
        const prompts = plan.prompts.length > 0 ? plan.prompts : (text(raw.prompt) === undefined ? [] : [String(raw.prompt)])
        if (prompts.length === 0) throw new Error('imagegen: action:"batch" needs prompts (or a prompt)')
        const limit = Math.max(1, Math.trunc(Number(field('concurrency')) || BUILTIN.concurrency))
        const collected = new Array(prompts.length)
        let cursor = 0
        const worker = async () => {
          while (cursor < prompts.length) {
            const at = cursor
            cursor += 1
            try {
              collected[at] = await runOne(plan, prompts[at], [], undefined, prompts[at], exec)
            } catch (error) {
              notes.push(`prompt ${at + 1} failed: ${error instanceof Error ? error.message : String(error)}`)
              collected[at] = []
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, prompts.length) }, worker))
        const images = collected.flat()
        if (images.length === 0) throw new Error(`imagegen: every batch prompt failed — ${notes.join('; ')}`)
        return shape(plan, images, prompts, notes, exec)
      }

      const prompt = text(raw.prompt)
      if (prompt === undefined) throw new Error('imagegen: action:"generate" needs a prompt')
      return shape(plan, await runOne(plan, prompt, [], undefined, prompt, exec), [prompt], notes, exec)
    },
  }

  const configTool = {
    name: 'imagegen_config',
    description: 'Read or change the image generation configuration (API base URL, API key, default model, quality, resolution, aspect ratio, count, save directory), and list the image models the endpoint offers. Use action:"get" before changing anything so the user sees the current values.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'models'],
          description: 'get: current effective configuration. set: persist one or more fields. models: list image-capable models advertised by the endpoint.',
        },
        fields: {
          type: 'object',
          description: `action:"set" only. Any of ${SETTABLE.join(', ')}.`,
          additionalProperties: true,
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string' },
          config: { type: 'object', additionalProperties: true },
          changed: { type: 'object', additionalProperties: true },
          models: { type: 'array', items: { type: 'string' } },
          known_models: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const lines = []
        if (value.action === 'models') {
          const models = Array.isArray(value.models) ? value.models : []
          const known = Array.isArray(value.known_models) ? value.known_models : []
          lines.push(`image models offered by the endpoint (${models.length}): ${models.join(', ')}`)
          lines.push(`plugin-known models: ${known.join(', ')}`)
        } else {
          lines.push(`effective configuration: ${JSON.stringify(value.config, undefined, 2)}`)
          if (value.changed !== undefined) lines.push(`persisted: ${JSON.stringify(value.changed)}`)
        }
        if (typeof value.note === 'string') lines.push(value.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const raw = isRecord(args) ? args : {}
      const action = ['get', 'set', 'models'].includes(raw.action) ? raw.action : 'get'

      if (action === 'models') {
        const baseUrl = text(field('baseUrl')) ?? BUILTIN.baseUrl
        const apiKey = text(field('apiKey'))
        const response = await fetch(joinUrl(baseUrl, 'models'), { headers: apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }, signal: exec.signal })
        if (!response.ok) throw new Error(await failureText(response))
        const payload = await response.json()
        const ids = list(isRecord(payload) ? payload.data : []).map((entry) => (isRecord(entry) ? String(entry.id) : '')).filter((id) => id.length > 0)
        return lossless({
          action,
          config: {},
          models: ids.filter((id) => /image/iu.test(id)),
          known_models: MODELS.map((entry) => entry.id),
          note: 'Only the plugin-known models carry tuned prompt guidance; any id the endpoint lists can still be passed explicitly as `model`.',
        })
      }

      const current = {
        baseUrl: field('baseUrl'),
        apiKey: text(field('apiKey')) === undefined ? '' : '***set***',
        model: field('model'),
        quality: field('quality'),
        resolution: field('resolution'),
        aspectRatio: field('aspectRatio'),
        count: field('count'),
        saveDir: field('saveDir'),
        optimizePrompt: field('optimizePrompt'),
        concurrency: field('concurrency'),
      }

      if (action === 'get') return lossless({ action, config: current, known_models: MODELS.map((entry) => entry.id) })

      const fields = isRecord(raw.fields) ? raw.fields : {}
      const patch = {}
      for (const key of SETTABLE) {
        if (!(key in fields)) continue
        const value = fields[key]
        if (value === undefined || value === null) continue
        if (key === 'count' || key === 'concurrency') {
          const numeric = Number(value)
          if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error(`imagegen: ${key} must be a positive integer`)
          patch[key] = numeric
          continue
        }
        if (key === 'optimizePrompt') {
          if (typeof value !== 'boolean') throw new Error('imagegen: optimizePrompt must be a boolean')
          patch[key] = value
          continue
        }
        const asText = text(value)
        if (asText === undefined) throw new Error(`imagegen: ${key} must be a non-empty string`)
        if (key === 'quality' && !QUALITIES.includes(asText)) throw new Error(`imagegen: quality must be one of ${QUALITIES.join(', ')}`)
        if (key === 'resolution' && !RESOLUTIONS.includes(asText)) throw new Error(`imagegen: resolution must be one of ${RESOLUTIONS.join(', ')}`)
        if (key === 'aspectRatio' && !ASPECT_RATIOS.includes(asText)) throw new Error(`imagegen: aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`)
        patch[key] = asText
      }
      if (Object.keys(patch).length === 0) throw new Error(`imagegen: action:"set" needs at least one field among ${SETTABLE.join(', ')}`)
      await writeConfig(patch)
      return lossless({
        action,
        config: { ...current, ...patch, apiKey: patch.apiKey === undefined ? current.apiKey : '***set***' },
        changed: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, key === 'apiKey' ? '***set***' : value])),
        known_models: MODELS.map((entry) => entry.id),
        note: patch.apiKey === undefined ? undefined : 'the API key is stored in this plugin\'s config.json and is never echoed back.',
      })
    },
  }

  /* ── Client RPC ───────────────────────────────────────────────────────── */

  /**
   * Read the effective configuration, for the settings tab.
   *
   * The key is reported as a boolean rather than a value: a browser page has
   * no business receiving a secret it only ever writes.
   */
  const rpcGet = () => {
    const out = {}
    for (const key of SETTABLE) out[key] = field(key)
    out.apiKey = text(field('apiKey')) === undefined ? '' : '***set***'
    return out
  }

  /**
   * Write configuration fields, for the settings tab.
   * @param args - `{ fields }` with the same keys `imagegen_config` accepts.
   * @returns the resulting configuration, key-masked.
   */
  const rpcSet = async (args) => {
    const fields = isRecord(args) && isRecord(args.fields) ? args.fields : {}
    const patch = {}
    for (const key of SETTABLE) {
      if (!(key in fields)) continue
      const value = fields[key]
      if (value === undefined || value === null) continue
      if (key === 'count' || key === 'concurrency') {
        const numeric = Number(value)
        if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error(`imagegen: ${key} must be a positive integer`)
        patch[key] = numeric
        continue
      }
      if (key === 'optimizePrompt') {
        if (typeof value !== 'boolean') throw new Error('imagegen: optimizePrompt must be a boolean')
        patch[key] = value
        continue
      }
      const asText = text(value)
      if (asText === undefined) throw new Error(`imagegen: ${key} must be a non-empty string`)
      if (key === 'quality' && !QUALITIES.includes(asText)) throw new Error(`imagegen: quality must be one of ${QUALITIES.join(', ')}`)
      if (key === 'resolution' && !RESOLUTIONS.includes(asText)) throw new Error(`imagegen: resolution must be one of ${RESOLUTIONS.join(', ')}`)
      if (key === 'aspectRatio' && !ASPECT_RATIOS.includes(asText)) throw new Error(`imagegen: aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`)
      patch[key] = asText
    }
    if (Object.keys(patch).length === 0) throw new Error(`imagegen: nothing to save; expected at least one of ${SETTABLE.join(', ')}`)
    await writeConfig(patch)
    return rpcGet()
  }

  /**
   * Probe the configured endpoint, for the settings page's "test" button.
   *
   * Two levels, because they fail for different reasons: listing `/models`
   * proves the base URL and the key are accepted, while an actual one-image
   * generation proves the model id exists and the account may spend on it.
   * Values passed in `draft` are tested as-is, so a candidate can be checked
   * before it is saved.
   * @param args - `{ draft?, generate? }`.
   * @returns a structured report the page renders line by line.
   */
  const rpcTest = async (args) => {
    const draft = isRecord(args) && isRecord(args.draft) ? args.draft : {}
    const baseUrl = text(draft.baseUrl) ?? text(field('baseUrl')) ?? BUILTIN.baseUrl
    const apiKey = text(draft.apiKey) ?? text(field('apiKey'))
    const model = text(draft.model) ?? text(field('model')) ?? BUILTIN.model
    const started = Date.now()
    const steps = []

    if (apiKey === undefined) {
      return { ok: false, steps: [{ label: 'credentials', ok: false, detail: 'no API key is configured' }] }
    }

    try {
      const response = await fetch(joinUrl(baseUrl, 'models'), { headers: { authorization: `Bearer ${apiKey}` } })
      if (!response.ok) {
        steps.push({ label: 'endpoint', ok: false, detail: `HTTP ${response.status} — ${await failureText(response)}` })
        return { ok: false, steps, elapsedMs: Date.now() - started }
      }
      const payload = await response.json()
      const ids = list(isRecord(payload) ? payload.data : []).map((entry) => (isRecord(entry) ? String(entry.id) : '')).filter((id) => id.length > 0)
      const imageModels = ids.filter((id) => /image/iu.test(id))
      steps.push({
        label: 'endpoint',
        ok: true,
        detail: `${ids.length} models reachable, ${imageModels.length} image-capable${imageModels.length === 0 ? '' : ` (${imageModels.slice(0, 6).join(', ')}${imageModels.length > 6 ? '…' : ''})`}`,
      })
      if (imageModels.length > 0) {
        steps.push({
          label: 'model id',
          ok: imageModels.includes(model),
          detail: imageModels.includes(model)
            ? `${model} is offered by the endpoint`
            : `${model} is not in the endpoint's image model list — generation may still work if the list is partial`,
        })
      }
    } catch (error) {
      steps.push({ label: 'endpoint', ok: false, detail: error instanceof Error ? error.message : String(error) })
      return { ok: false, steps, elapsedMs: Date.now() - started }
    }

    if (isRecord(args) && args.generate === true) {
      try {
        const spec = { model, quality: 'low', width: 1024, height: 1024, ratio: '1:1', count: 1, enhance: false, prompt: 'connectivity test' }
        const images = await callApi(spec, {
          prompt: 'a single small grey dot on a white background',
          references: [],
          mask: undefined,
          signal: undefined,
          credentials: { baseUrl, apiKey },
        })
        const first = images[0]
        steps.push({
          label: 'generation',
          ok: true,
          detail: `rendered ${first.width}x${first.height} ${first.mediaType}, ${first.bytes.byteLength} bytes (test images are not saved)`,
        })
      } catch (error) {
        steps.push({ label: 'generation', ok: false, detail: error instanceof Error ? error.message : String(error) })
      }
    }

    return { ok: steps.every((step) => step.ok), steps, elapsedMs: Date.now() - started, baseUrl, model }
  }

  /**
   * List the image-capable model ids the endpoint advertises.
   * @returns `{ models }`, or `{ models: [], error }` when the probe fails.
   */
  const rpcModels = async () => {
    const baseUrl = text(field('baseUrl')) ?? BUILTIN.baseUrl
    const apiKey = text(field('apiKey'))
    if (apiKey === undefined) return { models: [], error: 'no API key is configured' }
    try {
      const response = await fetch(joinUrl(baseUrl, 'models'), { headers: { authorization: `Bearer ${apiKey}` } })
      if (!response.ok) return { models: [], error: await failureText(response) }
      const payload = await response.json()
      const ids = list(isRecord(payload) ? payload.data : []).map((entry) => (isRecord(entry) ? String(entry.id) : '')).filter((id) => id.length > 0)
      return { models: ids.filter((id) => /image/iu.test(id)), known: MODELS.map((entry) => entry.id) }
    } catch (error) {
      return { models: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /* A dynamic-plugin evaluator gets `harness.handle`; a bundle mounted from a
   * profile row does not. Both are wired so the same handlers serve whichever
   * runtime this half is loaded into. */
  if (typeof harness !== 'undefined' && typeof harness.handle === 'function') {
    harness.handle('imagegen/config/get', () => rpcGet())
    harness.handle('imagegen/config/set', (args) => rpcSet(args))
    harness.handle('imagegen/config/test', (args) => rpcTest(args))
    harness.handle('imagegen/config/models', () => rpcModels())
  }

  /* The transport that works for a BUNDLE: a same-origin HTTP route.
   *
   * A bundle's client half cannot use `host.call` (that is a dynamic-plugin
   * builtin) and registering a `remote.*` namespace needs the full typert
   * service definition, so the settings page talks to the host over plain
   * `fetch` against routes this half owns.
   *
   * `webServer` mounts AFTER this row does — the profile's patch inserts this
   * bundle before the web carrier — so a one-shot `ctx.get` finds nothing and
   * the routes are never served (the page then reports a 404). `ctx.inject`
   * waits for the service instead, and its callback runs whenever it appears. */
  /**
   * Attach the configuration routes to the web carrier.
   *
   * `webServer` mounts AFTER this row does — the profile's patch inserts this
   * bundle before the web carrier — so a one-shot lookup finds nothing and the
   * routes would never be served (the page then reports HTTP 404). `ctx.inject`
   * waits for the service instead.
   *
   * Every step is feature-detected and swallowed: a throw here fails this row,
   * and a failed row takes the whole application's boot with it. Losing the
   * settings transport is a far better outcome than losing the start-up.
   * @param webCtx - the context that owns the service, when injection is used.
   */
  const attachRoutes = (webCtx) => {
    const lookup = (name) => {
      for (const candidate of [webCtx, ctx]) {
        if (candidate === undefined || typeof candidate?.get !== 'function') continue
        try {
          const value = candidate.get(name)
          if (value !== undefined) return value
        } catch {
          /* a context that cannot answer is treated as one that has nothing */
        }
      }
      return undefined
    }

    const webServer = lookup('webServer')
    if (webServer === undefined || typeof webServer.register !== 'function') {
      console.error('[imagegen] webServer is unavailable, so the configuration page has no transport')
      return
    }

    /**
     * Answer one JSON request.
     * @param handler - receives the decoded body, returns a JSON value.
     */
    const json = (handler) => async (req, res) => {
      const send = (status, value) => {
        const body = JSON.stringify(value ?? null)
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
      }
      try {
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 1024 * 1024) throw new Error('request body too large')
        }
        const args = raw.length === 0 ? {} : JSON.parse(raw)
        send(200, { ok: true, value: await handler(args) })
      } catch (error) {
        send(200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }

    const routes = [
      webServer.register({ kind: 'exact', path: '/api/imagegen/config', handler: json((args) => (args?.action === 'set' ? rpcSet(args) : rpcGet())) }),
      webServer.register({ kind: 'exact', path: '/api/imagegen/test', handler: json((args) => rpcTest(args)) }),
      webServer.register({ kind: 'exact', path: '/api/imagegen/models', handler: json(() => rpcModels()) }),
    ]

    /* The callback context owns the routes' lifetime; the outer one is the
     * fallback when a runtime hands back something without `effect`. */
    const owner = typeof webCtx?.effect === 'function' ? webCtx : ctx
    if (typeof owner?.effect === 'function') {
      owner.effect(() => () => {
        for (const dispose of routes) dispose()
      }, 'imagegen: configuration routes')
    }
    console.log('[imagegen] configuration routes registered under /api/imagegen')
  }

  if (typeof ctx?.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => attachRoutes(webCtx))
  } else {
    /* A context without `inject` still gets the routes when the carrier
     * happens to be up already. */
    attachRoutes(undefined)
  }

  ctx.tools.register(generateTool)
  ctx.tools.register(configTool)
  console.log('[imagegen] registered generate_image and imagegen_config')
}
