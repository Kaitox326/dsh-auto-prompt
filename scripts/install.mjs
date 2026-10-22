#!/usr/bin/env node
/**
 * Local installer for dsh-auto-prompt.
 *
 * The plugin has two halves: a host half (`src/index.js`) that registers the
 * agent tools, and a browser half (`src/client.js`) that adds the settings
 * section. The browser half only exists for packages the client module system
 * can *identify as a package*, so this installer mounts the plugin the way the
 * in-app plugin manager would:
 *
 *   1. copy the plugin into <profile>/plugins/dsh-auto-prompt;
 *   2. link it at <profile>/node_modules/dsh-auto-prompt so a bare specifier
 *      resolves (a `file:///...` entry would load, but the plugin list could
 *      then only show the raw path — no title, no description, no icon, and no
 *      `dsh.client` discovery for the settings page);
 *   3. declare it in the profile package.json — dependency + bundle — so the
 *      bundle layer inserts the Loader row;
 *   4. strip the old hand-written insert row from cordis.patch.yml, keeping any
 *      saved `config:` override (that is where the settings UI stores values).
 *
 * Idempotent: re-running upgrades the files without duplicating the row.
 *
 *   node scripts/install.mjs                 # profile "desktop"
 *   node scripts/install.mjs --profile=web   # another profile
 *   node scripts/install.mjs --dry-run
 */
import { cp, mkdir, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const dryRun = args.includes('--dry-run')
const profile = flag('profile', 'desktop')
const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profile)

const NAME = 'dsh-auto-prompt'
const DEP_SPEC = `file:plugins/${NAME}`
const BEGIN = '# >>> dsh-auto-prompt (managed by scripts/install.mjs) >>>'
const END = '# <<< dsh-auto-prompt <<<'

const target = path.join(profileDir, 'plugins', NAME)
const linkPath = path.join(profileDir, 'node_modules', NAME)
const patchPath = path.join(profileDir, 'cordis.patch.yml')
const manifestPath = path.join(profileDir, 'package.json')

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/* --------------------------------------------------------------- patch 层 */

/**
 * Remove the legacy managed insert block and point every remaining
 * `dsh-auto-prompt` row at the bare package specifier, keeping its `config:`
 * payload (the settings UI writes user values as an override row).
 * @param {string} text current cordis.patch.yml
 * @returns {{ text: string, removedBlock: boolean, retargeted: number }}
 */
