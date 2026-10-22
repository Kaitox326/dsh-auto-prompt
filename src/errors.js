/**
 * Error translation: every failure a user can realistically hit is rewritten as
 * one sentence of cause plus one sentence of next step. A raw `fetch failed`
 * tells nobody anything.
 *
 * @module dsh-auto-prompt/errors
 */

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Read a provider error body into one short line, whatever shape it uses. */
export async function readErrorBody(response) {
  let body = ''
  try {
    body = await response.text()
  } catch {
    return ''
  }
  const trimmed = body.trim()
  if (!trimmed) return ''
  try {
    const json = JSON.parse(trimmed)
    const message =
      json?.error?.message || json?.error?.msg || json?.message || json?.msg || json?.detail || json?.error
    if (typeof message === 'string' && message.trim()) return message.trim()
    if (Array.isArray(json?.errors) && json.errors[0]?.message) return String(json.errors[0].message)
  } catch {
    /* not JSON — fall through to the raw slice */
  }
  return trimmed.slice(0, 300)
}

/**
 * Turn one failed HTTP response into an actionable Chinese sentence.
 * @param {Response} response
 * @param {string} label - 人类可读的服务名，如「提示词模型」「图片服务」
 * @param {string} url
 */
export async function describeHttpFailure(response, label, url) {
  const detail = await readErrorBody(response)
  const host = hostOf(url)
  const tail = detail ? `服务端返回：${detail}` : '服务端没有返回内容。'
  switch (response.status) {
    case 401:
    case 403:
      return `${label}拒绝了这次请求（HTTP ${response.status}）：密钥无效、过期或没有该模型权限。请到插件配置里核对 API Key；本地服务则确认没有误填密钥。${tail}`
    case 404:
      return `${label}地址不对（HTTP 404）：${url} 上没有这个接口。请检查基础地址是否缺少 /v1 之类的版本前缀，或模型名是否写错。${tail}`
    case 400:
      return `${label}认为请求参数不合法（HTTP 400）：常见原因是模型名不存在、尺寸/时长不被支持。${tail}`
    case 402:
      return `${label}余额不足（HTTP 402）：请充值或换一个服务商。${tail}`
    case 413:
      return `${label}请求体过大（HTTP 413）：提示词太长或参考图太大，请精简后重试。${tail}`
    case 422:
      return `${label}参数校验失败（HTTP 422）：${tail}`
    case 429:
      return `${label}限流了（HTTP 429）：请求太快或额度用尽，等几秒再试，或降低调用频率。${tail}`
    case 500:
    case 502:
    case 503:
    case 504:
      return `${label}服务端暂时不可用（HTTP ${response.status}）：这是对面平台的问题，稍后重试；若持续出现请换服务商。${tail}`
    default:
      return `${label}返回了意外状态 HTTP ${response.status}（${host}）。${tail}`
  }
}

/**
 * Translate a thrown network/timeout error.
 * @param {unknown} error
 * @param {string} label
 * @param {string} url
 */
export function describeNetworkFailure(error, label, url) {
  const host = hostOf(url)
  const local = LOCAL_HOST.test(host)
  const name = error?.name || ''
  const message = String(error?.message || error)

  if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timeout/i.test(message)) {
    return `${label}在超时时间内没有返回（${host}）。图片/视频生成偏慢，可调大插件配置里的超时时间；视频任务也可以先确认服务商侧任务是否已完成。`
  }
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|connect/i.test(message)) {
    return local
      ? `${label}连不上 ${host}：本机这个端口没有服务在监听。请先启动本地模型服务（Ollama 默认 11434、LM Studio 默认 1234），并确认地址端口一致。`
      : `${label}连不上 ${host}：请检查网络、代理，或该地址是否还需要走内网/VPN。原始信息：${message}`
  }
  if (/CERT|certificate|SSL|TLS/i.test(message)) {
    return `${label}的 HTTPS 证书校验失败（${host}）。自建服务请换用 https 正式证书，或在本机用 http 地址。`
  }
  if (/JSON/i.test(message)) {
    return `${label}返回的内容不是预期 JSON（${host}）：地址可能指向了一个网页而不是 API 接口。请确认填的是接口基地址。原始信息：${message}`
  }
  return `${label}调用失败（${host}）：${message}`
}
