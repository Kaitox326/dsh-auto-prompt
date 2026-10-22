/**
 * Step two: actually render the prompt.
 *
 * Image: OpenAI-compatible `POST /images/generations` (works with the official
 * API, most Chinese aggregators, and local servers such as sd.cpp / ComfyUI's
 * OpenAI bridge / vLLM-omni).
 *
 * Video: there is no single standard yet, so this module speaks "submit a task,
 * poll until done" and lets the user describe their provider's wire shape with
 * four JSON paths in the plugin settings. Nothing is hardcoded to one vendor.
 *
 * @module dsh-auto-prompt/providers
 */
import { describeHttpFailure, describeNetworkFailure } from './errors.js'
import { combineSignals, joinUrl } from './prompt.js'

/** Read a dotted path (`data.items.0.url`) out of a JSON object. */
export function getPath(value, dotted) {
  if (!dotted) return undefined
  const segments = String(dotted).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cursor = value
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

function firstPath(value, paths) {
  for (const candidate of paths) {
    const hit = getPath(value, candidate)
    if (hit !== undefined && hit !== null && hit !== '') return hit
  }
  return undefined
}

/** Absolute or data-URI image source → bytes. */
export async function readImageSource(source, signal, label = '图片服务') {
  const text = String(source)
  if (text.startsWith('data:')) {
    const comma = text.indexOf(',')
    const meta = text.slice(5, comma)
    const payload = text.slice(comma + 1)
    const mediaType = meta.split(';')[0] || 'image/png'
    const data = meta.includes('base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
    return { data, mediaType }
  }
  if (!/^https?:\/\//i.test(text)) {
    // `b64_json` in the OpenAI schema is BARE base64, not a data URI — most
    // providers return that shape, so decode it before giving up.
    if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 64) {
      const buffer = Buffer.from(text.replace(/\s+/g, ''), 'base64')
      const mediaType = sniffMediaType(buffer)
      if (buffer.length > 0) return { data: buffer, mediaType }
    }
    throw new Error(`${label}返回了一个无法识别的图片字段（既不是 http 地址、data URI，也不是 base64 图片数据）：${text.slice(0, 120)}`)
  }
  let response
  try {
    response = await fetch(text, { signal: combineSignals(signal, 120000) })
  } catch (error) {
    throw new Error(describeNetworkFailure(error, `${label}（下载产物）`, text))
  }
  if (!response.ok) throw new Error(await describeHttpFailure(response, `${label}（下载产物）`, text))
  const buffer = Buffer.from(await response.arrayBuffer())
  return { data: buffer, mediaType: sniffMediaType(buffer, text) }
}

/** Detect a raster media type from magic bytes, falling back to the URL extension. */
export function sniffMediaType(buffer, url = '') {
  const b = buffer
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp'
  const ext = String(url).split('?')[0].toLowerCase()
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg'
  if (ext.endsWith('.webp')) return 'image/webp'
  if (ext.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

/**
 * Render one image prompt.
 * @param {object} cfg
 * @param {{prompt:string, size?:string}} input
 * @param {AbortSignal} [signal]
 * @returns {Promise<{data:Buffer, mediaType:string, revisedPrompt?:string}>}
 */
export async function generateImage(cfg, input, signal) {
  const url = joinUrl(cfg.imageBaseUrl, 'images/generations')
  const { extra } = input
  const body = {
    model: cfg.imageModel,
    prompt: input.prompt,
    n: 1,
    size: input.size || cfg.imageSize,
    ...extra,
  }
  const headers = { 'content-type': 'application/json' }
  if (cfg.imageApiKey) headers.authorization = `Bearer ${cfg.imageApiKey}`

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combineSignals(signal, 300000),
    })
  } catch (error) {
    throw new Error(describeNetworkFailure(error, '图片服务', url))
  }
  if (!response.ok) throw new Error(await describeHttpFailure(response, '图片服务', url))

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`图片服务返回的不是 JSON（${url}）。请确认填的是接口基地址，而不是网页地址。`)
  }

  const source = firstPath(payload, [
    'data.0.b64_json',
    'data.0.url',
    'data.0.image_url',
    'data.0',
    'images.0.b64_json',
    'images.0.url',
    'images.0',
    'output.0.url',
    'output.0',
    'image',
    'image_url',
    'b64_json',
    'url',
  ])

  if (!source || typeof source !== 'string') {
    const preview = JSON.stringify(payload).slice(0, 260)
    throw new Error(
      `图片服务返回成功，但没有找到图片字段。请检查该服务的返回结构（常见为 data[0].b64_json 或 data[0].url）。原始返回：${preview}`
    )
  }

  const { data, mediaType } = await readImageSource(source, signal)
  return { data, mediaType, revisedPrompt: firstPath(payload, ['data.0.revised_prompt']) }
}

/** Fill `{prompt}`-style placeholders inside a JSON template, keeping the JSON valid. */
export function renderTemplate(template, vars) {
  let output = String(template)
  const escape = (value) => JSON.stringify(String(value)).slice(1, -1)
  // Quoted numerics first: `"{duration}"` becomes a real number, which is what
  // most video APIs demand.
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'number') output = output.split(`"{${key}}"`).join(String(value))
  }
  for (const [key, value] of Object.entries(vars)) {
    output = output.split(`{${key}}`).join(escape(value))
  }
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(
      `视频请求模板不是合法 JSON：${error.message}。请检查插件配置里的「视频请求模板」是否少了引号或逗号。`
    )
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已取消'))
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('已取消'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })

