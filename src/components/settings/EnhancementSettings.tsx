import clsx from 'clsx'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { enhancementCore, type EnhancementMemoryItem, type EnhancementSettings as Settings } from '../../services/enhancement.js'
import { setAppIcon, useAppIcon } from '../../services/appIcon.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { closeSettings } from './settingsDialogState.js'
import styles from './Settings.module.css'

type Core = NonNullable<ReturnType<typeof enhancementCore>>
type EnhancementPage = 'home' | 'account' | 'prompt' | 'memory' | 'context' | 'model' | 'voice' | 'appearance' | 'backup'

const EnhancementPageContext = createContext<EnhancementPage>('home')
const sectionPages: Record<string, EnhancementPage> = {
  账户: 'account',
  系统提示词: 'prompt',
  常驻记忆: 'memory',
  历史回忆: 'memory',
  上下文与用量: 'context',
  模型与风控: 'model',
  语音通话: 'voice',
  外观增强: 'appearance',
  增强设置备份: 'backup',
}
const entries: { page: Exclude<EnhancementPage, 'home'>; label: string }[] = [
  { page: 'account', label: '账户' },
  { page: 'prompt', label: '系统提示词' },
  { page: 'memory', label: '长期记忆' },
  { page: 'context', label: '上下文与用量' },
  { page: 'model', label: '模型与风控' },
  { page: 'voice', label: '语音通话' },
  { page: 'appearance', label: '外观增强' },
  { page: 'backup', label: '增强设置备份' },
]

const Row = ({ label, action }: { label: string; description?: string; action: ReactNode }) => (
  <div className={clsx(styles.cell, styles.row)}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
    </div>
    {action}
  </div>
)

const Section = ({ title, children }: { title: string; children: ReactNode }) => {
  const page = useContext(EnhancementPageContext)
  return (
    <section className={styles.enhanceSection} hidden={page !== sectionPages[title]}>
      <h3 className={styles.enhanceTitle}>{title}</h3>
      {children}
    </section>
  )
}

const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) => (
  <input
    className={styles.enhanceToggle}
    type="checkbox"
    aria-label={label}
    checked={checked}
    onChange={onChange}
  />
)

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const downloadJson = (value: unknown, name: string) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const EnhancementSettings = () => {
  const core = enhancementCore()
  return core ? <EnhancementContent core={core} /> : <div className={styles.description}>增强核心未加载，请刷新页面后重试。</div>
}

