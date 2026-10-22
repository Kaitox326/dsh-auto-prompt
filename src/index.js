/**
 * dsh-auto-prompt — describe it in your own words, get a real picture.
 *
 * Pipeline: your sentence → (configured chat model) → an executable prompt →
 * (configured image/video backend) → a file on disk, shown inline in the chat.
 *
 * The second half is gated by the `generateMedia` switch: while it is off a run
 * stops after the prompt and writes a prompt sheet instead, so nothing is spent
 * on a backend the user has not opted into yet.
 *
 * @module dsh-auto-prompt
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  Config as ConfigSchema,
  PlainConfig,
  diagnose,
  normalizeConfig,
  parseJsonField,
  resolveOutputDir,
  summarize,
} from './config.js'
import { createSettingsBridge } from './settings.js'
import { buildPrompts, fallbackPrompts, isLocalEndpoint } from './prompt.js'
import { downloadBinary, generateImage, generateVideo } from './providers.js'
import { placeholderPng, saveProduct } from './media.js'
import { describeHttpFailure, describeNetworkFailure } from './errors.js'

export const name = 'dsh-auto-prompt'
export const inject = ['tools']
export const Config = ConfigSchema

const KIND_LABEL = { image: '图片', video: '视频' }
const SWITCH_HINT =
  '生图/生视频开关是关着的。要真的出图/出片，跟我说「打开生成开关」，或在「设置 → 自动提示词」里打开「生成开关」。'

/* ------------------------------------------------------------------ 小工具 */

function parseSize(size) {
  const match = String(size || '').match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (!match) return { width: 1024, height: 1024 }
  return { width: Number(match[1]), height: Number(match[2]) }
}

async function attachImage(ctx, buffer, mediaType, displayName) {
  const store = ctx.attachments
  if (!store || typeof store.saveImage !== 'function') return null
  try {
    return await store.saveImage({ data: new Uint8Array(buffer), mediaType, name: displayName })
  } catch {
    // The attachment policy can reject a format or size. The file on disk is
    // still there; we simply present it as a path instead of an inline image.
    return null
  }
}

function bullet(lines) {
  return lines.filter(Boolean).join('\n')
}

/** One model-facing report, reused by both media tools. */
function report(value) {
  const kindLabel = KIND_LABEL[value.kind] || '产物'
  const head = []
  if (value.mode === 'prompt-only') {
    head.push(`只产出了 ${value.prompts.length} 条${kindLabel}提示词，没有调用${kindLabel}模型（生成开关未打开）。`)
  } else {
    head.push(`已生成 ${value.files.length} 个${kindLabel}${value.mode === 'mock' ? '（演示模式）' : ''}。`)
  }
  if (value.notice) head.push(value.notice)
  const promptBlock = value.prompts
    .map((p, i) => {
      const lines = [`【方案 ${i + 1}】${p.title || ''}`.trim(), `提示词：${p.prompt}`]
      if (p.negativePrompt) lines.push(`反向提示词：${p.negativePrompt}`)
      if (p.notes) lines.push(`说明：${p.notes}`)
      return lines.join('\n')
    })
    .join('\n\n')
  const fileBlock = value.files.map((f) => `- ${f.path}（${f.bytes} 字节）`).join('\n')
  return bullet([head.join(' '), '', promptBlock, '', fileBlock ? `文件：\n${fileBlock}` : ''])
}

function resultContent(value) {
  return [{ type: 'text', text: report(value) }]
}

function mediaPresentation(value) {
  return { kind: value.kind, mode: value.mode, files: value.files, images: value.images || [] }
}

/** Render the prompt sheet written when generation is switched off. */
function promptSheet(cfg, kind, prompts, description) {
  const lines = [
    `# dsh-auto-prompt · ${KIND_LABEL[kind] || '产物'}提示词`,
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 提示词来源：${cfg.promptModel || '内置模板'}`,
    `- 生成开关：关闭（本次没有调用${KIND_LABEL[kind] || ''}模型）`,
    '',
    '## 原始描述',
    '',
    String(description || '').trim() || '(空)',
    '',
  ]
  prompts.forEach((p, index) => {
    lines.push(`## 方案 ${index + 1}${p.title ? ` · ${p.title}` : ''}`, '')
    lines.push('~~~text', p.prompt, '~~~', '')
    if (p.negativePrompt) lines.push(`**反向提示词**：${p.negativePrompt}`, '')
    if (p.aspectRatio) lines.push(`**画幅**：${p.aspectRatio}`, '')
    if (p.duration) lines.push(`**时长**：${p.duration} 秒`, '')
    if (p.notes) lines.push(`**说明**：${p.notes}`, '')
  })
  lines.push('---', '', '把上面任意一条提示词粘到你的绘图/视频工具里即可。想让我直接出图，打开生成开关后再说一次「画一张…」。', '')
  return Buffer.from(lines.join('\n'), 'utf8')
}

