/**
 * Step one of the pipeline: understand the user's sentence and write a prompt
 * that a diffusion model can actually act on.
 *
 * The LLM here is whatever OpenAI-compatible endpoint the user configured —
 * cloud or a local llama.cpp/Ollama/LM Studio server. Nothing about this module
 * assumes DeepSeek.
 *
 * @module dsh-auto-prompt/prompt
 */
import { describeHttpFailure, describeNetworkFailure } from './errors.js'

const KIND_LABEL = { image: '图片', video: '视频' }

/** Join a base URL and a path without doubling or dropping the slash. */
export function joinUrl(base, suffix) {
  const left = String(base || '').replace(/\/+$/, '')
  const right = String(suffix || '').replace(/^\/+/, '')
  return right ? `${left}/${right}` : left
}

function systemPrompt(cfg) {
  const languageRule =
    cfg.promptLanguage === 'zh'
      ? '提示词用简体中文书写（若目标模型明显是英文模型，仍以中文为主、关键术语可保留英文）。'
      : 'Write every prompt in fluent, concrete English — the language diffusion models are trained on most heavily.'

  return [
    'You are a senior prompt engineer for generative image and video models.',
    'You receive a user description written in natural language, possibly vague or in Chinese, and you turn it into prompts that a diffusion/video model can execute well.',
    '',
    'Rules:',
    '1. Preserve the user\'s intent. Never invent a different subject, and never drop something the user explicitly asked for.',
    '2. Make implicit decisions explicit: lens, framing, lighting, palette, material, mood. A model cannot guess taste.',
    '3. Prefer concrete visual nouns and measurable conditions over abstractions ("wet asphalt reflecting red neon" beats "nice atmosphere").',
    '4. Never include camera-brand watermarks, artist names of living people, or text/logos unless the user asked for text.',
    '5. Describe only what is visible or happens on screen. No meta commentary inside the prompt field.',
    `6. ${languageRule}`,
    cfg.promptStyleGuide
      ? `7. The user's standing style preference (always obey unless it conflicts with an explicit request): ${cfg.promptStyleGuide}`
      : '7. No standing style preference is configured; keep the style faithful to the description.',
    '',
    'Reply with ONE JSON object and nothing else — no markdown fence, no prose before or after:',
    '{"prompts":[{"title":"不超过12字的短标题","prompt":"the final prompt","negative_prompt":"comma separated things to avoid","params":{"aspect_ratio":"16:9","suggested_duration_seconds":5},"notes":"用一句中文说明你为什么这样写"}]}',
    'The array must contain exactly the requested number of entries. Every entry must be a genuinely different interpretation (different angle, lens, mood or time of day), not a reworded duplicate.',
  ].join('\n')
}

function shapeHint(kind) {
  return kind === 'video'
    ? [
        'This is a VIDEO prompt. Cover, in this order, in flowing prose:',
        '- shot size and camera (e.g. "slow dolly-in, 35mm, shallow depth of field")',
        '- subject and what it does over time, with a clear beginning → middle → end beat',
        '- environment and how light behaves',
        '- atmosphere and colour grade',
        '- style reference in words (cinematic live action / anime / claymation / archival footage)',
        'Keep it 80–150 words. Motion and time must be visible in the text; a still-life description is a failed video prompt.',
        'In params, set aspect_ratio and a realistic suggested_duration_seconds (4–10).',
      ].join('\n')
    : [
        'This is an IMAGE prompt. Cover, in this order, in flowing prose:',
        '- subject with defining details (age, material, clothing, expression)',
        '- setting, time of day, weather',
        '- composition and camera (shot size, angle, lens, depth of field)',
        '- lighting (direction, quality, colour temperature)',
        '- colour palette and mood',
        '- medium and finish (photograph / oil painting / 3D render, grain, resolution cues)',
        'Keep it 60–120 words, comma-separated phrases are fine, no sentences addressed to the reader.',
        'In params, set aspect_ratio only.',
      ].join('\n')
}

function userMessage(input) {
  const lines = [
    `用户描述（原话，可能是中文、口语、不完整）："""${input.description}"""`,
    `产物类型：${KIND_LABEL[input.kind] || '图片'}`,
    `需要 ${input.count} 个方案。`,
  ]
  if (input.aspectRatio) lines.push(`用户指定画幅：${input.aspectRatio}`)
  if (input.kind === 'video' && input.duration) lines.push(`用户期望时长：${input.duration} 秒`)
  if (input.style) lines.push(`用户指定的风格：${input.style}`)
  lines.push('', shapeHint(input.kind), '', '只输出 JSON。')
  return lines.join('\n')
}

