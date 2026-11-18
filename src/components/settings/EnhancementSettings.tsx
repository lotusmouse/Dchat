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
  长期记忆: 'memory',
  上下文与用量: 'context',
  模型与风控: 'model',
  语音通话: 'voice',
  外观增强: 'appearance',
  增强设置备份: 'backup',
}
const entries: { page: Exclude<EnhancementPage, 'home'>; label: string; description: string }[] = [
  { page: 'account', label: '账户', description: '余额查询与充值' },
  { page: 'prompt', label: '系统提示词', description: '自定义助手提示词' },
  { page: 'memory', label: '长期记忆', description: '自动记忆与手动管理' },
  { page: 'context', label: '上下文与用量', description: '上下文压缩与本轮用量' },
  { page: 'model', label: '模型与风控', description: '模型选择与内容风控' },
  { page: 'voice', label: '语音通话', description: '免手持与通话设置' },
  { page: 'appearance', label: '外观增强', description: '聊天背景、气泡与自定义 CSS' },
  { page: 'backup', label: '增强设置备份', description: '导入或导出增强设置 JSON' },
]

const Row = ({ label, description, action }: { label: string; description?: string; action: ReactNode }) => (
  <div className={clsx(styles.cell, styles.row)}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
      {description ? <div className={styles.description}>{description}</div> : null}
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
  const [busy, setBusy] = useState(false)
  const [background, setBackground] = useState(core.getChatBg())
  const [bubble, setBubble] = useState(core.getBubbleColor())
  const [customCss, setCustomCss] = useState(core.getCustomCss())
  const [customCssAi, setCustomCssAi] = useState(core.getCustomCssAi())
  const [usage, setUsage] = useState(core.lastUsage)
  const [balance, setBalance] = useState(core.lastBalance)
  const appIcon = useAppIcon()

  useEffect(() => {
    contentRef.current?.parentElement?.scrollTo({ top: 0 })
  }, [page])

  useEffect(() => {
    const onUsage = () => setUsage(core.lastUsage)
    window.addEventListener('dshx:usage', onUsage)
    return () => window.removeEventListener('dshx:usage', onUsage)
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
          const allowed: (keyof Settings)[] = ['system', 'systemEnabled', 'memoryEnabled', 'items', 'autoMemory', 'summaryEvery', 'autoCompress', 'compressedHashes', 'compressAt', 'model', 'modelOff', 'safety', 'showUsage']
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
                  <span className={styles.enhanceEntryDescription}>{entry.description}</span>
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
          description={balance ? `${core.fmtMoney(balance.total, balance.currency)}${balance.available ? '' : '（余额不足）'}` : '使用当前 API Key 查询'}
          action={<Button variant="outlined" size="m" disabled={busy || !core.getKey()} onClick={() => void run(async () => { setBalance(await core.fetchBalance(true)) })}>查询余额</Button>}
        />
        <Row label="充值" description="前往 DeepSeek 官方充值页面" action={<Button variant="outlined" size="m" onClick={() => window.open('https://platform.deepseek.com/top_up', '_blank', 'noopener,noreferrer')}>前往充值</Button>} />
      </Section>

      <Section title="系统提示词">
        <textarea className={styles.enhanceTextarea} rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入自定义系统提示词" />
        <Row label="启用自定义提示词" description="支持 {{memory}} 占位符；留空或关闭时使用官方默认提示词" action={<Toggle label="启用自定义提示词" checked={settings.systemEnabled} onChange={() => update({ systemEnabled: !settings.systemEnabled })} />} />
        <div className={styles.enhanceActions}>
          <Button size="m" onClick={() => { update({ system: prompt }); showToast('系统提示词已保存') }}>保存提示词</Button>
          <Button variant="outlined" size="m" onClick={() => { setPrompt(core.defaults.system); update({ system: core.defaults.system }); showToast('已恢复默认提示词') }}>恢复默认</Button>
        </div>
      </Section>

      <Section title="长期记忆">
        <Row label="自动总结记忆" description="每 N 轮对话在后台自动总结一次；关闭后只能手动总结" action={<Toggle label="自动总结记忆" checked={settings.autoMemory} onChange={() => update({ autoMemory: !settings.autoMemory })} />} />
        <Row label="总结间隔" description="每多少轮总结一次（0 = 不自动总结），默认 5" action={<input className={styles.enhanceNumber} type="number" min={0} max={50} step={1} value={settings.summaryEvery} onChange={(event) => update({ summaryEvery: Math.min(50, Math.max(0, Number(event.target.value) || 0)) })} />} />
        <div className={styles.enhanceActions}>
        <Button variant="outlined" size="m" disabled={busy} onClick={() => void run(async () => { const result = await core.memoryNow(); showToast(result.skipped ? '已有总结任务在进行' : '记忆总结完成') })}>立即总结一次</Button>
        </div>
        <Row label="读取记忆库" description="将已有记忆和摘要提供给 AI；与自动记忆开关互不影响" action={<Toggle label="读取记忆库" checked={settings.memoryEnabled} onChange={() => update({ memoryEnabled: !settings.memoryEnabled })} />} />
        <div className={styles.enhanceMemoryAdd}>
          <input className={styles.enhanceInput} value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder="手动添加一条记忆" />
          <Button variant="outlined" size="m" onClick={addMemory}>添加</Button>
        </div>
        <div className={styles.enhanceMemoryList}>
          {settings.items.map((item) => (
            <div className={styles.enhanceMemoryItem} key={item.id}>
              <div className={styles.enhanceMemoryMeta}>
                <label><input type="checkbox" checked={item.enabled} onChange={() => updateItem(item.id, { enabled: !item.enabled })} /> {item.kind === 'summary' ? '上下文摘要' : '记忆'}</label>
                <button type="button" onClick={() => removeMemory(item)}>删除</button>
              </div>
              <textarea className={styles.enhanceTextarea} rows={2} defaultValue={item.text} onBlur={(event) => updateItem(item.id, { text: event.target.value.trim() })} />
            </div>
          ))}
          {!settings.items.length ? <div className={styles.description}>还没有记忆。</div> : null}
        </div>
      </Section>

      <Section title="上下文与用量">
        <Row label="自动压缩" description="达到阈值后保留最近 6 条原文，更早的内容整理为摘要" action={<Toggle label="自动压缩" checked={settings.autoCompress} onChange={() => update({ autoCompress: !settings.autoCompress })} />} />
        <Row label="压缩阈值" description="8,000 – 128,000 tokens" action={<input className={styles.enhanceNumber} type="number" min={8000} max={128000} step={1000} value={settings.compressAt} onChange={(event) => update({ compressAt: Math.min(128000, Math.max(8000, Number(event.target.value) || 100000)) })} />} />
        {core.lastCtx ? <div className={styles.description}>上次请求：保留 {core.lastCtx.kept} 条{core.lastCtx.dropped ? `，压缩 ${core.lastCtx.dropped} 条` : ''}，约 {core.lastCtx.tokens} tokens。</div> : null}
        {usage ? <div className={styles.description}>最近用量：输入 {usage.input}，缓存命中 {usage.cacheRead}，输出 {usage.output}。</div> : <div className={styles.description}>发送一条消息后，这里会显示本轮用量。</div>}
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="m" disabled={busy} onClick={() => void run(async () => { const result = await core.compressNow(); showToast(`已将 ${result.compressed} 条消息压缩为摘要`) })}>立即压缩</Button>
          <Button variant="outlined" size="m" onClick={() => { core.resetCompression(); update({ compressedHashes: [] }); showToast('已清除压缩标记') }}>清除压缩标记</Button>
        </div>
      </Section>

      <Section title="模型与风控">
        <div className={styles.enhanceMemoryAdd}>
          <input className={styles.enhanceInput} value={model} onChange={(event) => setModel(event.target.value)} spellCheck={false} />
          <Button size="m" onClick={() => { const value = model.trim() || core.defaults.model; update({ model: value }); setModel(value); showToast(`已切换到 ${value}`) }}>保存模型</Button>
        </div>
        <Row label="可用模型" description={models.length ? models.join('、') : '从当前 API 服务拉取'} action={<Button variant="outlined" size="m" disabled={busy} onClick={() => void run(async () => { const result = await core.fetchModels(); setModels(result); showToast(`拉取到 ${result.length} 个模型`) })}>拉取模型</Button>} />

        <Row label="深度思考关闭时" description="自动改用这个模型；用推理模型时服务端会忽略关闭请求，仍会思考" action={<input className={styles.enhanceInput} style={{ width: 160 }} value={settings.modelOff} onChange={(event) => update({ modelOff: event.target.value })} spellCheck={false} />} />        <Row label="内容风控" description="标准使用平台默认检查；加强会显式请求额外审核" action={<Select ariaLabel="内容风控" value={settings.safety} options={[{ value: 'standard', label: '标准' }, { value: 'high', label: '加强' }]} onChange={(safety) => update({ safety })} />} />
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
        <Row label="开始语音通话" description="关闭设置后使用当前对话进行语音通话" action={<Button variant="outlined" size="m" onClick={() => { closeSettings(); setTimeout(() => window.__DSHV?.start(), 80) }}>开始通话</Button>} />
      </Section>

      <Section title="外观增强">
        <div className={styles.enhanceAppIconPreview}>
          {appIcon ? <img src={appIcon} alt="当前欢迎页图标" /> : <span>D</span>}
        </div>
        <Row
          label="欢迎页图标"
          description={appIcon ? '已使用自定义图片，保存在本机' : '默认显示 DChat 字母图标，可上传自己的图片'}
          action={
            <div className={styles.enhanceActions}>
              <Button variant="outlined" size="m" onClick={pickAppIcon}>{appIcon ? '更换' : '上传图标'}</Button>
              {appIcon ? (
                <Button
                  variant="outlined"
                  size="m"
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
        <Row label="聊天背景" description={background ? '已设置自定义背景图' : '使用默认背景'} action={<div className={styles.enhanceActions}><Button variant="outlined" size="m" onClick={pickBackground}>{background ? '更换' : '上传'}</Button>{background ? <Button variant="outlined" size="m" onClick={() => { core.setChatBg(''); setBackground('') }}>移除</Button> : null}</div>} />
        <Row label="我的气泡颜色" action={<Select ariaLabel="我的气泡颜色" value={bubble} options={[{ value: '', label: '默认' }, { value: '#dbeafe', label: '雾蓝' }, { value: '#d9f2ff', label: '天蓝' }, { value: '#dcfce7', label: '薄荷' }, { value: '#fde2e4', label: '樱粉' }, { value: '#fef3c7', label: '奶黄' }, { value: '#ede9fe', label: '香芋' }, { value: '#e5e7eb', label: '浅灰' }, { value: '#111827', label: '墨黑' }]} onChange={(value) => { core.setBubbleColor(value); setBubble(value) }} />} />
        <label className={styles.enhanceCssLabel}>我的气泡 CSS<textarea className={styles.enhanceTextarea} rows={3} value={customCss} onChange={(event) => setCustomCss(event.target.value)} spellCheck={false} /></label>
        <Button variant="outlined" size="m" onClick={() => { core.setCustomCss(customCss); showToast('我的气泡样式已应用') }}>应用我的气泡 CSS</Button>
        <label className={styles.enhanceCssLabel}>助手气泡 CSS<textarea className={styles.enhanceTextarea} rows={3} value={customCssAi} onChange={(event) => setCustomCssAi(event.target.value)} spellCheck={false} /></label>
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="m" onClick={() => { core.setCustomCssAi(customCssAi); showToast('助手气泡样式已应用') }}>应用助手气泡 CSS</Button>
          <Button variant="outlined" size="m" onClick={() => { core.setCustomCss(''); core.setCustomCssAi(''); setCustomCss(''); setCustomCssAi(''); showToast('自定义 CSS 已清空') }}>清空全部 CSS</Button>
        </div>
      </Section>

      <Section title="增强设置备份">
        <div className={styles.description}>仅包含提示词、记忆、压缩状态和模型设置，不包含 API Key 或聊天记录。</div>
        <div className={styles.enhanceActions}>
          <Button variant="outlined" size="m" onClick={() => downloadJson(core.getSettings(), 'deepseek-enhance-settings.json')}>导出增强设置</Button>
          <Button variant="outlined" size="m" onClick={importSettings}>导入增强设置</Button>
        </div>
        </Section>
      </div>
    </EnhancementPageContext.Provider>
  )
}
