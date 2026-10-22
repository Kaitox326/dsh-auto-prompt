/**
 * Configuration surface for dsh-auto-prompt.
 *
 * Every field carries a Chinese `.description()` — that text is what the
 * Harness plugin-configuration form renders under each input, so a user can
 * configure the whole thing without opening YAML.
 *
 * Every field is also marked `volatile`. On Harness 0.2.x a settings form only
 * exposes volatile fields, and a change that touches volatile fields is
 * committed into the running plugin instead of reloading it — which is what
 * lets the config be edited from inside a tool call without tearing that call
 * down. On 0.1.x the marker is simply ignored.
 *
 * @module dsh-auto-prompt/config
 */
import { homedir } from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { SETTINGS_NS } from './settings.js'

export { SETTINGS_NS }

const text = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback)

/**
 * Mark a field as live-editable across Harness generations.
 * 0.2.x has `.volatile()`; older schemastery only has the generic `.extra()`.
 */
const markVolatile = (schema) => {
  if (schema?.meta?.volatile) return schema
  if (typeof schema.volatile === 'function') return schema.volatile()
  if (typeof schema.extra === 'function') return schema.extra('volatile', true)
  return schema
}

const identity = (schema) => schema

/**
 * Build the whole field set with or without volatile markers.
 *
 * Two schemas exist on purpose: `Config` is what the Loader exports (volatile
 * fields are what a 0.2.x form renders), while `PlainConfig` is used to read
 * values. Resolving through the volatile schema would wrap every field in a
 * config reference, so a plugin that validated its own config with it would
 * see `{ get() }` objects instead of strings and booleans.
 * @param {(schema: object) => object} mark
 */
