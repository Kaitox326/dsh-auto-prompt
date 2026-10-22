/**
 * Settings bridge — one implementation covering both Harness generations.
 *
 * 0.1.x (`dsh-settings` ≤ 0.1.2): a plugin *registers* a namespace and reads a
 * live scope. `ctx.settings.register(ns, schema, { base, applies })` returns
 * `{ get, update, replace }` and the value updates in place.
 *
 * 0.2.x (`dsh-settings` ≥ 0.2.0): `register()` is gone. The Loader entry's
 * `Config` schema is the form, fields marked `volatile` arrive inside
 * `apply(ctx, config)` as frozen reference objects (`{ get(), [write] }`) that
 * the Loader mutates in place, and writes go through
 * `ctx.settings.update(entryId, patch, revision)` where the entry id comes from
 * `loader.locate(ctx.fiber)`.
 *
 * This module hides the difference: callers always get plain values from
 * `bridge.get()` and always write through `bridge.update()`. If neither shape
 * is available it degrades to static entry config instead of throwing, so the
 * tools keep working on a Harness that exposes no settings service at all.
 *
 * @module dsh-auto-prompt/settings
 */

/** Reference protocol shared by every ESM/CJS copy of cosmokit. */
const WRITE = Symbol.for('cosmokit.volatile.write')

/** Namespace we register under on 0.1.x; also the install-time entry id. */
export const SETTINGS_NS = 'dsh-auto-prompt'

/**
 * Whether a value is a cordis volatile config reference rather than data.
 * `isVolatile` in cosmokit tests `write in value`; the structural fallback keeps
 * this working if the symbol ever moves.
 */
export function isVolatileRef(value) {
  if (typeof value !== 'object' || value === null) return false
  if (WRITE in value) return true
  const keys = Reflect.ownKeys(value)
  return typeof value.get === 'function' && keys.length <= 2 && !('set' in value)
}

/**
 * Deep-unwrap config references into detached plain data.
 * @param {unknown} value
 * @param {number} [depth] recursion guard for pathological structures
 */
export function unwrap(value, depth = 0) {
  if (depth > 12) return value
  if (isVolatileRef(value)) return unwrap(value.get(), depth + 1)
  if (Array.isArray(value)) return value.map((item) => unwrap(item, depth + 1))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = unwrap(item, depth + 1)
    return out
  }
  return value
}

/** Fields that identify our own entry among every plugin form. */
const MARKERS = ['promptModel', 'imageBaseUrl', 'videoBaseUrl']

function readService(ctx) {
  if (!ctx) return undefined
  try {
    if (typeof ctx.get === 'function') return ctx.get('settings')
  } catch {
    /* service missing */
  }
  return ctx.settings
}

/**
 * Candidate ids for this instance, most specific first.
 *
 * `loader.locate()` returns the id of the entry that owns the fiber, but a
 * plugin inserted through a patch lives under an include group, so it can come
 * back as `include:dsh-auto-prompt` while `describe()` keys the same entry as
 * `dsh-auto-prompt`. Both spellings are tried, then a schema-marker scan.
 */
function candidateIds(ctx) {
  const ids = []
  try {
    const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
    if (loader && typeof loader.locate === 'function' && ctx.fiber) {
      const id = loader.locate(ctx.fiber)
      if (id) {
        ids.push(id)
        const tail = id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : ''
        if (tail) ids.push(tail)
      }
    }
  } catch {
    /* no loader */
  }
  ids.push(SETTINGS_NS)
  return [...new Set(ids.filter(Boolean))]
}

/**
 * Resolve the profile entry id this plugin instance was loaded as.
 * @param {object} ctx
 * @param {object} service settings service
 */
