/**
 * dsh-auto-prompt — browser half.
 *
 * This file is NOT a normal ESM module: it is a DSH client bundle. The web
 * client loads it through `window.__ModuleLoader__`, which only registers the
 * factory; the body runs when the module is first materialised. That is why it
 * is wrapped in the loader envelope and uses `require()` instead of `import`.
 *
 * What it contributes: one `settings.section`, so the plugin gets its own entry
 * in 设置 → 左侧导航, next to 通用 / 模型 / 内置插件. The page edits the same
 * fields the host half declares on its Config schema — endpoints, keys, model
 * names — through `ctx.configForms.get(entryId)`, so a change here and a change
 * in the plugin page are the same write to the same settings document.
 *
 * @module dsh-auto-prompt/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-auto-prompt',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    var NS = 'settings.autoPrompt'
    /** Loader entry id — also the settings namespace the host half registers. */
    var ENTRY_ID = 'dsh-auto-prompt'

    var zh = {
      nav: '自动提示词',
      title: '自动提示词',
      subtitle:
        '把随口一句话改写成能直接投喂给绘图/视频模型的提示词。地址、密钥、模型名都可以直接填在下面；打开生成开关后，它才会真的调用这些服务，关着的时候只产出提示词。',
      switchLabel: '生成开关',
      switchOn: '已打开 —— 会真的调用后端出图/出片',
      switchOff: '已关闭 —— 只产出提示词，不调用图片/视频服务',
      switchHint: '这是花钱、占显存的那一步。只想先看提示词就保持关闭；配置齐全后再打开。',
      promptCard: '提示词模型',
      promptCardHint: '「理解你的话 → 写提示词」这一步用的大模型。OpenAI 兼容 /chat/completions。',
      imageCard: '图片服务',
      imageCardHint: 'OpenAI 兼容 /images/generations。不填也能出提示词，只是生图时给一张演示占位图。',
      videoCard: '视频服务',
      videoCardHint: '异步任务式接口：提交拿任务号，再轮询取结果。不填则只产出分镜脚本。',
      outputCard: '产物保存',
      promptBaseLabel: '模型地址',
      promptBaseHint:
        '填到版本前缀为止。例：https://api.deepseek.com/v1、http://127.0.0.1:11434/v1（Ollama）、http://127.0.0.1:1234/v1（LM Studio）。',
      promptModelLabel: '模型名',
      promptModelHint: '云：deepseek-chat；本地：qwen2.5:14b、llama3.1:8b… 必须与本地服务里列出的名字一致。',
      promptKeyLabel: 'API 密钥',
      promptKeyHint: '本地服务通常留空即可；留空时不发送 Authorization 头。',
      imageBaseLabel: 'API 链接',
      imageBaseHint: '例：https://api.openai.com/v1、http://127.0.0.1:8000/v1。',
      imageModelLabel: '模型名',
      imageModelHint: '例：gpt-image-1、flux-dev、sd3.5-large、qwen-image。',
      imageKeyLabel: 'API 密钥',
      imageKeyHint: '按服务商要求填写；本地服务可留空。',
      videoSubmitLabel: '提交地址',
      videoSubmitHint: '完整 URL。留空则自动用「基础地址 + /videos」。例：https://api.example.com/v1/video/generations。',
      videoBaseLabel: '基础地址',
      videoBaseHint: '只填到版本前缀，例如 https://api.example.com/v1。填了提交地址时本项可留空。',
      videoModelLabel: '模型名',
      videoModelHint: '例：cogvideox-3、kling-v2、veo-3。',
      videoKeyLabel: 'API 密钥',
      videoKeyHint: '视频服务的鉴权密钥。',
      presets: '常用',
      applyPreset: '填入',
      outputLabel: '输出目录',
      outputHint: '留空则存到 ~/.dsh/outputs/auto-prompt。支持 ~ 开头，例：~/Pictures/ai。',
      chooseFolder: '选择文件夹…',
      choosing: '请在弹出的窗口里选择文件夹…',
      chooseHint: '点「选择文件夹…」会打开系统自带的文件夹对话框，选完自动保存。',
      pickFailed: '打不开系统的文件夹选择窗口，可以改成填写路径。',
      manualToggle: '修改路径',
      pathPlaceholder: '默认目录（~/.dsh/outputs/auto-prompt）',
      resetDefault: '恢复默认',
      keyPlaceholder: '留空表示不改动',
      clearKey: '清除',
      configured: '已配置',
      notConfigured: '未配置',
      autoSave: '离开输入框或按回车即保存，不需要点确认。',
      saved: '已保存',
      dirty: '未保存',
      advanced: '更细的项（图片尺寸、视频轮询、JSON 模板…）在「插件 → dsh-auto-prompt → 配置」里，也可以直接在对话里说：替我把自动提示词配好。',
      unavailable: '插件还没加载完，稍后再打开这个页面。',
      readOnly: '本部署的设置是只读的，需要在 profile 的 cordis.patch.yml 里改。',
      saving: '保存中…',
      saveFailed: '没有保存成功，请再试一次。',
    }

    var en = {
      nav: 'Auto prompt',
      title: 'Auto prompt',
      subtitle:
        'Turns a plain sentence into a prompt your image or video model can use. Endpoints, keys and model names are edited right below; only with the generation switch on does it actually call them.',
      switchLabel: 'Generation switch',
      switchOn: 'On — the backend is called and you get real media',
      switchOff: 'Off — prompts only, no image or video service is called',
      switchHint: 'This is the step that costs money or VRAM. Keep it off while you only want prompts.',
      promptCard: 'Prompt model',
      promptCardHint: 'The model that rewrites your sentence into a prompt. OpenAI-compatible /chat/completions.',
      imageCard: 'Image service',
      imageCardHint: 'OpenAI-compatible /images/generations. Optional — without it you still get prompts.',
      videoCard: 'Video service',
      videoCardHint: 'Async task API: submit, poll, download. Optional — without it you get a storyboard only.',
      outputCard: 'Output',
      promptBaseLabel: 'Model endpoint',
      promptBaseHint:
        'Include the version prefix. e.g. https://api.deepseek.com/v1, http://127.0.0.1:11434/v1 (Ollama), http://127.0.0.1:1234/v1 (LM Studio).',
      promptModelLabel: 'Model name',
      promptModelHint: 'Cloud: deepseek-chat. Local: qwen2.5:14b, llama3.1:8b — must match the name the server lists.',
      promptKeyLabel: 'API key',
      promptKeyHint: 'Usually empty for local servers; an empty key sends no Authorization header.',
      imageBaseLabel: 'API base URL',
      imageBaseHint: 'e.g. https://api.openai.com/v1, http://127.0.0.1:8000/v1.',
      imageModelLabel: 'Model name',
      imageModelHint: 'e.g. gpt-image-1, flux-dev, sd3.5-large, qwen-image.',
      imageKeyLabel: 'API key',
      imageKeyHint: 'As required by the provider; may be empty for local servers.',
      videoSubmitLabel: 'Submit URL',
      videoSubmitHint: 'Full URL. Empty means base URL + /videos, e.g. https://api.example.com/v1/video/generations.',
      videoBaseLabel: 'Base URL',
      videoBaseHint: 'Version prefix only, e.g. https://api.example.com/v1. Can stay empty when the submit URL is set.',
      videoModelLabel: 'Model name',
      videoModelHint: 'e.g. cogvideox-3, kling-v2, veo-3.',
      videoKeyLabel: 'API key',
      videoKeyHint: 'Credential for the video service.',
      presets: 'Presets',
      applyPreset: 'Use',
      outputLabel: 'Output folder',
      outputHint: 'Empty means ~/.dsh/outputs/auto-prompt. A leading ~ is expanded, e.g. ~/Pictures/ai.',
      chooseFolder: 'Choose folder…',
      choosing: 'Pick a folder in the dialog that just opened…',
      chooseHint: 'The button opens your system folder dialog; the choice is saved right away.',
      pickFailed: 'The system folder dialog could not be opened — type a path instead.',
      manualToggle: 'Edit path',
      pathPlaceholder: 'Default (~/.dsh/outputs/auto-prompt)',
      resetDefault: 'Use default',
      keyPlaceholder: 'Leave empty to keep it',
      clearKey: 'Clear',
      configured: 'Configured',
      notConfigured: 'Not configured',
      autoSave: 'Press Enter or leave the field to save — no confirm button.',
      saved: 'Saved',
      dirty: 'Unsaved',
      advanced: 'Finer options (image size, polling, JSON templates) live in 插件 → dsh-auto-prompt → 配置, or ask the agent to configure auto prompt.',
      unavailable: 'The plugin has not finished loading. Reopen this page in a moment.',
      readOnly: 'Settings are read-only in this deployment; edit the profile cordis.patch.yml instead.',
      saving: 'Saving…',
      saveFailed: 'That change was not saved. Please try again.',
    }

    /** Endpoint presets: two clicks instead of typing an URL. */
    var PRESETS = [
      { label: 'DeepSeek', value: 'https://api.deepseek.com/v1' },
      { label: 'Ollama', value: 'http://127.0.0.1:11434/v1' },
      { label: 'LM Studio', value: 'http://127.0.0.1:1234/v1' },
    ]

    /* ------------------------------------------------------------------ 样式 */

    var color = {
      primary: 'var(--dsw-alias-label-primary, inherit)',
      secondary: 'var(--dsw-alias-label-secondary, inherit)',
      tertiary: 'var(--dsw-alias-label-tertiary, inherit)',
      border: 'var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25))',
      card: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.06))',
      brand: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe)',
      success: 'var(--dsw-alias-state-success-primary, #17b26a)',
      danger: 'var(--dsw-alias-state-error-primary, #f04438)',
    }

    var styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        maxWidth: '680px',
        fontSize: '13px',
        lineHeight: 1.6,
        color: color.secondary,
      },
      title: {
        margin: 0,
        fontSize: '18px',
        fontWeight: 600,
        lineHeight: 1.4,
        color: color.primary,
      },
      lede: {
        margin: '6px 0 0',
        fontSize: '13px',
        color: color.tertiary,
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '14px 16px',
        border: '1px solid ' + color.border,
        borderRadius: 'var(--dsw-radius-md, 12px)',
        background: color.card,
      },
      cardHead: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '12px',
      },
      cardTitle: {
        margin: 0,
        fontSize: '13px',
        fontWeight: 600,
        color: color.primary,
      },
      cardHint: {
        margin: '3px 0 0',
        fontSize: '12px',
        color: color.tertiary,
      },
      badge: {
        flex: 'none',
        fontSize: '11px',
        padding: '1px 8px',
        borderRadius: '999px',
        border: '1px solid ' + color.border,
        color: color.tertiary,
      },
      badgeOn: {
        color: color.success,
        borderColor: 'currentColor',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      },
      rowMain: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
      },
      field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      },
      fieldHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
      },
      label: {
        fontSize: '13px',
        color: color.primary,
      },
      note: {
        flex: 'none',
        fontSize: '11px',
        color: color.tertiary,
      },
      noteError: {
        flex: 'none',
        fontSize: '11px',
        color: color.danger,
      },
      noteOk: {
        flex: 'none',
        fontSize: '11px',
        color: color.success,
      },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        height: '30px',
        padding: '0 9px',
        fontSize: '12px',
        lineHeight: '28px',
        color: color.primary,
        background: 'transparent',
        border: '1px solid ' + color.border,
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        outline: 'none',
        fontFamily: 'inherit',
      },
      inputFocus: {
        borderColor: color.brand,
      },
      pathRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      },
      pathBox: {
        boxSizing: 'border-box',
        flex: '1 1 auto',
        minWidth: 0,
        height: '30px',
        padding: '0 9px',
        fontSize: '12px',
        lineHeight: '28px',
        color: color.primary,
        border: '1px solid ' + color.border,
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      pathBoxEmpty: {
        color: color.tertiary,
      },
      action: {
        flex: 'none',
        height: '30px',
        padding: '0 12px',
        fontSize: '12px',
        color: color.brand,
        background: 'transparent',
        border: '1px solid ' + color.brand,
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        opacity: 1,
      },
      hint: {
        margin: 0,
        fontSize: '12px',
        color: color.tertiary,
      },
      chips: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px',
      },
      chip: {
        padding: '1px 9px',
        fontSize: '11px',
        color: color.secondary,
        background: 'transparent',
        border: '1px solid ' + color.border,
        borderRadius: '999px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      linkButton: {
        padding: 0,
        fontSize: '11px',
        color: color.tertiary,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textDecoration: 'underline',
        fontFamily: 'inherit',
      },
      switchBase: {
        position: 'relative',
        flex: 'none',
        width: '38px',
        height: '22px',
        padding: 0,
        border: 'none',
        borderRadius: '999px',
        cursor: 'pointer',
        transition: 'background-color 160ms ease',
      },
      knobBase: {
        position: 'absolute',
        top: '3px',
        left: '3px',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
        transition: 'transform 160ms ease',
      },
      error: {
        margin: 0,
        fontSize: '12px',
        color: color.danger,
      },
    }

    /* ------------------------------------------------------------- 小工具 */

    /** Subscribe a component to one config form without re-creating the snapshot. */
    function useFormSnapshot(form) {
      return React.useSyncExternalStore(
        function (onChange) {
          return form.subscribe(onChange)
        },
        function () {
          return form.getSnapshot()
        },
        function () {
          return form.getSnapshot()
        }
      )
    }

    function short(text, fallback) {
      var value = typeof text === 'string' ? text.trim() : ''
      return value || fallback
    }

    /**
     * A toggle rendered from scratch: the primitives package is not guaranteed
     * to be in this deployment's client seed, and one <button> is not worth a
     * dependency that can break the whole section.
     */
    function Switch(props) {
      var on = Boolean(props.checked)
      var disabled = Boolean(props.disabled)
      var track = {
        background: on ? color.success : 'var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.45))',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          'aria-label': props.label,
          disabled: disabled,
          onClick: props.onChange,
          style: Object.assign({}, styles.switchBase, track),
        },
        h('span', {
          style: Object.assign({}, styles.knobBase, { transform: on ? 'translateX(16px)' : 'none' }),
        })
      )
    }

    /**
     * One editable config field.
     *
     * The write goes through the shared config form, so it lands in the same
     * settings document the plugin page edits. Committing on blur/Enter (rather
     * than on every keystroke) keeps one write per edit instead of one per
     * character, and keeps a half-typed URL from ever reaching the backend.
     */
    function TextField(props) {
      var t = props.t
      var value = typeof props.value === 'string' ? props.value : props.value === undefined || props.value === null ? '' : String(props.value)
      var draftState = React.useState(value)
      var draft = draftState[0]
      var setDraft = draftState[1]
      var statusState = React.useState('idle')
      var status = statusState[0]
      var setStatus = statusState[1]
      var focusState = React.useState(false)
      var focused = focusState[0]
      var setFocused = focusState[1]

      React.useEffect(
        function () {
          if (focused) return
          setDraft(value)
        },
        [value]
      )

      var commit = function () {
        if (props.disabled) return
        if (props.secret && draft === '') return
        if (draft === value) {
          setStatus('idle')
          return
        }
        setStatus('saving')
        Promise.resolve(props.onSave(draft)).then(
          function (ok) {
            setStatus(ok === false ? 'failed' : 'saved')
          },
          function () {
            setStatus('failed')
          }
        )
      }

      var note = null
      if (status === 'saving') note = h('span', { style: styles.note }, t('saving'))
      else if (status === 'failed') note = h('span', { style: styles.noteError }, t('saveFailed'))
      else if (status === 'saved') note = h('span', { style: styles.noteOk }, t('saved'))
      else if (draft !== value && !props.secret) note = h('span', { style: styles.note }, t('dirty'))

      return h(
        'div',
        { style: styles.field },
        h(
          'div',
          { style: styles.fieldHead },
          h('label', { style: styles.label }, props.label),
          note ||
            (props.secret && props.onClear
              ? h(
                  'button',
                  {
                    type: 'button',
                    style: styles.linkButton,
                    disabled: props.disabled,
                    onClick: function () {
                      setDraft('')
                      setStatus('saving')
                      Promise.resolve(props.onClear()).then(
                        function (ok) {
                          setStatus(ok === false ? 'failed' : 'saved')
                        },
                        function () {
                          setStatus('failed')
                        }
                      )
                    },
                  },
                  t('clearKey')
                )
              : null)
        ),
        h('input', {
          type: props.secret ? 'password' : 'text',
          value: draft,
          placeholder: props.placeholder,
          disabled: props.disabled,
          spellCheck: false,
          autoComplete: props.secret ? 'new-password' : 'off',
          style: Object.assign({}, styles.input, focused ? styles.inputFocus : null),
          onChange: function (event) {
            setDraft(event.target.value)
            if (status !== 'idle') setStatus('idle')
          },
          onFocus: function () {
            setFocused(true)
          },
          onBlur: function () {
            setFocused(false)
            commit()
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          },
        }),
        props.hint ? h('p', { style: styles.hint }, props.hint) : null
      )
    }

    /**
     * Folder picker field.
     *
     * A path setting is better picked than typed, so the primary affordance is a
     * button that drives the Host's directory picker — the same OS dialog the
     * workspace flow uses (`uiWorkspace.pickDirectory()`, resolved lazily so a
     * deployment without that service still loads this page). The manual input
     * stays behind a link as the fallback for headless or remote deployments.
     */
    function FolderField(props) {
      var t = props.t
      var pickingState = React.useState(false)
      var picking = pickingState[0]
      var setPicking = pickingState[1]
      var errorState = React.useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var manualState = React.useState(false)
      var manual = manualState[0]
      var setManual = manualState[1]

      var value = typeof props.value === 'string' ? props.value : ''

      // No picker in this composition (headless / remote browser): fall straight
      // back to a typed path rather than showing a button that cannot work.
      if (!props.canPick) {
        return h(TextField, {
          t: t,
          label: props.label,
          value: value,
          placeholder: t('pathPlaceholder'),
          hint: props.hint,
          disabled: props.disabled,
          onSave: props.onSave,
        })
      }

      /** Drive the Host picker; a cancelled dialog is not an error. */
      var choose = function () {
        if (props.disabled || picking) return
        setPicking(true)
        setError('')
        Promise.resolve(props.onPick()).then(
          function (path) {
            setPicking(false)
            if (path === null || path === undefined || path === '') return
            Promise.resolve(props.onSave(path)).then(function (ok) {
              if (!ok) setError(t('saveFailed'))
            })
          },
          function () {
            setPicking(false)
            setManual(true)
            setError(t('pickFailed'))
          }
        )
      }

      var head = h(
        'div',
        { style: styles.fieldHead },
        h('label', { style: styles.label }, props.label),
        value && !props.disabled
          ? h(
              'button',
              {
                type: 'button',
                style: styles.linkButton,
                onClick: function () {
                  setError('')
                  Promise.resolve(props.onClear()).then(function (ok) {
                    if (!ok) setError(t('saveFailed'))
                  })
                },
              },
              t('resetDefault')
            )
          : null
      )

      var picker = h(
        'div',
        null,
        h(
          'div',
          { style: styles.pathRow },
          h(
            'div',
            { style: Object.assign({}, styles.pathBox, value ? null : styles.pathBoxEmpty), title: value || t('pathPlaceholder') },
            value || t('pathPlaceholder')
          ),
          h(
            'button',
            {
              type: 'button',
              style: Object.assign({}, styles.action, props.disabled ? { opacity: 0.5, cursor: 'default' } : null),
              disabled: props.disabled,
              onClick: choose,
            },
            t('chooseFolder')
          )
        ),
        h('p', { style: styles.hint }, picking ? t('choosing') : t('chooseHint')),
        props.hint ? h('p', { style: styles.hint }, props.hint) : null,
        error ? h('p', { style: styles.error }, error) : null,
        props.canPick && !manual
          ? h(
              'button',
              {
                type: 'button',
                style: styles.linkButton,
                onClick: function () {
                  setManual(true)
                },
              },
              t('manualToggle')
            )
          : null
      )

      var manualInput = manual
        ? h(TextField, {
            t: t,
            label: t('manualToggle'),
            value: value,
            placeholder: t('pathPlaceholder'),
            hint: props.hint,
            disabled: props.disabled,
            onSave: props.onSave,
          })
        : null

      return h('div', { style: styles.field }, head, picker, manualInput)
    }

    /** Card frame: title, one-line explanation, and a configured / not badge. */
    function Card(props) {
      return h(
        'section',
        { style: styles.card },
        h(
          'div',
          { style: styles.cardHead },
          h(
            'div',
            null,
            h('h3', { style: styles.cardTitle }, props.title),
            props.hint ? h('p', { style: styles.cardHint }, props.hint) : null
          ),
          props.ready === undefined
            ? null
            : h(
                'span',
                { style: Object.assign({}, styles.badge, props.ready ? styles.badgeOn : null) },
                props.ready ? props.t('configured') : props.t('notConfigured')
              )
        ),
        props.children
      )
    }

    /* --------------------------------------------------------------- 页面 */

    function AutoPromptSection(props) {
      var t = props.t
      var form = props.form
      var snapshot = useFormSnapshot(form)
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errorState = React.useState('')
      var error = errorState[0]
      var setError = errorState[1]

      var cfg = snapshot && snapshot.value ? snapshot.value : undefined
      var writable = Boolean(snapshot && snapshot.writable !== false)

      /** One field write; resolves to whether the host accepted it. */
      var save = function (field, value) {
        if (!writable) return Promise.resolve(false)
        return Promise.resolve(form.set(field, value)).then(
          function (ok) {
            return ok !== false
          },
          function () {
            return false
          }
        )
      }
      var clear = function (field) {
        if (!writable || typeof form.unset !== 'function') return Promise.resolve(false)
        return Promise.resolve(form.unset(field)).then(
          function (ok) {
            return ok !== false
          },
          function () {
            return false
          }
        )
      }

      var toggle = function (next) {
        if (!writable || busy) return
        setBusy(true)
        setError('')
        save('generateMedia', next).then(function (ok) {
          setBusy(false)
          if (!ok) setError(t('saveFailed'))
        })
      }

      var header = h(
        'header',
        null,
        h('h2', { style: styles.title }, t('title')),
        h('p', { style: styles.lede }, t('subtitle'))
      )

      if (!cfg) {
        return h('div', { style: styles.root }, header, h('p', { style: styles.hint }, t('unavailable')))
      }

      var generating = Boolean(cfg.generateMedia)
      var disabled = !writable

      var switchCard = h(
        'section',
        { style: styles.card },
        h(
          'div',
          { style: styles.row },
          h(
            'div',
            { style: styles.rowMain },
            h('span', { style: styles.label }, t('switchLabel')),
            h('p', { style: styles.hint }, generating ? t('switchOn') : t('switchOff'))
          ),
          h(Switch, {
            checked: generating,
            disabled: !writable || busy,
            label: t('switchLabel'),
            onChange: function () {
              toggle(!generating)
            },
          })
        ),
        h('p', { style: styles.hint }, busy ? t('saving') : writable ? t('switchHint') : t('readOnly')),
        error ? h('p', { style: styles.error }, error) : null
      )

      var promptCard = h(
        Card,
        { title: t('promptCard'), hint: t('promptCardHint'), ready: Boolean(cfg.promptBaseUrl), t: t },
        h(TextField, {
          t: t,
          label: t('promptBaseLabel'),
          value: cfg.promptBaseUrl,
          hint: t('promptBaseHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('promptBaseUrl', value)
          },
        }),
        h(
          'div',
          { style: styles.chips },
          h('span', { style: styles.note }, t('presets')),
          PRESETS.map(function (preset) {
            return h(
              'button',
              {
                key: preset.value,
                type: 'button',
                style: styles.chip,
                disabled: disabled,
                title: t('applyPreset') + ' ' + preset.value,
                onClick: function () {
                  save('promptBaseUrl', preset.value)
                },
              },
              preset.label
            )
          })
        ),
        h(TextField, {
          t: t,
          label: t('promptModelLabel'),
          value: cfg.promptModel,
          hint: t('promptModelHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('promptModel', value)
          },
        }),
        h(TextField, {
          t: t,
          label: t('promptKeyLabel'),
          value: '',
          secret: true,
          placeholder: t('keyPlaceholder'),
          hint: t('promptKeyHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('promptApiKey', value)
          },
          onClear: function () {
            return clear('promptApiKey')
          },
        })
      )

      var imageCard = h(
        Card,
        { title: t('imageCard'), hint: t('imageCardHint'), ready: Boolean(cfg.imageBaseUrl), t: t },
        h(TextField, {
          t: t,
          label: t('imageBaseLabel'),
          value: cfg.imageBaseUrl,
          hint: t('imageBaseHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('imageBaseUrl', value)
          },
        }),
        h(TextField, {
          t: t,
          label: t('imageModelLabel'),
          value: cfg.imageModel,
          hint: t('imageModelHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('imageModel', value)
          },
        }),
        h(TextField, {
          t: t,
          label: t('imageKeyLabel'),
          value: '',
          secret: true,
          placeholder: t('keyPlaceholder'),
          hint: t('imageKeyHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('imageApiKey', value)
          },
          onClear: function () {
            return clear('imageApiKey')
          },
        })
      )

      var videoCard = h(
        Card,
        {
          title: t('videoCard'),
          hint: t('videoCardHint'),
          ready: Boolean(cfg.videoSubmitUrl || cfg.videoBaseUrl),
          t: t,
        },
        h(TextField, {
          t: t,
          label: t('videoSubmitLabel'),
          value: cfg.videoSubmitUrl,
          hint: t('videoSubmitHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('videoSubmitUrl', value)
          },
        }),
        h(TextField, {
          t: t,
          label: t('videoBaseLabel'),
          value: cfg.videoBaseUrl,
          hint: t('videoBaseHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('videoBaseUrl', value)
          },
        }),
        h(TextField, {
          t: t,
          label: t('videoModelLabel'),
          value: cfg.videoModel,
          hint: t('videoModelHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('videoModel', value)
          },
        }),
        h(TextField, {
          t: t,
          label: t('videoKeyLabel'),
          value: '',
          secret: true,
          placeholder: t('keyPlaceholder'),
          hint: t('videoKeyHint'),
          disabled: disabled,
          onSave: function (value) {
            return save('videoApiKey', value)
          },
          onClear: function () {
            return clear('videoApiKey')
          },
        })
      )

      var outputCard = h(
        Card,
        { title: t('outputCard'), t: t },
        h(FolderField, {
          t: t,
          label: t('outputLabel'),
          value: cfg.outputDir,
          hint: t('outputHint'),
          disabled: disabled,
          canPick: Boolean(props.canPick),
          onPick: props.pick,
          onSave: function (value) {
            return save('outputDir', value)
          },
          onClear: function () {
            return clear('outputDir')
          },
        })
      )

      return h(
        'div',
        { style: styles.root },
        header,
        switchCard,
        promptCard,
        imageCard,
        videoCard,
        outputCard,
        h('p', { style: styles.hint }, t('autoSave')),
        h('p', { style: styles.hint }, t('advanced'))
      )
    }

    /* --------------------------------------------------------------- 注册 */

    /**
     * Mount the settings section while the host serves this plugin's settings
     * namespace, so a deployment without the plugin shows no trace of the page.
     * @param ctx - browser plugin context.
     */
    function apply(ctx) {
      var t = ctx.locale.bind(NS)

      /**
       * Read a service without declaring it: `ctx.foo` throws "cannot get
       * property without inject" for undeclared services, while `reflect.get`
       * is the documented unrestricted read and yields `undefined` when absent.
       * @param name - the service name.
       * @returns the service, or undefined when this composition lacks it.
       */
      var service = function (name) {
        try {
          return ctx.reflect.get(name)
        } catch (error) {
          return undefined
        }
      }

      /**
       * The Host directory picker, resolved lazily: `uiWorkspace` is owned by
       * another client plugin, and declaring it as a hard dependency would make
       * this whole page disappear in a composition that lacks it. Accessing it
       * at click time keeps the page usable and lets the caller fall back to a
       * typed path.
       * @returns the selected absolute path, or null when the dialog is cancelled.
       */
      var pickDirectory = function () {
        var workspace = service('uiWorkspace')
        if (!workspace || typeof workspace.pickDirectory !== 'function') {
          return Promise.reject(new Error('directory picker is not composed in this client'))
        }
        return workspace.pickDirectory()
      }

      /** @returns whether this composition can open an OS folder dialog. */
      var hasDirectoryPicker = function () {
        var workspace = service('uiWorkspace')
        return Boolean(workspace && typeof workspace.pickDirectory === 'function')
      }

      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: zh, en: en })
        },
        'dsh-auto-prompt: dictionaries'
      )
      ctx.effect(
        function () {
          return ctx.configForms.whileServed([ENTRY_ID], function () {
            return ctx.slots.inject('settings.section', function () {
              return ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'auto-prompt',
                  order: 60,
                  label: function () {
                    return t('nav')
                  },
                  locale: NS,
                  inject: function () {
                    // `t` is not injected automatically: a section owns its own
                    // dictionary and hands the bound reader to its component.
                    return {
                      form: ctx.configForms.get(ENTRY_ID),
                      t: t,
                      pick: pickDirectory,
                      canPick: hasDirectoryPicker(),
                    }
                  },
                },
                AutoPromptSection
              )
            })
          })
        },
        'dsh-auto-prompt: settings section'
      )
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = ['slots', 'locale', 'configForms']
    return module.exports
  },
})
