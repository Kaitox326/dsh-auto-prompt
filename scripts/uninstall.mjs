#!/usr/bin/env node
/**
 * Remove dsh-auto-prompt from a DSH profile: the copied plugin, the
 * node_modules link, the package.json dependency + bundle entry, and any
 * `dsh-auto-prompt` rows left in cordis.patch.yml. Nothing else is touched.
 *
 *   node scripts/uninstall.mjs [--profile=desktop] [--keep-files]
 */
import { lstat, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const profile = flag('profile', 'desktop')
const keepFiles = args.includes('--keep-files')
const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profile)

const NAME = 'dsh-auto-prompt'
const target = path.join(profileDir, 'plugins', NAME)
const linkPath = path.join(profileDir, 'node_modules', NAME)
const patchPath = path.join(profileDir, 'cordis.patch.yml')
const manifestPath = path.join(profileDir, 'package.json')
const BEGIN = '# >>> dsh-auto-prompt (managed by scripts/install.mjs) >>>'
const END = '# <<< dsh-auto-prompt <<<'

/**
 * Drop top-level `- id: dsh-auto-prompt` entries (with their nested config).
 *
 * Harness 0.2.x stores a settings edit as an override entry next to the base
 * insert, so removing only the managed block would leave an override pointing
 * at a plugin that no longer exists — and the profile would fail to boot.
 */
function stripOverrideEntries(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let skipping = false
  for (const line of lines) {
    if (/^- id:\s*['"]?dsh-auto-prompt['"]?\s*$/.test(line)) {
      skipping = true
      continue
    }
    if (skipping) {
      if (!line.trim() || /^\s+\S/.test(line)) continue
      skipping = false
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * A patch file must parse to a top-level array. Once our block is gone a
 * comment-only document parses as null and the profile refuses to boot, so put
 * the empty list back (keeping the comment header).
 */
function ensureList(text) {
  const hasEntry = text
    .split(/\r?\n/)
    .some((line) => line.trim() && !line.trim().startsWith('#'))
  if (hasEntry) return text
  return `${text.trimEnd()}\n[]\n`
}

async function dropManifestEntry() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    let changed = false
    if (manifest?.dependencies?.[NAME] !== undefined) {
      delete manifest.dependencies[NAME]
      changed = true
    }
    const bundles = manifest?.dsh?.profile?.bundles
    if (Array.isArray(bundles)) {
      const at = bundles.indexOf(NAME)
      if (at !== -1) {
        bundles.splice(at, 1)
        changed = true
      }
    }
    if (changed) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    console.log(changed ? '已从 profile package.json 摘掉依赖与 bundle。' : 'profile package.json 里没有登记项。')
  } catch {
    console.log('没有读到 profile package.json，跳过清单清理。')
  }
}

async function main() {
  try {
    const patch = await readFile(patchPath, 'utf8')
    let text = patch
    const start = text.indexOf(BEGIN)
    const end = text.indexOf(END)
    if (start !== -1 && end !== -1) text = text.slice(0, start) + text.slice(end + END.length)
    const cleaned = ensureList(stripOverrideEntries(text).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n')
    if (cleaned !== patch) {
      await writeFile(patchPath, cleaned, 'utf8')
      console.log('已从 cordis.patch.yml 移除插件条目（含保存过的配置覆盖）。')
    } else {
      console.log('cordis.patch.yml 里没有本插件的条目。')
    }
  } catch {
    console.log('没有找到 cordis.patch.yml，跳过配置清理。')
  }

  await dropManifestEntry()

  try {
    const info = await lstat(linkPath)
    if (info.isDirectory() && !info.isSymbolicLink()) await rm(linkPath, { recursive: true, force: true })
    else await unlink(linkPath)
    console.log(`已移除包入口 ${linkPath}`)
  } catch {
    console.log('node_modules 里没有本插件的入口。')
  }

  if (!keepFiles) {
    await rm(target, { recursive: true, force: true })
    console.log(`已删除 ${target}`)
  } else {
    console.log(`保留了插件文件：${target}`)
  }
  console.log('重启 DSH 后生效。生成的图片/视频不会被删除。')
}

main().catch((error) => {
  console.error('卸载失败：', error?.message || error)
  process.exitCode = 1
})