const buildFields = (mark) => ({
    enabled: mark(z.boolean().default(true).description('总开关。关掉后工具仍然可见，但会明确拒绝执行，方便临时停用。')),

    generateMedia: mark(
      z
        .boolean()
        .default(false)
        .description(
          '生成开关（是否真的调模型出图/出片）。关闭时只产出提示词，不向任何图片/视频服务发请求、不消耗额度；打开后才会把提示词送去生成真图或视频。想让这一项默认打开，就在这里打开并保存。'
        )
    ),

    mode: mark(
      z
        .union(['auto', 'live', 'mock'])
        .default('auto')
        .description(
          '生成开关打开后，后端缺失时怎么办。auto：缺密钥/地址时降级为演示模式（占位图 + 说明原因）；live：始终真实调用，缺配置直接报错；mock：始终演示，不联网。生成开关关闭时本项不生效。'
        )
    ),

    /* ---------------------------------------------------------------- 提示词模型 */
    promptBaseUrl: mark(
      z
        .string()
        .default('https://api.deepseek.com/v1')
        .description(
          '「理解你的话 → 写提示词」这一步用的大模型地址，OpenAI 兼容 /chat/completions。例：https://api.deepseek.com/v1、http://127.0.0.1:11434/v1（Ollama）、http://127.0.0.1:1234/v1（LM Studio）。'
        )
    ),
    promptApiKey: mark(
      z
        .string()
        .role('secret')
        .default('')
        .description('提示词模型的密钥。本地服务（Ollama / LM Studio / vLLM）通常留空即可，留空时不发送 Authorization 头。')
    ),
    promptModel: mark(
      z
        .string()
        .default('deepseek-chat')
        .description('提示词模型名。云：deepseek-chat；本地：qwen2.5:14b、llama3.1:8b 等，必须与本地服务里列出的名字一致。')
    ),
    promptTemperature: mark(
      z
        .number()
        .min(0)
        .max(2)
        .step(0.1)
        .default(0.8)
        .description('提示词生成温度。0.6 稳定保守，0.8 平衡，1.1 以上更发散（同一句话每次写法差别更大）。')
    ),
    promptLanguage: mark(
      z
        .union(['zh', 'en'])
        .default('en')
        .description('提示词输出语言。绝大多数绘图/视频模型对英文提示词更敏感，建议 en；只有明确要中文提示词时才改 zh。')
    ),
    promptStyleGuide: mark(
      z
        .string()
        .default('')
        .description(
          '全局风格偏好，会拼进每次提示词生成。例：「偏爱电影感人像、冷色调、35mm 胶片颗粒」或「扁平插画，配色克制」。留空则不加额外约束。'
        )
    ),

    /* ---------------------------------------------------------------- 图片生成 */
    imageBaseUrl: mark(
      z
        .string()
        .default('')
        .description('图片生成地址，OpenAI 兼容 /images/generations。例：https://api.openai.com/v1、http://127.0.0.1:8000/v1。')
    ),
    imageApiKey: mark(z.string().role('secret').default('').description('图片服务密钥。')),
    imageModel: mark(
      z.string().default('gpt-image-1').description('图片模型名。例：gpt-image-1、flux-dev、sd3.5-large、qwen-image。')
    ),
    imageSize: mark(
      z
        .string()
        .default('1024x1024')
        .description('默认图片尺寸，格式 宽x高。常用：1024x1024（方图）、1536x1024（横图）、1024x1536（竖图）。')
    ),
    imageExtraBody: mark(
      z
        .string()
        .default('{}')
        .description(
          '额外请求字段（JSON），会合并进图片请求体，用于 provider 特有参数。例：{"steps":30,"seed":42,"guidance_scale":3.5}。留 {} 表示不加。'
        )
    ),

    /* ---------------------------------------------------------------- 视频生成 */
    videoBaseUrl: mark(z.string().default('').description('视频服务基础地址，例：https://api.example.com/v1。')),
    videoApiKey: mark(z.string().role('secret').default('').description('视频服务密钥。')),
    videoModel: mark(z.string().default('').description('视频模型名，例：cogvideox-3、kling-v2、veo-3。')),
    videoSubmitUrl: mark(
      z
        .string()
        .default('')
        .description(
          '提交任务的完整 URL。留空则自动用 {videoBaseUrl}/videos；服务商路径不同时在这里填全，例：https://api.example.com/v1/video/generations。'
        )
    ),
    videoPollUrl: mark(
      z
        .string()
        .default('')
        .description('查询任务的 URL 模板，用 {id} 占位。留空则自动用 {videoBaseUrl}/videos/{id}。例：https://api.example.com/v1/tasks/{id}。')
    ),
    videoRequestBody: mark(
      z
        .string()
        .default('{"model":"{model}","prompt":"{prompt}"}')
        .description(
          '提交任务的 JSON 模板，支持占位符 {prompt} {model} {duration} {aspect_ratio}。例：{"model":"{model}","prompt":"{prompt}","parameters":{"duration":{duration},"aspect_ratio":"{aspect_ratio}"}}。'
        )
    ),
    videoIdPath: mark(
      z.string().default('id').description('任务 ID 在提交返回 JSON 中的路径（点号分隔），常见：id、task_id、data.id、data.task_id。')
    ),
    videoStatusPath: mark(z.string().default('status').description('任务状态字段路径，常见：status、data.status、data.task_status。')),
    videoResultPath: mark(
      z
        .string()
        .default('video_url')
        .description('完成后视频地址字段路径，常见：video_url、data.url、data.video_url、output.0.url。')
    ),
    videoDoneStates: mark(
      z
        .string()
        .default('succeeded,completed,success,done,SUCCESS')
        .description('视为「已完成」的状态值，逗号分隔，大小写需与服务商返回一致。')
    ),
    videoFailStates: mark(
      z
        .string()
        .default('failed,error,cancelled,canceled,FAILURE')
        .description('视为「已失败」的状态值，逗号分隔。')
    ),
    videoPollIntervalMs: mark(z.number().min(500).step(500).default(3000).description('轮询间隔（毫秒）。')),
    videoTimeoutMs: mark(
      z
        .number()
        .min(10000)
        .step(10000)
        .default(600000)
        .description('视频任务最长等待时间（毫秒），默认 10 分钟。超时会提示任务可能仍在服务端运行。')
    ),

    /* ---------------------------------------------------------------- 输出 */
    outputDir: mark(
      z
        .string()
        .default('')
        .description('产物保存目录。留空则存到 ~/.dsh/outputs/auto-prompt。支持 ~ 开头，例：~/Pictures/ai。')
    ),
    filenamePrefix: mark(
      z.string().default('').description('文件名前缀，留空为 auto。例：填 poster 会得到 poster-20261019-1530-a1b2.png。')
    ),
  })

/** Exported to the Loader: volatile fields are what a 0.2.x settings form renders. */
export const Config = z
  .object(buildFields(markVolatile))
  .description('dsh-auto-prompt：一句话 → 提示词 → 图片/视频。所有字段都会出现在 Harness 的插件配置表单里。')

/** Same fields without volatile markers — the schema used to read values. */
export const PlainConfig = z
  .object(buildFields(identity))
  .description('dsh-auto-prompt：一句话 → 提示词 → 图片/视频。')

/** Validate/complete a raw config object without ever producing config references. */
export function normalizeConfig(raw) {
  try {
    return PlainConfig(raw ?? {})
  } catch {
    return raw ?? {}
  }
}

/** Expand `~`, resolve relative paths, and fall back to the default output dir. */
export function resolveOutputDir(cfg) {
  const raw = text(cfg.outputDir, '')
  const base = raw ? path.resolve(expandHome(raw)) : path.join(homedir(), '.dsh', 'outputs', 'auto-prompt')
  return base
}

function expandHome(input) {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(homedir(), input.slice(2))
  return input
}