/** Pull the first JSON object out of a model reply that may be wrapped in prose or fences. */
export function extractJson(text) {
  if (!text) return null
  let body = String(text).trim()
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) body = fence[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

function coercePrompts(parsed, fallbackText, input) {
  const raw = Array.isArray(parsed?.prompts) ? parsed.prompts : Array.isArray(parsed) ? parsed : []
  const prompts = raw
    .map((item, index) => {
      const prompt = typeof item === 'string' ? item : item?.prompt
      if (typeof prompt !== 'string' || !prompt.trim()) return null
      return {
        title: String(item?.title || `方案 ${index + 1}`).slice(0, 40),
        prompt: prompt.trim(),
        negativePrompt: String(item?.negative_prompt || item?.negativePrompt || '').trim(),
        aspectRatio: String(item?.params?.aspect_ratio || input.aspectRatio || '').trim(),
        duration: Number(item?.params?.suggested_duration_seconds || input.duration || 0) || null,
        notes: String(item?.notes || '').trim(),
      }
    })
    .filter(Boolean)

  if (prompts.length) return prompts.slice(0, input.count)

  // The model ignored the JSON contract. Its prose is still a usable prompt —
  // better to keep the user moving than to fail the whole call.
  const fallback = String(fallbackText || '').trim()
  if (!fallback) return []
  return [
    {
      title: '直接方案',
      prompt: fallback.slice(0, 2000),
      negativePrompt: '',
      aspectRatio: input.aspectRatio || '',
      duration: input.duration,
      notes: '模型没有按 JSON 返回，已把原始回复直接作为提示词使用。',
    },
  ]
}

/**
 * Ask the configured chat model for prompts.
 * @param {object} cfg resolved plugin config
 * @param {{description:string, kind:'image'|'video', count:number, style?:string, aspectRatio?:string, duration?:number}} input
 * @param {AbortSignal} [signal]
 * @returns {Promise<{prompts:Array<object>, model:string, elapsedMs:number}>}
 */
export async function buildPrompts(cfg, input, signal) {
  const url = joinUrl(cfg.promptBaseUrl, 'chat/completions')
  const headers = { 'content-type': 'application/json' }
  if (cfg.promptApiKey) headers.authorization = `Bearer ${cfg.promptApiKey}`

  const body = {
    model: cfg.promptModel,
    messages: [
      { role: 'system', content: systemPrompt(cfg) },
      { role: 'user', content: userMessage(input) },
    ],
    temperature: cfg.promptTemperature,
    max_tokens: 1600,
    stream: false,
  }

  const started = Date.now()
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combineSignals(signal, 120000),
    })
  } catch (error) {
    throw new Error(describeNetworkFailure(error, '提示词模型', url))
  }

  if (!response.ok) throw new Error(await describeHttpFailure(response, '提示词模型', url))

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`提示词模型返回的不是 JSON（${url}）。这个地址可能指向网页而不是 API，请核对 baseUrl。`)
  }

  const content = payload?.choices?.[0]?.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('\n')
        : ''

  if (!text.trim()) {
    const reason = payload?.choices?.[0]?.finish_reason
    throw new Error(
      `提示词模型返回了空内容${reason ? `（finish_reason=${reason}）` : ''}。若模型开启了思考模式，请换用非思考模型或调大输出长度。`
    )
  }

  const prompts = coercePrompts(extractJson(text), text, input)
  if (!prompts.length) throw new Error('提示词模型没有产出可用提示词，请把描述写得更具体一些后重试。')

  return { prompts, model: cfg.promptModel, elapsedMs: Date.now() - started }
}

/** Merge a caller signal with a hard timeout, keeping whichever fires first. */
export function combineSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  return timeout
}

/** Whether an endpoint is on this machine (where an empty API key is normal). */
export function isLocalEndpoint(url) {
  try {
    const host = new URL(url).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host === '::1'
  } catch {
    return false
  }
}

const IMAGE_VARIANTS = [
  'wide establishing composition, 35mm lens, natural window light',
  'close three-quarter framing, 85mm lens, soft rim light, shallow depth of field',
  'low-angle hero framing, backlit haze, high dynamic range',
  'overhead flat-lay composition, diffuse studio light, clean negative space',
]

const VIDEO_VARIANTS = [
  'Slow dolly-in from a wide establishing shot to a medium shot. The subject begins still, then turns toward camera as light shifts across the frame.',
  'Static wide shot, then a gentle pan right following the subject as they move through the scene; ambient motion in the background keeps the frame alive.',
  'Handheld follow shot at chest height, subtle camera breathing, subject walks away from camera into deeper light.',
  'Low-angle tracking shot, foreground elements sweep past, ending on a slow tilt up to the sky.',
]

/**
 * Zero-dependency prompt scaffold used when no chat model is configured or the
 * configured one is unreachable. It cannot "understand" like an LLM does, but it
 * puts the user's own words into a structure that diffusion models respond to,
 * so a fresh install still produces something on the first run.
 * @param {{description:string, kind:'image'|'video', count:number, style?:string, aspectRatio?:string, duration?:number}} input
 */
export function fallbackPrompts(input) {
  const count = Math.max(1, Math.min(4, input.count || 1))
  const style = input.style || 'cinematic photography'
  const aspect = input.aspectRatio || (input.kind === 'video' ? '16:9' : '1:1')
  const core = String(input.description || '').trim()
  const variants = input.kind === 'video' ? VIDEO_VARIANTS : IMAGE_VARIANTS

  return Array.from({ length: count }, (_, index) => {
    const variant = variants[index % variants.length]
    const prompt =
      input.kind === 'video'
        ? `${core}. ${variant} Lighting is motivated and consistent through the shot. Colour grade: ${style}. Aspect ratio ${aspect}, ${input.duration || 5} seconds, no on-screen text or watermarks.`
        : `${core}, ${variant}, ${style}, precise subject detail, coherent perspective, clean background separation, high resolution`
    return {
      title: input.kind === 'video' ? `分镜 ${index + 1}` : `画面 ${index + 1}`,
      prompt,
      negativePrompt: 'blurry, low resolution, distorted anatomy, extra limbs, watermark, text artifacts, oversaturated',
      aspectRatio: aspect,
      // Undefined would break the tool's lossless-JSON contract, so only video
      // entries carry a duration at all.
      ...(input.kind === 'video' ? { duration: input.duration || 5 } : {}),
      notes: '由内置模板组装：未配置提示词模型，或模型暂时不可用。配置后可获得更贴合语义的写法。',
    }
  })
}