/**
 * Submit a video task and poll it to completion.
 * @param {object} cfg
 * @param {{prompt:string, aspectRatio?:string, duration?:number}} input
 * @param {AbortSignal} [signal]
 * @param {(info:{status:string, progress?:number, attempt:number}) => void} [onProgress]
 * @returns {Promise<{source:string, taskId:string, status:string, elapsedMs:number}>}
 */
export async function generateVideo(cfg, input, signal, onProgress) {
  const submitUrl = cfg.videoSubmitUrl || joinUrl(cfg.videoBaseUrl, 'videos')
  const pollTemplate = cfg.videoPollUrl || joinUrl(cfg.videoBaseUrl, 'videos/{id}')
  const body = renderTemplate(cfg.videoRequestBody, {
    prompt: input.prompt,
    model: cfg.videoModel,
    duration: input.duration || 5,
    aspect_ratio: input.aspectRatio || '16:9',
  })
  const headers = { 'content-type': 'application/json' }
  if (cfg.videoApiKey) headers.authorization = `Bearer ${cfg.videoApiKey}`

  const started = Date.now()
  let response
  try {
    response = await fetch(submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combineSignals(signal, 120000),
    })
  } catch (error) {
    throw new Error(describeNetworkFailure(error, '视频服务（提交任务）', submitUrl))
  }
  if (!response.ok) throw new Error(await describeHttpFailure(response, '视频服务（提交任务）', submitUrl))

  let submitPayload
  try {
    submitPayload = await response.json()
  } catch {
    throw new Error(`视频服务提交后返回的不是 JSON（${submitUrl}）。`)
  }

  const taskId = firstPath(submitPayload, [
    cfg.videoIdPath,
    'id',
    'task_id',
    'data.id',
    'data.task_id',
    'task.id',
    'request_id',
  ])
  if (!taskId) {
    throw new Error(
      `视频任务提交成功，但没找到任务 ID。请把插件配置里的「任务 ID 字段路径」改成服务商实际返回的位置（如 data.task_id）。原始返回：${JSON.stringify(submitPayload).slice(0, 240)}`
    )
  }

  const pollUrl = String(pollTemplate).split('{id}').join(encodeURIComponent(String(taskId)))
  const doneStates = cfg.videoDoneStates.split(',').map((s) => s.trim()).filter(Boolean)
  const failStates = cfg.videoFailStates.split(',').map((s) => s.trim()).filter(Boolean)
  const interval = cfg.videoPollIntervalMs
  const deadline = started + cfg.videoTimeoutMs
  let attempt = 0

  while (Date.now() < deadline) {
    await sleep(interval, signal)
    attempt += 1

    let pollResponse
    try {
      pollResponse = await fetch(pollUrl, {
        headers: cfg.videoApiKey ? { authorization: `Bearer ${cfg.videoApiKey}` } : {},
        signal: combineSignals(signal, 60000),
      })
    } catch (error) {
      // A transient poll failure is not worth abandoning a task that is already
      // running server-side; keep trying until the deadline.
      onProgress?.({ status: 'poll-retry', attempt })
      continue
    }
    if (!pollResponse.ok) {
      if (pollResponse.status === 401 || pollResponse.status === 403) {
        throw new Error(await describeHttpFailure(pollResponse, '视频服务（查询任务）', pollUrl))
      }
      onProgress?.({ status: `poll-http-${pollResponse.status}`, attempt })
      continue
    }

    let poll
    try {
      poll = await pollResponse.json()
    } catch {
      continue
    }

    const status = String(firstPath(poll, [cfg.videoStatusPath, 'status', 'data.status', 'data.task_status']) ?? '')
    const progressRaw = firstPath(poll, ['progress', 'data.progress', 'data.percent', 'percent'])
    const progress = typeof progressRaw === 'number' ? progressRaw : undefined
    onProgress?.({ status: status || 'unknown', progress, attempt })

    if (failStates.some((state) => state.toLowerCase() === status.toLowerCase())) {
      const reason = firstPath(poll, ['error.message', 'error', 'message', 'data.error', 'data.message', 'fail_reason'])
      throw new Error(`视频任务失败（状态 ${status}）${reason ? `：${typeof reason === 'string' ? reason : JSON.stringify(reason).slice(0, 200)}` : ''}。任务 ID：${taskId}`)
    }

    if (doneStates.some((state) => state.toLowerCase() === status.toLowerCase())) {
      const source = firstPath(poll, [
        cfg.videoResultPath,
        'video_url',
        'url',
        'data.url',
        'data.video_url',
        'output.0.url',
        'output.0',
        'data.output.0.url',
        'data.videos.0.url',
        'result.url',
        'data.result.url',
      ])
      if (!source || typeof source !== 'string') {
        throw new Error(
          `视频任务已完成，但没找到视频地址。请把插件配置里的「视频地址字段路径」改成服务商实际返回的位置（如 data.video_url）。原始返回：${JSON.stringify(poll).slice(0, 240)}`
        )
      }
      return { source, taskId: String(taskId), status, elapsedMs: Date.now() - started }
    }
  }

  throw new Error(
    `等待视频任务超时（已等 ${Math.round(cfg.videoTimeoutMs / 1000)} 秒）。任务可能仍在服务端生成，可到服务商控制台按任务 ID ${taskId} 查看，或调大插件配置里的「视频最长等待时间」。`
  )
}

/** Download a finished video (or any binary) into memory. */
export async function downloadBinary(url, signal, label = '视频服务') {
  let response
  try {
    response = await fetch(url, { signal: combineSignals(signal, 300000) })
  } catch (error) {
    throw new Error(describeNetworkFailure(error, `${label}（下载产物）`, url))
  }
  if (!response.ok) throw new Error(await describeHttpFailure(response, `${label}（下载产物）`, url))
  return Buffer.from(await response.arrayBuffer())
}