/* ------------------------------------------------------------------ 插件主体 */

export function apply(ctx, config) {
  const warn = (message) => console.warn(`[dsh-auto-prompt] ${message}`)

  // The settings service may still be coming up when `apply` runs, and its shape
  // differs between Harness generations. Build lazily and retry until a real
  // service is found, so a missing one never stops the tools from registering.
  let bridge = createSettingsBridge(ctx, PlainConfig, config, warn)

  const settings = () => {
    if (bridge.mode === 'static') {
      const next = createSettingsBridge(ctx, PlainConfig, config, warn)
      if (next.mode !== 'static') bridge = next
    }
    return bridge
  }

  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], () => {
        if (bridge.mode === 'static') bridge = createSettingsBridge(ctx, PlainConfig, config, warn)
      })
    }
  } catch {
    /* no injection seam on this host — `settings()` retries on demand */
  }

  /** Read the resolved configuration (user layer → entry config → defaults). */
  const current = () => settings().get()

  const ready = () => {
    const cfg = current()
    if (!cfg.enabled) {
      throw new Error('dsh-auto-prompt 已被总开关停用。到「设置 → 自动提示词」把「总开关」打开即可。')
    }
    return cfg
  }

  /** Field names the user may set, derived from the schema's own defaults. */
  const knownFields = () => Object.keys(normalizeConfig({}))

  /**
   * Prompt stage with a graceful floor: if no chat model is configured (or it
   * fails) the built-in scaffold keeps the run alive and says so, instead of
   * handing the user an HTTP error where a picture was expected.
   */
  async function resolvePrompts(cfg, input, signal) {
    const promptReady = Boolean(cfg.promptApiKey) || isLocalEndpoint(cfg.promptBaseUrl)
    if (!promptReady && cfg.mode !== 'live') {
      return {
        prompts: fallbackPrompts(input),
        source: 'fallback',
        warning:
          '未配置提示词模型密钥，提示词由内置模板组装。到插件配置里填「提示词模型密钥」（本地模型则填本机地址即可）会明显更懂你的描述。',
      }
    }
    try {
      const { prompts } = await buildPrompts(cfg, input, signal)
      return { prompts, source: 'model', warning: '' }
    } catch (error) {
      if (cfg.mode === 'live') throw error
      return {
        prompts: fallbackPrompts(input),
        source: 'fallback',
        warning: `提示词模型没调通，已用内置模板兜底。原因：${error?.message || error}`,
      }
    }
  }

  /** run the pipeline, shared by both media tools */
  async function produce(args, signal) {
    const cfg = ready()
    const kind = args.kind === 'video' ? 'video' : 'image'
    const count = Math.max(1, Math.min(4, Number(args.count) || 1))
    const diagnostic = diagnose(cfg)
    const generating = Boolean(cfg.generateMedia)

    const { prompts, source, warning } = await resolvePrompts(
      cfg,
      {
        description: args.description,
        kind,
        count,
        style: args.style || '',
        aspectRatio: args.aspectRatio || '',
        duration: args.duration,
      },
      signal
    )

    const base = {
      kind,
      promptSource: source,
      prompts: prompts.map((p) => ({
        title: p.title,
        prompt: p.prompt,
        negativePrompt: p.negativePrompt,
        aspectRatio: p.aspectRatio,
        duration: p.duration ?? null,
        notes: p.notes,
      })),
      config: { model: cfg.promptModel, outputDir: resolveOutputDir(cfg), generating },
    }

    /* ------------------------------------------------ 生成开关关闭：只写提示词 */
    if (!generating) {
      const sheet = promptSheet(cfg, kind, prompts, args.description)
      const file = await saveProduct(cfg, kind, sheet, { ext: 'md', suffix: 'prompts' })
      return {
        ...base,
        mode: 'prompt-only',
        files: [file],
        images: [],
        notice: [SWITCH_HINT, warning].filter(Boolean).join(' '),
      }
    }

    /* ------------------------------------------------------------ 生成开关打开 */
    const missing = kind === 'image' ? !diagnostic.imageReady : !diagnostic.videoReady
    if (cfg.mode === 'live' && missing) {
      throw new Error(
        kind === 'image'
          ? '生成开关已打开且当前是 live 模式，但还没配置图片服务地址。请用 auto_config(action=set, values={"imageBaseUrl":"...","imageApiKey":"...","imageModel":"..."}) 补齐，或把模式改回 auto 先用演示占位图。'
          : '生成开关已打开且当前是 live 模式，但还没配置视频服务。请用 auto_config 补齐 videoBaseUrl / videoSubmitUrl 等字段，或把模式改回 auto。'
      )
    }

    const mock = cfg.mode === 'mock' || (cfg.mode === 'auto' && missing)
    const files = []
    const images = []
    let notice = ''

    if (mock) {
      notice =
        kind === 'image'
          ? '当前是演示模式（未配置图片服务），下面是真实可用的提示词 + 一张占位图。到插件配置里填好「图片生成地址」和密钥即可出真图。'
          : '当前是演示模式（未配置视频服务），只产出了分镜脚本，没有真实视频。到插件配置里填好视频地址/模板即可出片。'
      for (const [index, item] of prompts.entries()) {
        if (kind === 'image') {
          const { width, height } = parseSize(cfg.imageSize)
          const buffer = placeholderPng({ width: Math.min(width, 960), height: Math.min(height, 960), seed: index + 1 })
          const saved = await saveProduct(cfg, 'image', buffer, { mediaType: 'image/png' })
          files.push(saved)
          const ref = await attachImage(ctx, buffer, 'image/png', saved.path)
          if (ref) images.push(ref)
        } else {
          const storyboard = JSON.stringify(
            {
              mode: 'demo',
              prompt: item.prompt,
              negativePrompt: item.negativePrompt,
              aspectRatio: item.aspectRatio,
              duration: item.duration,
              notes: item.notes,
            },
            null,
            2
          )
          files.push(await saveProduct(cfg, 'video', Buffer.from(storyboard, 'utf8'), { ext: 'json' }))
        }
      }
    } else if (kind === 'image') {
      const extra = parseJsonField(cfg.imageExtraBody, '图片额外请求字段', {})
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
        throw new Error('配置项「图片额外请求字段」必须是 JSON 对象，例如 {"steps":30}。')
      }
      for (const item of prompts) {
        const { data, mediaType, revisedPrompt } = await generateImage(
          cfg,
          { prompt: item.prompt, size: cfg.imageSize, extra },
          signal
        )
        const saved = await saveProduct(cfg, 'image', data, { mediaType })
        files.push(saved)
        const ref = await attachImage(ctx, data, mediaType, saved.path)
        if (ref) images.push(ref)
        if (revisedPrompt) item.notes = [item.notes, `服务商改写：${revisedPrompt}`].filter(Boolean).join('；')
      }
    } else {
      // One clip per call: a video task is minutes of wall-clock time.
      const item = prompts[0]
      const task = await generateVideo(
        cfg,
        { prompt: item.prompt, aspectRatio: item.aspectRatio || args.aspectRatio, duration: item.duration || args.duration },
        signal
      )
      const buffer = await downloadBinary(task.source, signal)
      const url = task.source.split('?')[0].toLowerCase()
      const ext = url.endsWith('.webm') ? 'webm' : url.endsWith('.mov') ? 'mov' : 'mp4'
      files.push(await saveProduct(cfg, 'video', buffer, { ext }))
      notice = `视频任务 ${task.taskId} 用时 ${Math.round(task.elapsedMs / 1000)} 秒完成。`
    }

    if (warning) notice = [notice, warning].filter(Boolean).join(' ')

    return { ...base, mode: mock ? 'mock' : 'live', files, images, notice }
  }

  /* ---------------------------------------------------------------- 工具 1 */

  ctx.tools.register(
    defineTool({
      name: 'auto_prompt',
      description:
        '把用户的一句话/一个想法改写成可直接投喂给绘图或视频模型的提示词（只写提示词，不生成画面、不调后端）。用户说「帮我想个提示词」「这段话怎么写成 prompt」「翻译成 SD/MJ 提示词」时使用。要同时出图/出片用 auto_media。',
      parameters: {
        description: { type: 'string', required: true, description: '用户原话或需求描述，保留原始细节，不要自己先概括。' },
        kind: {
          type: 'string',
          enum: ['image', 'video'],
          description: '要写图片提示词还是视频提示词。默认 image。',
        },
        count: { type: 'integer', description: '要几个方案，1-4，默认 1。方案之间是不同视角/氛围，不是同义改写。' },
        style: { type: 'string', description: '本次指定的风格，如「赛博朋克」「吉卜力」「product photography」。留空则用全局风格偏好。' },
        aspectRatio: { type: 'string', description: '画幅，如 16:9 / 9:16 / 1:1。' },
        duration: { type: 'integer', description: '视频时长（秒），仅视频有意义。' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            prompts: { type: 'array', items: { type: 'object', additionalProperties: true } },
            model: { type: 'string' },
          },
          additionalProperties: true,
        },
        render: (args, value) => {
          const lines = value.prompts.map(
            (p, i) =>
              `【方案 ${i + 1}】${p.title || ''}\n${p.prompt}${p.negativePrompt ? `\n反向提示词：${p.negativePrompt}` : ''}${p.notes ? `\n说明：${p.notes}` : ''}`
          )
          if (value.warning) lines.push(value.warning)
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
      },
      async execute(args, exec) {
        const cfg = ready()
        const kind = args.kind === 'video' ? 'video' : 'image'
        const { prompts, source, warning } = await resolvePrompts(
          cfg,
          {
            description: args.description,
            kind,
            count: Math.max(1, Math.min(4, Number(args.count) || 1)),
            style: args.style || '',
            aspectRatio: args.aspectRatio || '',
            duration: args.duration,
          },
          exec.signal
        )
        return { prompts, model: cfg.promptModel, source, warning }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `写${KIND_LABEL[args.kind === 'video' ? 'video' : 'image']}提示词`,
        kind: 'other',
        rawInput: args.description,
      }),
      presentResult: (args, result) => ({
        card: 'generic',
        title: '提示词已生成',
        content: result.content,
      }),
    })
  )

  /* ---------------------------------------------------------------- 工具 2 */

  ctx.tools.register(
    defineTool({
      name: 'auto_media',
      description:
        '一步到位：理解用户描述 → 生成最优提示词 →（生成开关打开时）调用本地模型或 API → 产出真正的图片或视频文件。用户说「画一张…」「生成张图」「做个图」「生成一段视频」「来条片子」「帮我出个画面」时使用。生成开关关闭时只产出提示词并落盘成 md，不会调用后端；需要先打开开关才会真出图/出片。',
      parameters: {
        description: { type: 'string', required: true, description: '用户原话或需求描述，尽量保留原话里的细节与限制条件。' },
        kind: { type: 'string', enum: ['image', 'video'], description: '生成图片还是视频。默认 image。视频每次只出一条，且通常需要数分钟。' },
        count: { type: 'integer', description: '图片张数 1-4，默认 1。视频固定 1 条。' },
        style: { type: 'string', description: '本次风格，如「电影感」「扁平插画」「黏土动画」。' },
        aspectRatio: { type: 'string', description: '画幅，如 16:9 / 9:16 / 1:1。' },
        duration: { type: 'integer', description: '视频时长（秒），默认 5。' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            mode: { type: 'string' },
            notice: { type: 'string' },
            prompts: { type: 'array', items: { type: 'object', additionalProperties: true } },
            files: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
          additionalProperties: true,
        },
        // render/presentationMeta both receive (args, value) — wrapping keeps the
        // projection helpers single-argument and honest about it.
        render: (_args, value) => resultContent(value),
        presentationMeta: (_args, value) => mediaPresentation(value),
      },
      async execute(args, exec) {
        return produce(args, exec.signal)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `${args.kind === 'video' ? '视频' : '图片'}：${String(args.description || '').slice(0, 40)}`,
        kind: 'other',
        rawInput: args.description,
      }),
      presentResult: (args, result) => {
        const meta = result.meta || {}
        const images = Array.isArray(meta.images) ? meta.images : []
        const content = [...result.content]
        for (const ref of images) content.push({ type: 'image', attachment: ref })
        const count = Array.isArray(meta.files) ? meta.files.length : 0
        const label = KIND_LABEL[meta.kind === 'video' ? 'video' : 'image']
        let title
        if (meta.mode === 'prompt-only') title = `已生成 ${count} 份${label}提示词（未出${meta.kind === 'video' ? '片' : '图'}）`
        else if (count) title = `已生成 ${count} 个${label}${meta.mode === 'mock' ? '（演示）' : ''}`
        return { card: 'generic', title, content }
      },
    })
  )

  /* ---------------------------------------------------------------- 工具 3 */

  ctx.tools.register(
    defineTool({
      name: 'auto_config',
      description:
        '查看、修改或检测 dsh-auto-prompt 的配置（生成开关、提示词模型地址、图片/视频服务、密钥、输出目录）。用户说「这个插件怎么配」「配好了吗」「为什么报错」「测一下通不通」「换个模型」「打开/关闭生成开关」时使用。action=show 查看与诊断，set 修改（只传要改的字段，开关用 {"generateMedia":true}），test 真实连通性检测，reset 恢复默认。',
      parameters: {
        action: {
          type: 'string',
          enum: ['show', 'set', 'test', 'reset'],
          required: true,
          description: 'show 查看；set 修改；test 检测连通性；reset 清空用户配置回到默认。',
        },
        values: {
          type: 'object',
          additionalProperties: true,
          description:
            'action=set 时要改的字段（只传变化的键）。如 {"generateMedia":true} 打开生成开关，{"promptBaseUrl":"http://127.0.0.1:11434/v1","promptModel":"qwen2.5:14b"} 换成本地模型。字段名见 action=show 的输出。',
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            level: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
          additionalProperties: true,
        },
        render: (args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        if (args.action === 'show') {
          const cfg = current()
          const summary = summarize(cfg)
          const rows = summary.items.map((item) => {
            const icon = item.level === 'ok' ? '✅' : item.level === 'warn' ? '⚠️' : '❌'
            return `${icon} ${item.field}：${item.message}`
          })
          const message = [
            'dsh-auto-prompt 当前配置',
            '',
            summary.text,
            '',
            '检查结果：',
            ...rows,
            '',
            '下一步：',
            !cfg.generateMedia
              ? '生成开关是关着的，现在只会出提示词。要出真图/真片：auto_config(action=set, values={"generateMedia":true})，或到「设置 → 自动提示词」打开「生成开关」。'
              : summary.level === 'ok'
                ? '一切就绪，直接说「画一张…」或「生成一段…视频」即可。'
                : '用 auto_config(action=set, values={...}) 补上缺的字段，或到「设置 → 自动提示词」里填。改完可 action=test 验证。',
          ].join('\n')
          return { ok: summary.level !== 'error', level: summary.level, message, details: summary.items }
        }

        if (args.action === 'reset') {
          await settings().replace({})
          return { ok: true, level: 'ok', message: '已清空用户配置，全部字段回到默认值（生成开关默认关闭）。' }
        }

        if (args.action === 'set') {
          const values = args.values
          if (!values || typeof values !== 'object' || !Object.keys(values).length) {
            throw new Error('action=set 需要提供 values，例如 {"generateMedia":true}。只想看当前配置请用 action=show。')
          }
          const known = knownFields()
          const unknown = Object.keys(values).filter((key) => known.length && !known.includes(key))
          if (unknown.length) {
            throw new Error(`未知配置项：${unknown.join('、')}。可用字段：${known.join('、')}。`)
          }
          await settings().update(values)
          const cfg = current()
          const summary = summarize(cfg)
          const switchLine =
            'generateMedia' in values
              ? cfg.generateMedia
                ? '生成开关已打开：下次「画一张…」会真的调用后端出图/出片。'
                : '生成开关已关闭：之后只会产出提示词，不会调用图片/视频服务。'
              : ''
          const lines = [`已保存 ${Object.keys(values).join('、')}。`]
          if (switchLine) lines.push(switchLine)
          lines.push('', summary.text, '', summary.level === 'ok' ? '配置已就绪。' : '还有字段没填全，补齐后才能真实出图/出片。')
          return { ok: true, level: summary.level, message: lines.join('\n') }
        }

        // action === 'test'
        const cfg = ready()
        const details = []
        const lines = []

        const promptUrl = String(cfg.promptBaseUrl || '').replace(/\/+$/, '') + '/chat/completions'
        const started = Date.now()
        try {
          const response = await fetch(promptUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cfg.promptApiKey ? { authorization: `Bearer ${cfg.promptApiKey}` } : {}),
            },
            body: JSON.stringify({
              model: cfg.promptModel,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 4,
              stream: false,
            }),
            signal: AbortSignal.timeout(30000),
          })
          const elapsed = Date.now() - started
          if (response.ok) {
            details.push({ target: 'prompt', ok: true, elapsedMs: elapsed })
            lines.push(`✅ 提示词模型连通（${elapsed} ms）：${cfg.promptModel} @ ${cfg.promptBaseUrl}`)
          } else {
            const reason = await describeHttpFailure(response, '提示词模型', promptUrl)
            details.push({ target: 'prompt', ok: false, status: response.status })
            lines.push(`❌ ${reason}`)
          }
        } catch (error) {
          details.push({ target: 'prompt', ok: false })
          lines.push(`❌ ${describeNetworkFailure(error, '提示词模型', promptUrl)}`)
        }

        lines.push(
          cfg.generateMedia
            ? 'ℹ️ 生成开关：已打开，出图/出片会真实调用后端。'
            : 'ℹ️ 生成开关：已关闭，本次只测提示词模型；图片/视频服务不会被调用。'
        )

        if (!cfg.imageBaseUrl) {
          lines.push(cfg.generateMedia ? '⚠️ 图片服务未配置，出图会走演示占位图。' : 'ℹ️ 图片服务未配置（不影响出提示词）。')
        } else {
          const modelsUrl = String(cfg.imageBaseUrl).replace(/\/+$/, '') + '/models'
          try {
            const response = await fetch(modelsUrl, {
              headers: cfg.imageApiKey ? { authorization: `Bearer ${cfg.imageApiKey}` } : {},
              signal: AbortSignal.timeout(15000),
            })
            if (response.ok) lines.push(`✅ 图片服务可达（${modelsUrl}），模型名：${cfg.imageModel}`)
            else if (response.status === 404) lines.push(`✅ 图片服务域名可达，但该服务没有 /models 列表接口（不影响出图）。`)
            else lines.push(`⚠️ 图片服务探测返回 HTTP ${response.status}，真正出图时才能确定，建议直接试一张。`)
            details.push({ target: 'image', ok: true, status: response.status })
          } catch (error) {
            details.push({ target: 'image', ok: false })
            lines.push(`❌ ${describeNetworkFailure(error, '图片服务', modelsUrl)}`)
          }
        }

        if (!cfg.videoBaseUrl && !cfg.videoSubmitUrl) {
          lines.push(cfg.generateMedia ? '⚠️ 视频服务未配置，视频请求只会产出分镜脚本。' : 'ℹ️ 视频服务未配置（不影响出提示词）。')
        } else {
          lines.push(
            `ℹ️ 视频服务未做真实提交（避免消耗额度）。提交地址：${cfg.videoSubmitUrl || `${cfg.videoBaseUrl}/videos`}`
          )
        }

        const ok = !details.some((d) => d.target === 'prompt' && !d.ok)
        return { ok, level: ok ? 'ok' : 'error', message: ['连通性检测：', '', ...lines].join('\n'), details }
      },
      presentCall: (args) => ({ card: 'generic', title: `插件配置：${args.action}`, kind: 'other' }),
      presentResult: (_args, result) => ({ card: 'generic', content: result.content }),
    })
  )

  // One startup line so a user can confirm the plugin actually mounted by
  // looking at the Harness log (the loader has no logger service on ctx).
  const cfgAtBoot = current()
  const where =
    bridge.mode === 'legacy'
      ? '配置页已接管（旧版 register 接口）'
      : bridge.mode === 'forms'
        ? '配置页已接管（新版表单接口）'
        : '设置服务暂未就绪（首次读取配置时会自动重试）'
  console.log(
    `[dsh-auto-prompt] 已加载 — ${where}；生成开关${cfgAtBoot.generateMedia ? '打开' : '关闭（只出提示词）'}；提示词模型 ${cfgAtBoot.promptModel} @ ${cfgAtBoot.promptBaseUrl}；输出目录 ${resolveOutputDir(cfgAtBoot)}`
  )

  // `settings` can mount after `apply()`. Re-check once the boot settles, so an
  // operator reading the log can tell whether the page really attached. Set
  // DSH_AUTO_PROMPT_DEBUG=1 for the full descriptor dump.
  if (process.env.DSH_AUTO_PROMPT_DEBUG) {
    setTimeout(() => {
      const mode = settings().mode
      console.log(`[dsh-auto-prompt] 诊断：设置接口=${mode}，条目=${settings().ns}`)
      try {
        const service = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
        const list = typeof service?.describe === 'function' ? service.describe() : []
        console.log(`[dsh-auto-prompt] 诊断：可配置条目 ${list.length} 个`)
        for (const item of list) {
          const keys = Object.keys(item.value || {})
          console.log(`  - ${item.ns}（autoGenerate=${item.autoGenerate}，字段 ${keys.length}）`)
        }
      } catch (error) {
        console.log(`[dsh-auto-prompt] 诊断失败：${error?.message || error}`)
      }
    }, 3000)
  }
}