/** Parse a JSON blob from config, with an actionable error instead of a raw SyntaxError. */
export function parseJsonField(value, field, fallback) {
  const raw = text(value, '')
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `配置项 ${field} 不是合法 JSON：${error.message}。请检查引号/逗号，或点「重置为默认」后重填。`
    )
  }
}

/** Mask a secret for display: keep the last 4 characters so the user can tell keys apart. */
export function maskSecret(secret) {
  const value = typeof secret === 'string' ? secret.trim() : ''
  if (!value) return ''
  if (value.length <= 8) return '****'
  return `****${value.slice(-4)}`
}

/**
 * Work out whether this configuration can actually generate anything, and
 * explain — in the user's words, not an HTTP status — what is still missing.
 */
export function diagnose(cfg) {
  const items = []
  const push = (level, field, message) => items.push({ level, field, message })

  if (!cfg.enabled) push('error', 'enabled', '插件已被总开关停用：把「总开关」打开即可恢复。')

  push(
    cfg.generateMedia ? 'ok' : 'warn',
    'generateMedia',
    cfg.generateMedia
      ? '生成开关已打开：会调用后端真的出图/出片。'
      : '生成开关是关闭的：只产出提示词，不调用任何图片/视频服务，也不消耗额度。'
  )

  push(
    cfg.promptBaseUrl ? 'ok' : 'error',
    'promptBaseUrl',
    cfg.promptBaseUrl ? `提示词模型：${cfg.promptBaseUrl}` : '缺少提示词模型地址，无法把描述改写成提示词。'
  )
  if (cfg.promptBaseUrl && /^https?:\/\/[^/]+$/.test(cfg.promptBaseUrl)) {
    push('warn', 'promptBaseUrl', '这个地址没有 /v1 之类的版本路径。若调用报 404，请补成完整前缀，如 https://api.deepseek.com/v1。')
  }
  if (/^(https?:\/\/)?(127\.0\.0\.1|localhost)/.test(cfg.promptBaseUrl) && !cfg.promptApiKey) {
    push('ok', 'promptApiKey', '检测到本机地址，密钥留空是正常的。')
  }

  const imageReady = Boolean(cfg.imageBaseUrl)
  const videoReady = Boolean(cfg.videoSubmitUrl || cfg.videoBaseUrl)

  // Image/video readiness only matters when generation is actually enabled.
  const mediaLevel = cfg.generateMedia ? 'warn' : 'ok'
  push(
    imageReady ? 'ok' : mediaLevel,
    'imageBaseUrl',
    imageReady
      ? `图片服务：${cfg.imageBaseUrl}`
      : cfg.generateMedia
        ? '生成开关已打开，但还没配置图片服务，出图会走演示占位图。'
        : '未配置图片服务（生成开关关闭时不影响出提示词）。'
  )
  push(
    videoReady ? 'ok' : mediaLevel,
    'videoSubmitUrl',
    videoReady
      ? `视频服务：${cfg.videoSubmitUrl || `${cfg.videoBaseUrl}/videos`}`
      : cfg.generateMedia
        ? '生成开关已打开，但还没配置视频服务，视频请求只会产出分镜脚本。'
        : '未配置视频服务（生成开关关闭时不影响出提示词）。'
  )

  const level = items.some((i) => i.level === 'error') ? 'error' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'
  return { level, items, imageReady, videoReady, generating: Boolean(cfg.generateMedia) }
}

/** Human-readable one-screen summary used by the `auto_config` tool and startup log. */
export function summarize(cfg) {
  const d = diagnose(cfg)
  const lines = []
  lines.push(
    `生成开关：${cfg.generateMedia ? '已打开 —— 会真的调用后端出图/出片' : '已关闭 —— 只产出提示词，不调用图片/视频服务'}`
  )
  lines.push(`模式：${cfg.mode}${cfg.mode === 'auto' ? `（配置不全时会${d.imageReady ? '真实调用' : '降级为演示模式'}）` : ''}`)
  lines.push(
    `提示词模型：${cfg.promptModel} @ ${cfg.promptBaseUrl || '(未配置)'}${cfg.promptApiKey ? `（密钥 ${maskSecret(cfg.promptApiKey)}）` : ''}`
  )
  lines.push(`图片：${d.imageReady ? `${cfg.imageModel} → ${cfg.imageBaseUrl}` : '未配置（演示占位图）'}`)
  lines.push(
    `视频：${d.videoReady ? `${cfg.videoModel || '(未填模型名)'} → ${cfg.videoSubmitUrl || `${cfg.videoBaseUrl}/videos`}` : '未配置（仅出分镜脚本）'}`
  )
  lines.push(`输出目录：${resolveOutputDir(cfg)}`)
  return { level: d.level, text: lines.join('\n'), items: d.items, generating: d.generating }
}