function resolveEntryId(ctx, service) {
  const ids = candidateIds(ctx)
  let known = []
  try {
    known = typeof service?.describe === 'function' ? service.describe() : []
  } catch {
    known = []
  }
  const names = new Set(known.map((item) => item?.ns).filter(Boolean))
  if (names.size) {
    for (const id of ids) if (names.has(id)) return id
    const mine = known.find((item) => item?.value && MARKERS.some((key) => key in item.value))
    if (mine?.ns) return mine.ns
  }
  return ids[0]
}

/**
 * Build the bridge for one plugin instance.
 * @param {object} ctx plugin context
 * @param {object} Config schemastery schema exported by the plugin
 * @param {object} [entryConfig] raw config handed to `apply()`
 * @param {(message: string) => void} [warn] logger
 */
export function createSettingsBridge(ctx, Config, entryConfig, warn = () => {}) {
  const service = readService(ctx)

  /** Always hand callers a fully-defaulted plain object. */
  const resolve = (raw) => {
    try {
      return Config(raw ?? {})
    } catch {
      return raw ?? {}
    }
  }

  const staticValue = () => resolve(unwrap(entryConfig))

  /* ------------------------------------------------------------ legacy 0.1.x */

  if (service && typeof service.register === 'function') {
    try {
      const scope = service.register(SETTINGS_NS, Config, { base: entryConfig ?? {}, applies: 'live' })
      return {
        mode: 'legacy',
        ns: SETTINGS_NS,
        get: () => resolve(unwrap(scope.get())),
        async update(patch) {
          await scope.update(patch)
        },
        async replace(section) {
          await scope.replace(section)
        },
        writable: true,
      }
    } catch (error) {
      warn(`设置命名空间注册失败，改用条目配置：${error?.message || error}`)
    }
  }

  /* ------------------------------------------------------------- forms 0.2.x */

  if (service && typeof service.describe === 'function' && typeof service.update === 'function') {
    let ns = resolveEntryId(ctx, service)

    const safeDescribe = () => {
      try {
        return service.describe()
      } catch {
        return []
      }
    }

    /**
     * Find our own descriptor, healing `ns` if the first guess was an include
     * path or the settings service was still empty when we picked it.
     */
    const descriptor = () => {
      const list = safeDescribe()
      const exact = list.find((item) => item?.ns === ns)
      if (exact) return exact
      const mine = list.find((item) => item?.value && MARKERS.some((key) => key in item.value))
      if (mine?.ns) {
        ns = mine.ns
        return mine
      }
      return undefined
    }

    const get = () => {
      const base = unwrap(entryConfig)
      const shape = descriptor()
      const live = shape && shape.value && typeof shape.value === 'object' ? shape.value : null
      return resolve(live ? { ...base, ...live } : base)
    }

    const write = async (patcher) => {
      const first = descriptor()
      try {
        await patcher(first?.revision)
      } catch (error) {
        // A concurrent editor moved the revision between our read and write, or
        // the entry id we guessed is not the one this service keys forms by.
        const stale = error?.code === 'SETTINGS_CONFLICT' || /No configurable plugin entry/i.test(error?.message || '')
        if (!stale) throw error
        await patcher(descriptor()?.revision)
      }
    }

    return {
      mode: 'forms',
      get ns() {
        return ns
      },
      get,
      update: (patch) => write((revision) => service.update(ns, patch, revision)),
      replace: (section) => write((revision) => service.replace(ns, section, revision)),
      get writable() {
        try {
          return service.writable !== false
        } catch {
          return true
        }
      },
    }
  }

  /* ---------------------------------------------------------------- degraded */

  return {
    mode: 'static',
    ns: SETTINGS_NS,
    get: staticValue,
    async update() {
      throw new Error(
        '当前 Harness 没有可写的设置服务，无法在对话里改配置。请直接编辑 profile 的 cordis.patch.yml，在 dsh-auto-prompt 条目的 config 段里改。'
      )
    },
    async replace() {
      throw new Error('当前 Harness 没有可写的设置服务，无法重置配置。')
    },
    writable: false,
  }
}