const EnhancementContent = ({ core }: { core: Core }) => {
  const [page, setPage] = useState<EnhancementPage>('home')
  const contentRef = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState<Settings>(() => core.getSettings())
  const [prompt, setPrompt] = useState(settings.system)
  const [model, setModel] = useState(settings.model)
  const [models, setModels] = useState<string[]>([])
  const [newMemory, setNewMemory] = useState('')
  const [avatarTick, setAvatarTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [background, setBackground] = useState(core.getChatBg())
  const [bubble, setBubble] = useState(core.getBubbleColor())
  const [customCss, setCustomCss] = useState(core.getCustomCss())
  const [customCssAi, setCustomCssAi] = useState(core.getCustomCssAi())
  const [usage, setUsage] = useState(core.lastUsage)
  const [contextTokens, setContextTokens] = useState<number | null>(() => {
    const current = core.lastUsage
    return current ? current.input + current.cacheRead + current.cacheWrite : core.lastCtx?.tokens ?? null
  })
  const [balance, setBalance] = useState(core.lastBalance)
  const appIcon = useAppIcon()

  useEffect(() => {
    contentRef.current?.parentElement?.scrollTo({ top: 0 })
  }, [page])

  useEffect(() => {
    const onUsage = () => {
      const current = core.lastUsage
      setUsage(current)
      if (current) {
        const realInput = current.input + current.cacheRead + current.cacheWrite
        setContextTokens(realInput || core.lastCtx?.tokens || 0)
      }
    }
    const onCompress = (event: Event) => {
      const detail = (event as CustomEvent<{ tokens?: number }>).detail
      if (typeof detail?.tokens === 'number') {
        setContextTokens(detail.tokens)
      }
    }
    window.addEventListener('dshx:usage', onUsage)
    window.addEventListener('dshx:compress', onCompress)
    return () => {
      window.removeEventListener('dshx:usage', onUsage)
      window.removeEventListener('dshx:compress', onCompress)
    }
  }, [core])

  const update = (patch: Partial<Settings>) => setSettings(core.saveSettings(patch))
  const updateItem = (id: string, patch: Partial<EnhancementMemoryItem>) => {
    update({ items: settings.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })
  }
  const run = async (action: () => Promise<void>) => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showToast(errorMessage(error))
    } finally {
      setBusy(false)
      setSettings(core.getSettings())
    }
  }

  const addMemory = () => {
    const text = newMemory.trim()
    if (!text) {
      return
    }
    update({
      items: [
        ...settings.items,
        { id: `m${Math.random().toString(36).slice(2, 10)}`, text, enabled: true, kind: 'fact' },
      ],
    })
    setNewMemory('')
  }

  const removeMemory = (item: EnhancementMemoryItem) => {
    update({
      items: settings.items.filter((current) => current.id !== item.id),
      ...(item.kind === 'summary' ? { compressedHashes: [] } : {}),
    })
  }

  const importSettings = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as Partial<Settings>
          const allowed: (keyof Settings)[] = ['system', 'systemEnabled', 'memoryEnabled', 'items', 'recallEnabled', 'recallTopK', 'bubbleSplit', 'showAvatars', 'autoCompress', 'compressedHashes', 'compressAt', 'model', 'modelOff', 'safety', 'showUsage']
          const patch: Partial<Settings> = {}
          for (const key of allowed) {
            if (Object.hasOwn(data, key)) {
              Object.assign(patch, { [key]: data[key] })
            }
          }
          update(patch)
          setPrompt(core.getSettings().system)
          setModel(core.getSettings().model)
          showToast('增强设置已导入')
        } catch {
          showToast('导入失败：不是有效的 JSON 文件')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const pickBackground = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const image = new Image()
        image.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(image.width * scale)
          canvas.height = Math.round(image.height * scale)
          canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
          const data = canvas.toDataURL('image/jpeg', 0.82)
          core.setChatBg(data)
          setBackground(data)
          showToast('聊天背景已更新')
        }
        image.onerror = () => showToast('图片读取失败，请换一张试试')
        image.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  /** 上传气泡头像：role 决定存到哪个 key（助手 dshx:avatar / 用户 dshx:user-avatar） */
  const pickChatAvatar = (role: 'assistant' | 'user') => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const image = new Image()
        image.onload = () => {
          const scale = Math.min(1, 256 / Math.max(image.width, image.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(image.width * scale))
          canvas.height = Math.max(1, Math.round(image.height * scale))
          const context = canvas.getContext('2d')
          if (!context) {
            showToast('图片处理失败，请换一张')
            return
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          try {
            localStorage.setItem(
              role === 'user' ? 'dshx:user-avatar' : 'dshx:avatar',
              canvas.toDataURL('image/jpeg', 0.85)
            )
            window.dispatchEvent(new CustomEvent('dshx:avatar'))
            setAvatarTick((value) => value + 1)
            showToast(role === 'user' ? '我的头像已更新' : 'AI 头像已更新')
          } catch {
            showToast('保存失败，图片可能太大')
          }
        }
        image.onerror = () => showToast('图片读不出来')
        image.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const resetChatAvatar = (role: 'assistant' | 'user') => {
    try {
      localStorage.removeItem(role === 'user' ? 'dshx:user-avatar' : 'dshx:avatar')
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent('dshx:avatar'))
    setAvatarTick((value) => value + 1)
    showToast('已恢复默认头像')
  }

  const pickAppIcon = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const image = new Image()
        image.onload = () => {
          const scale = Math.min(1, 256 / Math.max(image.width, image.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(image.width * scale))
          canvas.height = Math.max(1, Math.round(image.height * scale))
          const context = canvas.getContext('2d')
          if (!context) {
            showToast('图标处理失败，请换一张图片')
            return
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          if (setAppIcon(canvas.toDataURL('image/png'))) {
            showToast('欢迎页图标已更新')
          } else {
            showToast('图标保存失败，请换一张更小的图片')
          }
        }
        image.onerror = () => showToast('图片读取失败，请换一张试试')
        image.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  return (
    <EnhancementPageContext.Provider value={page}>
      <div ref={contentRef} className={styles.enhanceContent}>
        {page === 'home' ? (
          <div className={styles.enhanceEntryList}>
            {entries.map((entry) => (
              <button
                key={entry.page}
                type="button"
                className={styles.enhanceEntry}
                aria-label={entry.label}
                onClick={() => setPage(entry.page)}
              >
                <span className={styles.enhanceEntryText}>
                  <span className={styles.enhanceEntryLabel}>{entry.label}</span>
                </span>
                <span className={styles.enhanceChevron} aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className={styles.enhanceBack} aria-label="返回增强设置" onClick={() => setPage('home')}>
            <span aria-hidden="true">‹</span> 增强设置
          </button>
        )}
        <Section title="账户">
        <Row
          label="账户余额"
          action={
            <div className={styles.enhanceActions}>
              {balance ? <span className={styles.description}>{core.fmtMoney(balance.total, balance.currency)}{balance.available ? '' : '（余额不足）'}</span> : null}
              <Button variant="outlined" size="s" disabled={busy || !core.getKey()} onClick={() => void run(async () => { setBalance(await core.fetchBalance(true)) })}>查询余额</Button>
            </div>
          }
        />
        <Row label="充值" description="前往 DeepSeek 官方充值页面" action={<Button variant="outlined" size="s" onClick={() => window.open('https://platform.deepseek.com/top_up', '_blank', 'noopener,noreferrer')}>前往充值</Button>} />
      </Section>

      <Section title="系统提示词">
        <textarea className={styles.enhanceTextarea} rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入自定义系统提示词" />
        <Row label="启用自定义提示词" description="支持 {{memory}} 占位符；留空或关闭时使用官方默认提示词" action={<Toggle label="启用自定义提示词" checked={settings.systemEnabled} onChange={() => update({ systemEnabled: !settings.systemEnabled })} />} />
        <div className={styles.enhanceActions}>
          <Button size="s" onClick={() => { update({ system: prompt }); showToast('系统提示词已保存') }}>保存提示词</Button>
          <Button variant="outlined" size="s" onClick={() => { setPrompt(core.defaults.system); update({ system: core.defaults.system }); showToast('已恢复默认提示词') }}>恢复默认</Button>
        </div>
      </Section>

      <Section title="常驻记忆">
        <Row label="注入常驻记忆" description="把这些手写的记忆放进系统提示词，每轮都会带上" action={<Toggle label="注入常驻记忆" checked={settings.memoryEnabled} onChange={() => update({ memoryEnabled: !settings.memoryEnabled })} />} />
        <div className={styles.enhanceMemoryAdd}>
          <input className={styles.enhanceInput} value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder="写一条长期有效的记忆" />
          <Button variant="outlined" size="s" onClick={addMemory}>添加</Button>
        </div>
        <div className={styles.enhanceMemoryList}>
          {settings.items.filter((item) => item.kind !== 'summary').map((item) => (
            <div className={styles.enhanceMemoryItem} key={item.id}>
              <div className={styles.enhanceMemoryMeta}>
                <label><input type="checkbox" checked={item.enabled} onChange={() => updateItem(item.id, { enabled: !item.enabled })} /> 记忆</label>
                <button type="button" onClick={() => removeMemory(item)}>删除</button>
              </div>
              <textarea className={styles.enhanceTextarea} rows={2} defaultValue={item.text} onBlur={(event) => updateItem(item.id, { text: event.target.value.trim() })} />
            </div>
          ))}
          {!settings.items.filter((item) => item.kind !== 'summary').length ? <div className={styles.description}>还没有常驻记忆，手动添加即可。</div> : null}
        </div>
      </Section>

      <Section title="历史回忆">
        <Row label="回忆过去的聊天" description="按关键词 + 向量检索历史对话，把最相关的几轮塞进本轮上下文" action={<Toggle label="回忆过去的聊天" checked={settings.recallEnabled} onChange={() => update({ recallEnabled: !settings.recallEnabled })} />} />
        <Row label="每次召回" description="最多 3 轮（一问一答算一轮）" action={<input className={styles.enhanceNumber} type="number" min={1} max={3} step={1} value={settings.recallTopK} onChange={(event) => update({ recallTopK: Math.min(3, Math.max(1, Number(event.target.value) || 3)) })} />} />
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="s" disabled={busy} onClick={() => void run(async () => { const n = await core.refreshRecall(true); showToast('已索引 ' + n + ' 轮对话') })}>重建回忆索引</Button>
        </div>
        {core.lastRecall && core.lastRecall.length ? <div className={styles.description}>上次召回：{core.lastRecall.length} 轮（{core.lastRecall.map((r) => r.user.slice(0, 16)).join(' / ')}）</div> : null}
      </Section>

      <Section title="上下文与用量">
        <Row label="自动压缩" description="上下文达到阈值时，把较早的对话压成摘要，只保留最近 6 条原文" action={<Toggle label="自动压缩" checked={settings.autoCompress} onChange={() => update({ autoCompress: !settings.autoCompress })} />} />
        <Row label="压缩阈值" description="8,000 – 128,000 tokens" action={<input className={styles.enhanceNumber} type="number" min={8000} max={128000} step={1000} value={settings.compressAt} onChange={(event) => update({ compressAt: Math.min(128000, Math.max(8000, Number(event.target.value) || 100000)) })} />} />
        {contextTokens !== null ? <div className={styles.description}>上下文约 {contextTokens} / {settings.compressAt.toLocaleString()} tokens</div> : null}
        {usage ? <div className={styles.description}>本轮：输入 {usage.input} · 缓存 {usage.cacheRead} · 输出 {usage.output}</div> : null}
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="s" disabled={busy} onClick={() => void run(async () => { const result = await core.compressNow(); showToast(`已将 ${result.compressed} 条消息压缩为摘要`) })}>立即压缩</Button>
          <Button variant="outlined" size="s" onClick={() => { core.resetCompression(); update({ compressedHashes: [] }); showToast('已清除压缩标记') }}>清除压缩标记</Button>
        </div>
      </Section>

      <Section title="模型与风控">
        <div className={styles.enhanceMemoryAdd}>
          <input className={styles.enhanceInput} value={model} onChange={(event) => setModel(event.target.value)} spellCheck={false} />
          <Button size="s" onClick={() => { const value = model.trim() || core.defaults.model; update({ model: value }); setModel(value); showToast(`已切换到 ${value}`) }}>保存模型</Button>
        </div>
        <Row label="可用模型" action={<Button variant="outlined" size="s" disabled={busy} onClick={() => void run(async () => { const result = await core.fetchModels(); setModels(result); showToast(`拉取到 ${result.length} 个模型`) })}>拉取模型</Button>} />
        {models.length ? <div className={styles.description}>{models.join('、')}</div> : null}

        <Row label="深度思考关闭时" description="固定使用 deepseek-flash（省钱档），不可修改" action={<span className={styles.description}>deepseek-flash</span>} />
      </Section>

      <Section title="语音通话">
        <Row
          label="免手持"
          description="说完后自动继续聆听"
          action={
            <Toggle
              label="免手持"
              checked={window.__DSHV?.state.handsFree ?? true}
              onChange={() => {
                const voice = window.__DSHV
                if (!voice) {
                  return
                }
                voice.state.handsFree = !voice.state.handsFree
                localStorage.setItem('dshx:hands-free', voice.state.handsFree ? '1' : '0')
                setSettings({ ...settings })
              }}
            />
          }
        />
        <Row label="开始语音通话" description="关闭设置后使用当前对话进行语音通话" action={<Button variant="outlined" size="s" onClick={() => { closeSettings(); setTimeout(() => window.__DSHV?.start(), 80) }}>开始通话</Button>} />
      </Section>

      <Section title="外观增强">
        <Row label="换行分气泡" description="消息里的每个换行都拆成单独的气泡；空行会被忽略" action={<Toggle label="换行分气泡" checked={settings.bubbleSplit} onChange={() => update({ bubbleSplit: !settings.bubbleSplit })} />} />
        <Row label="气泡头像" description="在气泡旁边显示头像，用户和助手都有；气泡外观交给自定义 CSS" action={<Toggle label="气泡头像" checked={settings.showAvatars} onChange={() => update({ showAvatars: !settings.showAvatars })} />} />
        <Row
          label="AI 头像"
          description="气泡和通话页共用，保存在本机"
          action={
            <div className={styles.enhanceActions}>
              <Button variant="outlined" size="s" onClick={() => pickChatAvatar('assistant')}>上传</Button>
              <Button variant="outlined" size="s" onClick={() => resetChatAvatar('assistant')}>默认</Button>
            </div>
          }
        />
        <Row
          label="我的头像"
          description={avatarTick >= 0 && typeof localStorage !== 'undefined' && localStorage.getItem('dshx:user-avatar') ? '已自定义' : '默认显示“我”，可上传图片'}
          action={
            <div className={styles.enhanceActions}>
              <Button variant="outlined" size="s" onClick={() => pickChatAvatar('user')}>上传</Button>
              <Button variant="outlined" size="s" onClick={() => resetChatAvatar('user')}>默认</Button>
            </div>
          }
        />
        <div className={styles.enhanceAppIconPreview}>
          {appIcon ? <img src={appIcon} alt="当前欢迎页图标" /> : <span>D</span>}
        </div>
        <Row
          label="欢迎页图标"
          description={appIcon ? '已使用自定义图片，保存在本机' : '默认显示 DChat 字母图标，可上传自己的图片'}
          action={
            <div className={styles.enhanceActions}>
              <Button variant="outlined" size="s" onClick={pickAppIcon}>{appIcon ? '更换' : '上传图标'}</Button>
              {appIcon ? (
                <Button
                  variant="outlined"
                  size="s"
                  onClick={() => {
                    if (setAppIcon('')) {
                      showToast('已恢复默认图标')
                    } else {
                      showToast('图标移除失败，请重试')
                    }
                  }}
                >
                  移除
                </Button>
              ) : null}
            </div>
          }
        />
        <Row label="聊天背景" description={background ? '已设置自定义背景图' : '使用默认背景'} action={<div className={styles.enhanceActions}><Button variant="outlined" size="s" onClick={pickBackground}>{background ? '更换' : '上传'}</Button>{background ? <Button variant="outlined" size="s" onClick={() => { core.setChatBg(''); setBackground('') }}>移除</Button> : null}</div>} />
        <Row label="我的气泡颜色" action={<Select ariaLabel="我的气泡颜色" className={styles.bubbleColorSelect} value={bubble} options={[{ value: '', label: '默认' }, { value: '#dbeafe', label: '雾蓝' }, { value: '#d9f2ff', label: '天蓝' }, { value: '#dcfce7', label: '薄荷' }, { value: '#fde2e4', label: '樱粉' }, { value: '#fef3c7', label: '奶黄' }, { value: '#ede9fe', label: '香芋' }, { value: '#e5e7eb', label: '浅灰' }, { value: '#111827', label: '墨黑' }]} onChange={(value) => { core.setBubbleColor(value); setBubble(value) }} />} />
        <label className={styles.enhanceCssLabel}>我的气泡 CSS<textarea className={styles.enhanceTextarea} rows={3} value={customCss} onChange={(event) => setCustomCss(event.target.value)} spellCheck={false} /></label>
        <Button variant="outlined" size="s" onClick={() => { core.setCustomCss(customCss); showToast('我的气泡样式已应用') }}>应用我的气泡 CSS</Button>
        <label className={styles.enhanceCssLabel}>助手气泡 CSS<textarea className={styles.enhanceTextarea} rows={3} value={customCssAi} onChange={(event) => setCustomCssAi(event.target.value)} spellCheck={false} /></label>
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="s" onClick={() => { core.setCustomCssAi(customCssAi); showToast('助手气泡样式已应用') }}>应用助手气泡 CSS</Button>
          <Button variant="outlined" size="s" onClick={() => { core.setCustomCss(''); core.setCustomCssAi(''); setCustomCss(''); setCustomCssAi(''); showToast('自定义 CSS 已清空') }}>清空全部 CSS</Button>
        </div>
      </Section>

      <Section title="增强设置备份">
        <div className={styles.description}>当前站点版本：{document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? '未知'}</div>
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="s" onClick={() => downloadJson(core.getSettings(), 'deepseek-enhance-settings.json')}>导出增强设置</Button>
          <Button variant="outlined" size="s" onClick={importSettings}>导入增强设置</Button>
        </div>
        </Section>
      </div>
    </EnhancementPageContext.Provider>
  )
}
