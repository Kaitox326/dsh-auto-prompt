/**
 * Smoke test against the real Harness packages (0.1.x or 0.2.x).
 *
 * The plugin imports `@deepseek-ai/*` as bare specifiers, so this file must run
 * somewhere those resolve — i.e. inside an installed profile:
 *
 *   cp -r test <profile>/plugins/dsh-auto-prompt/
 *   node <profile>/plugins/dsh-auto-prompt/test/smoke.mjs
 *
 * Covers:
 * 1. Config schema loads, every field is volatile (so a form is generated).
 * 2. Volatile reference objects are unwrapped into plain values.
 * 3. The settings bridge writes through the right API for this generation.
 * 4. generateMedia gates the pipeline: off => prompts only, no backend call.
 * 5. Tool values pass the real JSON-schema validator.
 */
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { Config, PlainConfig, normalizeConfig } from '../src/config.js'
import { unwrap, isVolatileRef, createSettingsBridge } from '../src/settings.js'
import { apply } from '../src/index.js'

const fail = []
const ok = (label, extra = '') => console.log(`  ok   ${label}${extra ? ` — ${extra}` : ''}`)
const check = (cond, label, extra) => (cond ? ok(label, extra) : (fail.push(label), console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`)))

/* ---------------------------------------------------------------- 1. schema */
console.log('\n[1] Config schema')
const probe = normalizeConfig({})
check(Object.keys(probe).length >= 28, 'defaults resolved', `${Object.keys(probe).length} fields`)
check(probe.generateMedia === false, 'generateMedia defaults to false')
check(typeof probe.promptModel === 'string', 'plain schema yields plain values')
check('volatile' in Config.dict.generateMedia.meta, 'generateMedia is volatile')
const nonVolatile = Object.entries(Config.dict).filter(([, s]) => !s.meta?.volatile).map(([k]) => k)
check(nonVolatile.length === 0, 'every field is volatile', nonVolatile.length ? nonVolatile.join(',') : 'all')
check(!PlainConfig.dict.generateMedia.meta?.volatile, 'PlainConfig drops the volatile marker')

// volatileForm() in dsh-settings requires this exact meta flag.
const { default: Schema } = await import('@deepseek-ai/schemastery')
const volatileFields = Object.entries(Config.dict).filter(([, s]) => s.meta?.volatile)
check(volatileFields.length === Object.keys(Config.dict).length, 'settings form will expose every field')

/* -------------------------------------------------------------- 2. unwrap */
console.log('\n[2] volatile reference unwrapping')
const refLike = Object.freeze({ get: () => 'value-from-ref' })
check(isVolatileRef(refLike), 'ref shape detected')
check(unwrap(refLike) === 'value-from-ref', 'ref unwrapped')
const nested = { a: refLike, b: [refLike, 1], c: { d: refLike } }
const flat = unwrap(nested)
check(flat.a === 'value-from-ref' && flat.b[0] === 'value-from-ref' && flat.c.d === 'value-from-ref', 'nested refs unwrapped')
check(!isVolatileRef('x') && !isVolatileRef(null) && !isVolatileRef([1]), 'plain values untouched')

/* ------------------------------------------------------------ 3. bridge */
console.log('\n[3] settings bridge (0.2.1 forms shape)')
let store = { promptModel: 'deepseek-chat', generateMedia: false }
const writes = []
const fakeService = {
  writable: true,
  describe: () => [
    { ns: 'some-other-plugin', value: { unrelated: 1 }, revision: 3 },
    { ns: 'dsh-auto-prompt', value: { ...store }, revision: 7 },
  ],
  async update(ns, patch, revision) {
    writes.push({ ns, patch, revision })
    if (revision !== undefined && revision < 7) throw Object.assign(new Error('conflict'), { code: 'SETTINGS_CONFLICT' })
    store = { ...store, ...patch }
  },
  async replace(ns, section, revision) {
    writes.push({ ns, section, revision })
    store = { ...PlainConfig({}), ...section }
  },
}
const fakeCtx = {
  get: (name) => (name === 'settings' ? fakeService : name === 'loader' ? { locate: () => 'dsh-auto-prompt' } : undefined),
  fiber: {},
}
const bridge = createSettingsBridge(fakeCtx, PlainConfig, {}, () => {})
check(bridge.mode === 'forms', 'detected forms mode')
check(bridge.ns === 'dsh-auto-prompt', 'entry id resolved', bridge.ns)
check(bridge.get().generateMedia === false, 'reads live value')
await bridge.update({ generateMedia: true })
check(writes.at(-1).patch.generateMedia === true, 'write carries the patch')
check(writes.at(-1).revision === 7, 'write carries the revision')
check(bridge.get().generateMedia === true, 'value follows the write')
await bridge.replace({})
check(writes.at(-1).section !== undefined, 'reset goes through replace')
check(bridge.get().generateMedia === false, 'reset re-inherits the default')

// legacy 0.1.x shape still wins when register() exists.
const legacy = createSettingsBridge(
  { get: () => ({ register: () => ({ get: () => ({ generateMedia: true, promptModel: 'x' }), update: async () => {}, replace: async () => {} }) }), fiber: {} },
  PlainConfig,
  {},
  () => {}
)
check(legacy.mode === 'legacy', 'legacy register() still supported')
check(legacy.get().generateMedia === true, 'legacy scope read')

// no service at all degrades instead of throwing.
const none = createSettingsBridge({}, PlainConfig, { promptModel: 'p' }, () => {})
check(none.mode === 'static', 'degrades to static config')
check(none.get().promptModel === 'p', 'static config honoured')

/* --------------------------------------------------- 4. generateMedia gate */
console.log('\n[4] generateMedia gate')
const tools = new Map()
let settingsService = null
const ctx = {
  tools: { register: (def) => tools.set(def.name, def) },
  get: (name) => (name === 'settings' ? settingsService : name === 'loader' ? { locate: () => 'dsh-auto-prompt' } : undefined),
  fiber: {},
  inject: () => {},
  attachments: undefined,
}
apply(ctx, {})
check(tools.size === 3, 'three tools registered', [...tools.keys()].join(','))

const savedDir = process.env.TEMP ? `${process.env.TEMP}/dsh-auto-prompt-smoke` : '/tmp/dsh-auto-prompt-smoke'
const baseSettings = {
  outputDir: savedDir,
  promptBaseUrl: 'http://127.0.0.1:9/v1',
  promptApiKey: 'unused',
  generateMedia: false,
  mode: 'auto',
}
settingsService = {
  writable: true,
  describe: () => [{ ns: 'dsh-auto-prompt', value: baseSettings, revision: 1 }],
  update: async () => {},
  replace: async () => {},
}
// Re-mount so the bridge picks up the fake service.
const tools2 = new Map()
ctx.tools.register = (def) => tools2.set(def.name, def)
apply(ctx, {})

const autoMedia = tools2.get('auto_media')
const off = await autoMedia.execute(
  { description: 'a cat on a windowsill at golden hour', kind: 'image', count: 2 },
  { signal: new AbortController().signal }
)
check(off.mode === 'prompt-only', 'switch off => prompt-only mode', off.mode)
check(off.prompts.length === 2, 'prompts still produced')
check(off.images.length === 0, 'no image blocks')
check(off.files.length === 1 && off.files[0].path.endsWith('.md'), 'prompt sheet written', off.files[0]?.path)
check(/开关/.test(off.notice), 'notice explains the switch')

settingsService.describe = () => [{ ns: 'dsh-auto-prompt', value: { ...baseSettings, generateMedia: true, imageBaseUrl: '' }, revision: 2 }]
const on = await autoMedia.execute(
  { description: 'a cat on a windowsill', kind: 'image', count: 1 },
  { signal: new AbortController().signal }
)
check(on.mode === 'mock', 'switch on + no backend => mock mode', on.mode)
check(on.files.length === 1 && on.files[0].path.endsWith('.png'), 'real png written', on.files[0]?.path)

/* --------------------------------------------------------- 5. JSON schema */
console.log('\n[5] output schema conformance')
for (const [name, value] of [
  ['off', off],
  ['on', on],
]) {
  const tool = autoMedia
  const errors = validateJsonSchemaValue(JSON.parse(JSON.stringify(value)), tool.output.schema)
  check(errors.length === 0, `${name} result matches declared schema`, errors.map((e) => e.message).join('; '))
}

const promptValue = await tools2.get('auto_prompt').execute(
  { description: 'a lighthouse in fog', kind: 'image', count: 1 },
  { signal: new AbortController().signal }
)
const cfgErrors = validateJsonSchemaValue(JSON.parse(JSON.stringify(promptValue)), tools2.get('auto_prompt').output.schema)
check(cfgErrors.length === 0, 'auto_prompt result matches schema', cfgErrors.map((e) => e.message).join('; '))

const showValue = await tools2.get('auto_config').execute({ action: 'show' }, { signal: new AbortController().signal })
check(/生成开关/.test(showValue.message), 'auto_config show reports the switch')
const setValue = await tools2.get('auto_config').execute(
  { action: 'set', values: { generateMedia: true } },
  { signal: new AbortController().signal }
)
check(/生成开关/.test(setValue.message), 'auto_config set reports the switch')

/* ------------------------------------------------------- 6. 客户端设置页 */
console.log('\n[6] client half — settings section')

let bundle
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      bundle = definition
    },
  },
}
await import('../src/client.js')
check(bundle?.id === 'dsh-auto-prompt', 'bundle id matches the package name', bundle?.id)

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect(run) {
    // The fake harness never re-renders, so running the effect once inline is
    // enough to exercise the "sync draft with the stored value" path.
    run()
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}
const client = bundle.factory((specifier) => {
  if (specifier === 'react') return fakeReact
  throw new Error(`unexpected require(${specifier})`)
})
check(Array.isArray(client.inject) && client.inject.includes('configForms'), 'client injects slots/locale/configForms', (client.inject || []).join(','))
check(typeof client.apply === 'function', 'client half exports apply')

/** Render the element tree the fake React produced, keeping props for interaction. */
function renderTree(node) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderTree).filter((entry) => entry !== null)
  if (typeof node === 'function') return renderTree(node({}))
  if (typeof node.type === 'function') return renderTree(node.type({ ...node.props }))
  return { tag: node.type, props: node.props, children: renderTree(node.props.children) }
}
function textOf(tree) {
  if (tree === null) return ''
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(textOf).join(' ')
  return textOf(tree.children)
}
function findTag(tree, predicate) {
  if (tree === null || typeof tree === 'string') return undefined
  if (Array.isArray(tree)) {
    for (const entry of tree) {
      const hit = findTag(entry, predicate)
      if (hit) return hit
    }
    return undefined
  }
  if (predicate(tree)) return tree
  return findTag(tree.children, predicate)
}

const dictionaries = {}
const registrations = []
let served = ['dsh-auto-prompt']
const formWrites = []
const formSnapshot = {
  status: 'ready',
  writable: true,
  revision: 4,
  value: {
    ...normalizeConfig({}),
    generateMedia: false,
    promptModel: 'deepseek-chat',
    promptBaseUrl: 'http://127.0.0.1:11434/v1',
    imageBaseUrl: '',
    videoBaseUrl: '',
    videoSubmitUrl: '',
    outputDir: '',
  },
}
const fakeForm = {
  getSnapshot: () => formSnapshot,
  subscribe: () => () => {},
  set: async (field, value) => {
    formWrites.push({ field, value })
    return true
  },
  unset: async (field) => {
    formWrites.push({ field, unset: true })
    return true
  },
}
const clientCtx = {
  effect: (run) => {
    run()
  },
  locale: {
    bind: (ns) => (key) => dictionaries[ns]?.[key] ?? key,
    register: (ns, copy) => {
      dictionaries[ns] = copy.zh
      return () => {}
    },
  },
  configForms: {
    get: () => fakeForm,
    whileServed: (namespaces, register) => {
      if (namespaces.some((ns) => served.includes(ns))) return register()
      return () => {}
    },
  },
  slots: {
    inject: (_name, register) => register(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  // The Host directory picker seam this deployment composes. `pickResult` is
  // swapped per case: a path means "picked", null means "dialog cancelled".
  uiWorkspace: {
    pickDirectory: async () => pickResult,
  },
  // Undeclared services are read through reflect.get (ctx.foo would throw).
  reflect: {
    get: (name) => (name === 'uiWorkspace' ? clientCtx.uiWorkspace : undefined),
  },
}
let pickResult = 'D:\\AI\\out'
client.apply(clientCtx)
check(registrations.length === 1, 'registers exactly one settings section', String(registrations.length))
const section = registrations[0]?.options
check(section?.name === 'settings.section', 'slot name is settings.section')
check(section?.id === 'auto-prompt', 'section id', section?.id)
check(typeof section?.order === 'number', 'section carries a sort order', String(section?.order))
check(section?.label?.() === dictionaries[client.NS]?.nav, 'nav label resolves from the zh dictionary', section?.label?.())

const props = section.inject()
check(Boolean(props.form) && typeof props.t === 'function', 'section injects the form and a bound t')
const tree = renderTree(registrations[0].component(props))
const rendered = textOf(tree)
check(rendered.includes('自动提示词'), 'page renders its title')
check(rendered.includes('生成开关'), 'page renders the generation switch')
check(rendered.includes('只产出提示词'), 'switch-off state explained')
check(rendered.includes('模型地址') && rendered.includes('API 链接'), 'endpoint fields are editable on the page')
check(rendered.includes('API 密钥'), 'key fields are editable on the page')

const inputs = (function collect(node, out = []) {
  if (node === null || typeof node === 'string') return out
  if (Array.isArray(node)) {
    for (const entry of node) collect(entry, out)
    return out
  }
  if (node.tag === 'input') out.push(node)
  collect(node.children, out)
  return out
})(tree)
check(inputs.length === 10, 'renders one input per editable field except the folder picker', `${inputs.length} inputs`)
check(
  inputs.some((input) => input.props.value === 'http://127.0.0.1:11434/v1'),
  'stored prompt endpoint is shown in its input'
)
check(
  inputs.filter((input) => input.props.type === 'password').length === 3,
  'key inputs are masked'
)
check(
  inputs.every((input) => typeof input.props.onBlur === 'function' && typeof input.props.onKeyDown === 'function'),
  'inputs commit on blur and Enter'
)

const toggle = findTag(tree, (node) => node.tag === 'button' && node.props?.role === 'switch')
check(toggle?.props['aria-checked'] === 'false', 'switch starts off')
toggle?.props?.onClick?.()
await Promise.resolve()
check(formWrites.at(-1)?.field === 'generateMedia' && formWrites.at(-1)?.value === true, 'clicking the switch writes generateMedia=true')

const preset = findTag(tree, (node) => node.tag === 'button' && node.props?.title === '填入 https://api.deepseek.com/v1')
check(Boolean(preset), 'endpoint presets render next to the model address')
preset?.props?.onClick?.()
await Promise.resolve()
check(
  formWrites.at(-1)?.field === 'promptBaseUrl' && formWrites.at(-1)?.value === 'https://api.deepseek.com/v1',
  'clicking a preset writes promptBaseUrl'
)

/* 产物保存走系统文件夹对话框：选中即写入，取消不写。 */
const chooseButton = findTag(
  tree,
  (node) => node.tag === 'button' && node.props?.children === '选择文件夹…'
)
check(Boolean(chooseButton), 'output folder is picked with a button, not typed')
const writesBeforePick = formWrites.length
chooseButton?.props?.onClick?.()
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
check(
  formWrites.at(-1)?.field === 'outputDir' && formWrites.at(-1)?.value === 'D:\\AI\\out',
  'picking a folder writes outputDir',
  formWrites.at(-1)?.value
)

pickResult = null
const writesBeforeCancel = formWrites.length
chooseButton?.props?.onClick?.()
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
check(formWrites.length === writesBeforeCancel, 'cancelling the dialog writes nothing')

// A composition without the picker seam must still render and save by hand.
const withoutPicker = { ...clientCtx }
delete withoutPicker.uiWorkspace
const noPickerProps = { ...props, form: fakeForm, t: props.t, canPick: false, pick: () => Promise.reject(new Error('no picker')) }
const noPickerTree = renderTree(registrations[0].component(noPickerProps))
check(textOf(noPickerTree).includes('输出目录'), 'folder field still renders without the picker seam')
check(writesBeforePick < formWrites.length, 'earlier writes still recorded', String(formWrites.length))

served = ['some-other-plugin']
const dormant = []
clientCtx.slots.register = (options) => {
  dormant.push(options)
  return () => {}
}
client.apply(clientCtx)
check(dormant.length === 0, 'no section while the host does not serve the namespace')

delete globalThis.window

/* --------------------------------------------------------------- summary */
console.log(`\n${fail.length ? `FAILED (${fail.length}): ${fail.join(', ')}` : 'ALL CHECKS PASSED'}`)
process.exit(fail.length ? 1 : 0)