function fixPatch(text) {
  const lines = text.split(/\r?\n/)
  const kept = []
  let removedBlock = false
  let inBlock = false
  for (const line of lines) {
    if (line.trim() === BEGIN) {
      inBlock = true
      removedBlock = true
      continue
    }
    if (inBlock) {
      if (line.trim() === END) inBlock = false
      continue
    }
    kept.push(line)
  }

  let retargeted = 0
  let ownerIndent = -1
  const out = kept.map((line) => {
    const idMatch = line.match(/^(\s*)- id:\s*['"]?dsh-auto-prompt['"]?\s*$/)
    if (idMatch) {
      ownerIndent = idMatch[1].length
      return line
    }
    if (ownerIndent >= 0) {
      if (!line.trim()) return line
      const indent = line.match(/^\s*/)[0].length
      if (indent <= ownerIndent) {
        ownerIndent = -1
        return line
      }
      const nameMatch = line.match(/^(\s*)name:\s*(.*)$/)
      if (nameMatch) {
        ownerIndent = -1
        if (/^[>|]/.test(nameMatch[2].trim())) return line
        const value = nameMatch[2].trim().replace(/^['"]|['"]$/g, '')
        if (value === NAME) return line
        retargeted += 1
        return `${nameMatch[1]}name: ${NAME}`
      }
    }
    return line
  })

  let next = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  // A patch file that only held our block collapses to comments; YAML then
  // parses as null and the Loader refuses to boot. Restore an empty list.
  const hasContent = next.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith('#'))
  if (!hasContent) {
    const header = next.trim()
    next = `${header ? `${header}\n\n` : ''}[]`
  }
  return { text: next.endsWith('\n') ? next : `${next}\n`, removedBlock, retargeted }
}

/* ----------------------------------------------------------- package.json */

/**
 * Declare the plugin as a profile dependency and bundle. Both halves matter:
 * the dependency makes the bare specifier resolvable (and makes the plugin
 * show up as an installed plugin), the bundle applies our cordis.patch.yml so
 * the Loader gets its row.
 */
async function mountInManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  let changed = false

  if (!manifest.dependencies || typeof manifest.dependencies !== 'object') {
    manifest.dependencies = {}
    changed = true
  }
  if (manifest.dependencies[NAME] !== DEP_SPEC) {
    manifest.dependencies[NAME] = DEP_SPEC
    changed = true
  }

  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  if (!bundles.includes(NAME)) {
    bundles.push(NAME)
    changed = true
  }
  manifest.dsh.profile.bundles = bundles

  if (changed) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return changed
}

/* ------------------------------------------------------------- node_modules */

/**
 * Link the installed copy where Node resolves bare specifiers.
 *
 * A junction on Windows keeps the install free of admin rights and of pnpm's
 * store, and it stays live: editing the source checkout and re-running the
 * installer is enough to pick up changes.
 */
async function linkPackage() {
  await mkdir(path.dirname(linkPath), { recursive: true })
  try {
    const current = await stat(linkPath)
    if (current.isSymbolicLink()) await unlink(linkPath)
    else if (current.isDirectory()) await rm(linkPath, { recursive: true, force: true })
    else await unlink(linkPath)
  } catch {
    /* nothing there yet */
  }
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

/* -------------------------------------------------------------------- main */

async function main() {
  if (!(await exists(profileDir))) {
    console.error(`找不到 profile 目录：${profileDir}`)
    console.error('用 --profile=<名字> 指定，或确认 DSH 已至少启动过一次。')
    const profilesRoot = path.join(dshHome, 'profiles')
    if (await exists(profilesRoot)) {
      console.error('已存在的 profile：', (await readdir(profilesRoot)).join(', '))
    }
    process.exitCode = 1
    return
  }

  console.log(`目标 profile：${profileDir}`)
  console.log(`插件安装到：${target}`)
  console.log(`包入口软链：${linkPath}`)
  console.log(`配置入口：${patchPath}`)

  if (dryRun) {
    console.log('\n[dry-run] 只会执行以下动作，不落盘。')
    console.log(` 1. 复制插件 → ${target}`)
    console.log(` 2. 建立软链 → ${linkPath}`)
    console.log(` 3. package.json：dependencies["${NAME}"] = "${DEP_SPEC}"，bundles 追加 "${NAME}"`)
    console.log(' 4. cordis.patch.yml：删除旧的 insert 块，并把同名条目的 name 改回裸包名')
    return
  }

  await mkdir(path.join(profileDir, 'plugins'), { recursive: true })
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(path.join(root, 'src'), path.join(target, 'src'), { recursive: true })
  // Ship the maintenance scripts too, so the installed copy can uninstall
  // itself after the source checkout is gone.
  await cp(path.join(root, 'scripts'), path.join(target, 'scripts'), { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml', 'README.md', 'locale', 'assets']) {
    const from = path.join(root, entry)
    if (await exists(from)) await cp(from, path.join(target, entry), { recursive: true })
  }
  console.log('\n已复制插件文件。')

  await linkPackage()
  console.log(`已挂载包入口：${NAME} → plugins/${NAME}`)

  const manifestChanged = await mountInManifest()
  console.log(manifestChanged ? '已在 profile package.json 中登记依赖与 bundle。' : 'profile package.json 已登记，未改动。')

  let patch = ''
  if (await exists(patchPath)) patch = await readFile(patchPath, 'utf8')
  const fixed = fixPatch(patch)
  if (fixed.removedBlock || fixed.retargeted) {
    await writeFile(patchPath, fixed.text, 'utf8')
    if (fixed.removedBlock) console.log('已移除 cordis.patch.yml 里旧的 insert 行（改由包的 bundle 插入）。')
    if (fixed.retargeted) console.log(`已把 ${fixed.retargeted} 个配置覆盖条目的 name 改回包名。`)
  }

  console.log('\n下一步：')
  console.log('  1. 完全退出并重新启动 DSH（桌面版要关掉托盘/后台进程，再从开始菜单打开）。')
  console.log('  2. 左下角「个人 → 设置」，左侧导航里会出现「自动提示词」；插件列表里也会显示这个名字和简介。')
  console.log('  3. 直接对话：「画一张雨夜霓虹街头的猫」即可。')
  console.log('\n想先不配置就跑通：什么字段都不填，默认会走演示模式，产出占位图 + 真实可用的提示词。')
}

main().catch(async (error) => {
  console.error('安装失败：', error?.message || error)
  process.exitCode = 1
})
