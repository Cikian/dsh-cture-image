window.__ModuleLoader__.load({
	id: '@cikian/dsh-cture-image',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const react = require('react')
		/** Same module under its JSX runtime name, for readability. */
		const React = react

		/**
		 * Client half of @cikian/dsh-cture-image.
		 *
		 * Two contributions:
		 *   tool.call.toolview key `generate_image` — the generated pictures,
		 *     with a per-image download action, rendered in the conversation.
		 *   plugins.bundle.config keyed by the package name — the configuration
		 *     form shown on this bundle's page in the Plugins page.
		 *
		 * The `id` above MUST equal the package name in package.json: the
		 * client module system keys each graph row by package name and matches
		 * it against the id a bundle registers with. A mismatch fails the whole
		 * web boot, not just this plugin. `tools/verify-bundle.mjs` asserts it.
		 *
		 * Two failure modes cost this entry its activation while the host row
		 * keeps reporting "运行中" — the configuration page then just vanishes:
		 * a leftover row pointing at the pre-rename bundle (duplicate factory
		 * registration), and a page that booted before this bundle was mounted
		 * (the client graph is composed at boot; HMR only refreshes ids that are
		 * already in it). `tools/preflight.mjs` catches the first; a restart
		 * clears the second.
		 */

		/** RPC method names the Host half registers. */
		/** Routes the Host half owns for this bundle's configuration. */
		const CONFIG_ROUTE = '/api/imagegen/config'
		const TEST_ROUTE = '/api/imagegen/test'
		const MODELS_ROUTE = '/api/imagegen/models'

		/**
		 * Call one of the Host half's configuration routes.
		 *
		 * A bundle's client half has no `host.call` — that builtin belongs to
		 * dynamic plugins — so the settings page talks to the host over plain
		 * same-origin `fetch` against routes the host registers. Each route
		 * answers `{ ok, value }` or `{ ok: false, error }`, so a failure shows
		 * as text on the page instead of a silent blank form.
		 * @param route - exact route path.
		 * @param body - JSON request body.
		 * @returns the unwrapped value.
		 */
		async function callHost(route, body) {
			const response = await fetch(route, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body ?? {}),
			})
			if (!response.ok) throw new Error(`${route} answered HTTP ${response.status}`)
			const payload = await response.json()
			if (payload === null || typeof payload !== 'object') throw new Error(`${route} answered no payload`)
			if (payload.ok !== true) throw new Error(typeof payload.error === 'string' ? payload.error : `${route} failed`)
			return payload.value
		}

		/**
		 * The patch row id this bundle inserts, and the package name it is
		 * installed under. The Plugins page keys each bundle's configuration
		 * slot by the PACKAGE NAME, while a single row's configuration slot is
		 * keyed by the row id.
		 */
		const PATCH_ROW_ID = 'tool-imagegen'
		const PACKAGE_NAME = '@cikian/dsh-cture-image'

		/** Inline styles over theme tokens so the card follows light and dark alike. */
		const S = {
			root: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px', minWidth: 0 },
			head: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
			dot: { width: '7px', height: '7px', borderRadius: '50%', flex: 'none', background: 'var(--dsw-alias-label-tertiary)' },
			title: { fontWeight: 500 },
			meta: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' },
			grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', minWidth: 0 },
			card: { position: 'relative', border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: '14px', background: 'var(--dsw-static-neutral-50)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 },
			figure: { display: 'block', width: '100%', minHeight: '120px', background: 'var(--dsw-alias-bg-layer-1)', objectFit: 'contain' },
			placeholder: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '140px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-bg-layer-1)', padding: '12px', textAlign: 'center' },
			bar: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderTop: '0.5px solid var(--dsw-alias-border-l1)', minWidth: 0 },
			caption: { flex: 1, minWidth: 0, fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' },
			action: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', font: 'inherit', fontSize: '11px', padding: '3px 8px', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-link)', cursor: 'pointer' },
			notes: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' },
			error: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-bg-layer-1)', borderRadius: '8px', padding: '10px' },
		}

		/** Running, settled-ok, failed, or interrupted. */
		function stateOf(block) {
			if (!('kind' in block)) return 'running'
			if (block.error !== undefined && block.error.code === 'interrupted') return 'stopped'
			return block.isError ? 'error' : 'ok'
		}

		/** Every image block of a settled result, in order. */
		function imagesOf(block) {
			if (!('kind' in block) || !Array.isArray(block.content)) return []
			return block.content.filter((part) => part !== null && typeof part === 'object' && part.type === 'image' && part.attachment !== undefined)
		}

		/** Saved workspace paths of a settled result, read from the result envelope. */
		function pathsOf(block) {
			if (!('kind' in block) || !Array.isArray(block.content)) return []
			const found = []
			for (const part of block.content) {
				if (part === null || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') continue
				const matches = part.text.matchAll(/<path>([^<]+)<\/path>/gu)
				for (const match of matches) found.push(match[1])
			}
			return found
		}

		/** Plain text of a settled result, without the image envelopes. */
		function textOf(block) {
			if (!('kind' in block) || !Array.isArray(block.content)) return ''
			return block.content
				.filter((part) => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
				.map((part) => part.text.replace(/<path>[^<]*<\/path>\n<type>image<\/type>\n<content>[\s\S]*?<\/content>/gu, '').trim())
				.filter((text) => text.length > 0)
				.join('\n')
		}

		/** Ask the browser to save an already-loaded blob URL under a file name. */
		function download(url, name) {
			if (typeof url !== 'string' || url.length === 0 || typeof document === 'undefined') return
			const anchor = document.createElement('a')
			anchor.href = url
			anchor.download = name
			anchor.style.display = 'none'
			document.body.appendChild(anchor)
			anchor.click()
			anchor.remove()
		}

		/** File name of a workspace path, either separator. */
		function leaf(path) {
			const at = Math.max(String(path).lastIndexOf('/'), String(path).lastIndexOf('\\'))
			return at === -1 ? String(path) : String(path).slice(at + 1)
		}

		/**
		 * One generated image: the picture plus its download action.
		 * @param props - the attachment, its saved path, the loader, and the index.
		 */
		function ImageTile(props) {
			const { attachment, path, loadImage, index } = props
			const [url, setUrl] = react.useState(undefined)
			const [failed, setFailed] = react.useState(undefined)

			react.useEffect(() => {
				let live = true
				if (typeof loadImage !== 'function') {
					setFailed('image loading is unavailable here')
					return undefined
				}
				setFailed(undefined)
				setUrl(undefined)
				Promise.resolve(loadImage(attachment)).then(
					(next) => {
						if (!live) return
						if (typeof next === 'string' && next.length > 0) setUrl(next)
						else setFailed('the image bytes could not be read')
					},
					(error) => {
						if (!live) return
						setFailed(error instanceof Error ? error.message : String(error))
					},
				)
				return () => {
					live = false
				}
			}, [attachment, loadImage])

			const name = typeof attachment.name === 'string' && attachment.name.length > 0 ? attachment.name : leaf(path) || `image-${index + 1}.png`
			const size = `${attachment.width}x${attachment.height}`
			return react.createElement(
				'div',
				{ style: S.card, 'data-imagegen-tile': index },
				url === undefined
					? react.createElement('div', { style: S.placeholder }, failed === undefined ? 'loading image…' : `image unavailable: ${failed}`)
					: react.createElement('img', {
						style: S.figure,
						src: url,
						alt: name,
						loading: 'lazy',
						onError: () => setFailed('the browser could not decode the image'),
					}),
				react.createElement(
					'div',
					{ style: S.bar },
					react.createElement('span', { style: S.caption, title: path }, `${size} · ${name}`),
					react.createElement(
						'button',
						{
							type: 'button',
							style: S.action,
							disabled: url === undefined,
							onClick: () => download(url, name),
						},
						'download',
					),
				),
			)
		}

		/**
		 * The `generate_image` conversation card.
		 * @param props - ToolCallOwnerProps.
		 */
		function ImageGenRow(props) {
			const { block, cwd, loadImage, inspect, openFile } = props
			const state = stateOf(block)
			const images = imagesOf(block)
			const paths = pathsOf(block)
			const [expanded, setExpanded] = react.useState(false)
			const settled = 'kind' in block
			const args = settled ? (block.call === null || block.call === undefined ? '' : block.call.argsRaw) : (block.argsRaw ?? '')
			const running = state === 'running'
			const summary = running ? 'generating…' : state === 'error' ? 'generation failed' : `${images.length} image${images.length === 1 ? '' : 's'}`

			const head = react.createElement(
				'div',
				{ style: S.head },
				react.createElement('span', {
					style: { ...S.dot, background: running ? 'var(--dsw-alias-brand-primary)' : state === 'ok' ? 'var(--dsw-static-green-500, #2ea043)' : 'var(--dsw-alias-label-tertiary)' },
				}),
				react.createElement('span', { style: S.title }, 'Image generation'),
				react.createElement('span', { style: S.meta }, summary),
				inspect !== undefined ? react.createElement('button', { type: 'button', style: S.action, onClick: inspect }, 'inspect') : null,
				react.createElement('button', { type: 'button', style: S.action, onClick: () => setExpanded((value) => !value) }, expanded ? 'hide details' : 'details'),
			)

			const children = [head]

			if (running) children.push(react.createElement('div', { style: S.notes }, 'the image API is rendering — this card updates when the call settles'))

			if (images.length > 0) {
				children.push(
					react.createElement(
						'div',
						{ style: S.grid },
						images.map((part, index) => react.createElement(ImageTile, {
							key: `${String(part.attachment.attachmentId)}-${index}`,
							attachment: part.attachment,
							path: paths[index] ?? (typeof part.attachment.name === 'string' ? part.attachment.name : ''),
							loadImage,
							index,
						})),
					),
				)
			}

			if (settled && !running && images.length === 0) {
				const text = textOf(block)
				children.push(react.createElement('div', { style: S.error }, state === 'error' ? (text.length > 0 ? text : 'the image call failed') : 'no image was returned'))
			}

			if (settled && paths.length > 0 && openFile !== undefined) {
				children.push(
					react.createElement(
						'div',
						{ style: S.head },
						react.createElement('span', { style: S.meta }, 'saved to'),
						...paths.slice(0, 8).map((path, index) =>
							react.createElement(
								'button',
								{ key: `${path}-${index}`, type: 'button', style: S.action, title: path, onClick: () => openFile(path) },
								leaf(path),
							),
						),
						cwd !== undefined && paths.length > 0 ? react.createElement('span', { style: S.meta }, `(${cwd})`) : null,
					),
				)
			}

			if (expanded) {
				children.push(react.createElement('div', { style: S.error }, `call arguments:\n${args === '' ? '(streaming)' : args}`))
			}

			return react.createElement('div', { style: S.root, 'data-tool': 'generate_image', 'data-state': state }, ...children)
		}

		/* ── settings tab ─────────────────────────────────────────────────── */

		const INPUT = {
			width: '100%',
			boxSizing: 'border-box',
			font: 'inherit',
			fontSize: '12px',
			padding: '5px 8px',
			borderRadius: '8px',
			border: '0.5px solid var(--dsw-alias-border-l1)',
			background: 'var(--dsw-alias-bg-layer-1)',
			color: 'var(--dsw-alias-label-primary)',
		}

		/**
		 * The configuration surface shown on this plugin's page in the Plugins
		 * page.
		 *
		 * Reads and writes through the HTTP routes the Host half registers, so
		 * the same values back the tools and the page, with no settings
		 * namespace and no profile patch schema involved.
		 */
		function ImageGenSettingsTab() {
			const [fields, setFields] = react.useState(undefined)
			const [state, setState] = react.useState('loading')
			const [message, setMessage] = react.useState('')
			const [testResult, setTestResult] = react.useState(undefined)
			const [knownModels, setKnownModels] = react.useState([])

			react.useEffect(() => {
				let live = true
				Promise.resolve(callHost(CONFIG_ROUTE, { action: 'get' })).then(
					(config) => {
						if (!live) return
						if (config === null || typeof config !== 'object') {
							setState('unavailable')
							setMessage('the Cture Image host returned no configuration')
							return
						}
						setFields({
							baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
							apiKey: '',
							apiKeySet: config.apiKey === '***set***',
							model: typeof config.model === 'string' ? config.model : '',
							quality: typeof config.quality === 'string' ? config.quality : 'high',
							resolution: typeof config.resolution === 'string' ? config.resolution : '1K',
							aspectRatio: typeof config.aspectRatio === 'string' ? config.aspectRatio : '16:9',
							saveDir: typeof config.saveDir === 'string' ? config.saveDir : 'saved-images',
						})
						setState('ready')
					},
					(error) => {
						if (!live) return
						setState('unavailable')
						setMessage(error instanceof Error ? error.message : String(error))
					},
				)
				/* The endpoint's model list is advisory: a failure here only
				 * means the field falls back to its placeholder hint. */
				Promise.resolve(callHost(MODELS_ROUTE, {})).then(
					(result) => {
						if (!live) return
						if (result !== null && typeof result === 'object' && Array.isArray(result.models)) setKnownModels(result.models)
					},
					() => {},
				)
				return () => {
					live = false
				}
			}, [])

			const save = () => {
				if (fields === undefined) return
				const patch = {}
				if (fields.baseUrl.trim().length > 0) patch.baseUrl = fields.baseUrl.trim()
				if (fields.model.trim().length > 0) patch.model = fields.model.trim()
				if (fields.quality.trim().length > 0) patch.quality = fields.quality.trim()
				if (fields.resolution.trim().length > 0) patch.resolution = fields.resolution.trim()
				if (fields.aspectRatio.trim().length > 0) patch.aspectRatio = fields.aspectRatio.trim()
				if (fields.saveDir.trim().length > 0) patch.saveDir = fields.saveDir.trim()
				/* An empty key field means "keep what is stored", so it is only
				 * sent when the user actually typed one. */
				if (fields.apiKey.trim().length > 0) patch.apiKey = fields.apiKey.trim()
				if (Object.keys(patch).length === 0) {
					setMessage('nothing to save')
					return
				}
				setState('saving')
				Promise.resolve(callHost(CONFIG_ROUTE, { action: 'set', fields: patch })).then(
					() => {
						setState('ready')
						setMessage('saved — the next image call uses these values')
						setFields({ ...fields, apiKey: '' })
					},
					(error) => {
						setState('ready')
						setMessage(`save failed: ${error instanceof Error ? error.message : String(error)}`)
					},
				)
			}

			/**
			 * Probe the endpoint. The draft is sent along so a candidate URL,
			 * key, or model can be checked before anything is saved, and the
			 * optional second step renders one throwaway image to prove the
			 * model id and the account both work.
			 * @param generate - whether to also render one test image.
			 */
			const test = (generate) => {
				if (fields === undefined) return
				setState('testing')
				setTestResult(undefined)
				Promise.resolve(callHost(TEST_ROUTE, {
					generate,
					draft: {
						baseUrl: fields.baseUrl.trim(),
						model: fields.model.trim(),
						...(fields.apiKey.trim().length > 0 ? { apiKey: fields.apiKey.trim() } : {}),
					},
				})).then(
					(report) => {
						setState('ready')
						setTestResult(report)
					},
					(error) => {
						setState('ready')
						setTestResult({ ok: false, steps: [{ label: 'test', ok: false, detail: error instanceof Error ? error.message : String(error) }] })
					},
				)
			}

			const row = (label, control, hint) =>
				react.createElement(
					'div',
					{ style: { display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', alignItems: 'center', gap: '8px', fontSize: '12px' } },
					react.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label),
					react.createElement(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
						control,
						hint === undefined ? null : react.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, hint),
					),
				)

			if (state === 'unavailable') {
				return react.createElement(
					'div',
					{ style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }, 'data-cture-image-settings': 'true' },
					`unavailable: ${message}`,
				)
			}
			if (fields === undefined) {
				return react.createElement(
					'div',
					{ style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }, 'data-cture-image-settings': 'true' },
					'loading…',
				)
			}

			const busy = state === 'saving' || state === 'testing'

			return react.createElement(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }, 'data-cture-image-settings': 'true' },

				react.createElement('div', { style: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, '接口与密钥'),

				row('接口地址', react.createElement('input', {
					style: INPUT,
					value: fields.baseUrl,
					placeholder: 'https://api.cikhub.com/v1',
					onChange: (event) => setFields({ ...fields, baseUrl: event.target.value }),
				}), 'OpenAI 兼容的 API 根地址，通常以 /v1 结尾'),

				row('API 密钥', react.createElement('input', {
					style: INPUT,
					type: 'password',
					value: fields.apiKey,
					placeholder: fields.apiKeySet === true ? '已设置，留空则不修改' : 'sk-...',
					onChange: (event) => setFields({ ...fields, apiKey: event.target.value }),
				}), '保存在插件自己的 config.json，接口回传时不会带出明文'),

				row('使用模型', react.createElement('input', {
					style: INPUT,
					value: fields.model,
					placeholder: 'gpt-image-2.5-sunburst',
					list: 'cture-image-models',
					onChange: (event) => setFields({ ...fields, model: event.target.value }),
				}), knownModels.length === 0
					? 'sunburst：角色设定 / 关键视觉 · flare：批量草图 / 社媒配图 · gpt-image-2.5：通用'
					: `接口可用：${knownModels.slice(0, 8).join('、')}${knownModels.length > 8 ? ' …' : ''}`),
				react.createElement('datalist', { id: 'cture-image-models' },
					...knownModels.map((id) => react.createElement('option', { key: id, value: id })),
				),

				react.createElement(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
					react.createElement('button', { type: 'button', style: S.action, disabled: busy, onClick: () => test(false) }, state === 'testing' ? '测试中…' : '测试连通性'),
					react.createElement('button', { type: 'button', style: S.action, disabled: busy, onClick: () => test(true) }, '测试并试出一张图'),
					react.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
						'先用草稿里的值探测，不需要先保存'),
				),

				testResult === undefined ? null : react.createElement(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '10px', border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', padding: '10px 12px', fontSize: '12px' } },
					react.createElement('div', { style: { fontWeight: 500, color: testResult.ok ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)' } },
						`连接测试${testResult.ok ? '通过' : '未通过'}${typeof testResult.elapsedMs === 'number' ? ` · ${testResult.elapsedMs} ms` : ''}`),
					...(Array.isArray(testResult.steps) ? testResult.steps : []).map((step, index) =>
						react.createElement(
							'div',
							{ key: index, style: { display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: '8px' } },
							react.createElement('span', { style: { color: step.ok ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)' } }, `${step.ok ? '✓' : '✕'} ${String(step.label)}`),
							react.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, String(step.detail ?? '')),
						),
					),
				),

				react.createElement('div', { style: { height: '0.5px', background: 'var(--dsw-alias-border-l1)', margin: '2px 0' } }),
				react.createElement('div', { style: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, '出图默认值'),

				row('质量', react.createElement('select', {
					style: INPUT,
					value: fields.quality,
					onChange: (event) => setFields({ ...fields, quality: event.target.value }),
				}, ...['low', 'medium', 'high', 'xhigh', 'max'].map((value) =>
					react.createElement('option', { key: value, value }, value),
				))),

				row('分辨率', react.createElement('select', {
					style: INPUT,
					value: fields.resolution,
					onChange: (event) => setFields({ ...fields, resolution: event.target.value }),
				}, ...['1K', '2K', '4K'].map((value) =>
					react.createElement('option', { key: value, value: value }, value),
				)), '接口会把输出压到约 1.6MP，2K/4K 可能偏小，工具会如实报告实际像素'),

				row('宽高比', react.createElement('select', {
					style: INPUT,
					value: fields.aspectRatio,
					onChange: (event) => setFields({ ...fields, aspectRatio: event.target.value }),
				}, ...['1:1', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'].map((value) =>
					react.createElement('option', { key: value, value: value }, value),
				))),

				row('保存目录', react.createElement('input', {
					style: INPUT,
					value: fields.saveDir,
					placeholder: 'saved-images',
					onChange: (event) => setFields({ ...fields, saveDir: event.target.value }),
				}), '工作区内的相对目录，原图写在这里'),

				react.createElement(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '10px' } },
					react.createElement('button', { type: 'button', style: S.action, disabled: busy, onClick: save }, state === 'saving' ? '保存中…' : '保存'),
					react.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, message),
				),
			)
		}

		/**
		 * Configuration page for this bundle in the Plugins page.
		 *
		 * The page asks an installed bundle for its own configuration surface
		 * through `plugins.bundle.config`, keyed by the PACKAGE NAME, and only
		 * when the bundle is enabled. The per-row slot (`plugins.row.config`,
		 * keyed by patch row id) belongs to the row list inside a bundle's page
		 * and is therefore registered as well, so the same form is reachable
		 * from either entry point.
		 *
		 * A `plugins.item` registration is deliberately NOT used: that slot
		 * renders a synthetic card into the "official" group, and its detail
		 * page has no configuration area — the wrong home for a bundle the
		 * profile actually installed and lists among "已安装".
		 */
		function ImageGenConfigView() {
			return react.createElement(ImageGenSettingsTab, null)
		}

		/** Required services: the slot registry only. */
		const inject = ['slots']

		/**
		 * Mount every client contribution.
		 * @param ctx - the client plugin context.
		 */
		function apply(ctx) {
			const slots = ctx.get('slots')
			if (slots === undefined) return

			slots.inject('tool.call.toolview', () =>
				slots.register({ name: 'tool.call.toolview', key: 'generate_image' }, ImageGenRow),
			)

			slots.inject('plugins.bundle.config', () =>
				slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, ImageGenConfigView),
			)

			slots.inject('plugins.row.config', () =>
				slots.register({ name: 'plugins.row.config', key: PATCH_ROW_ID }, ImageGenConfigView),
			)
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
