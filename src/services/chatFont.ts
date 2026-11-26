import { useSyncExternalStore } from 'react'
import { openDB, type DBSchema } from 'idb'

const FONT_NAME_KEY = 'dshx:chat-font-name'
const FONT_SIZE_KEY = 'dshx:chat-font-size'
const FONT_COLOR_KEY = 'dshx:chat-font-color'
const FONT_FAMILY = 'DChatLocalTTF'
const DEFAULT_SIZE = 16
const DEFAULT_COLOR = '#1f1f1f'
const MAX_FONT_BYTES = 50 * 1024 * 1024

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    throw new Error('设置保存失败，请检查浏览器存储空间')
  }
}

const removeStorage = (key: string) => {
  try {
    localStorage.removeItem(key)
  } catch {
    // 某些隐私模式只允许当前页面生效。
  }
}

const clampSize = (value: number) => Math.min(32, Math.max(12, Math.round(value) || DEFAULT_SIZE))
const validColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

export const getChatFontSize = () => clampSize(Number(readStorage(FONT_SIZE_KEY) ?? DEFAULT_SIZE))
export const getChatFontColor = () => {
  const value = readStorage(FONT_COLOR_KEY)
  return value && validColor(value) ? value : DEFAULT_COLOR
}

const applyFontSize = (value: number | null) => {
  const root = document.documentElement
  if (value === null) {
    root.removeAttribute('data-dshx-font-size')
    root.style.removeProperty('--dshx-chat-font-size')
    return
  }
  root.setAttribute('data-dshx-font-size', '1')
  root.style.setProperty('--dshx-chat-font-size', `${clampSize(value)}px`)
}

const applyFontColor = (value: string | null) => {
  const root = document.documentElement
  if (!value) {
    root.removeAttribute('data-dshx-font-color')
    root.style.removeProperty('--dshx-chat-font-color')
    return
  }
  root.setAttribute('data-dshx-font-color', '1')
  root.style.setProperty('--dshx-chat-font-color', value)
}

export const setChatFontSize = (value: number) => {
  const size = clampSize(value)
  writeStorage(FONT_SIZE_KEY, String(size))
  applyFontSize(size)
  return size
}

export const resetChatFontSize = () => {
  removeStorage(FONT_SIZE_KEY)
  applyFontSize(null)
}

export const setChatFontColor = (value: string) => {
  if (!validColor(value)) {
    throw new Error('颜色格式不正确')
  }
  writeStorage(FONT_COLOR_KEY, value)
  applyFontColor(value)
}

export const resetChatFontColor = () => {
  removeStorage(FONT_COLOR_KEY)
  applyFontColor(null)
}

const applyStoredPreferences = () => {
  const size = readStorage(FONT_SIZE_KEY)
  const color = readStorage(FONT_COLOR_KEY)
  applyFontSize(size === null ? null : clampSize(Number(size)))
  applyFontColor(color && validColor(color) ? color : null)
}

type FontRecord = { id: 'local-ttf'; name: string; blob: Blob }
interface AppearanceDB extends DBSchema {
  assets: { key: string; value: FontRecord }
}

const getDB = () => openDB<AppearanceDB>('dchat-appearance', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('assets')) {
      db.createObjectStore('assets', { keyPath: 'id' })
    }
  },
})

const readFont = async () => (await getDB()).get('assets', 'local-ttf')
const putFont = (file: File) =>
  getDB().then((db) => db.put('assets', { id: 'local-ttf', name: file.name, blob: file }))

let activeFace: FontFace | null = null
let activeUrl = ''
let fontName = readStorage(FONT_NAME_KEY) ?? ''
const listeners = new Set<() => void>()

const notifyFontName = (name: string) => {
  fontName = name
  listeners.forEach((listener) => listener())
}

const loadFontFace = async (blob: Blob) => {
  const url = URL.createObjectURL(blob)
  try {
    const face = new FontFace(FONT_FAMILY, `url("${url}")`)
    await face.load()
    return { face, url }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

const activateFont = ({ face, url }: { face: FontFace; url: string }) => {
  if (activeFace && activeFace !== face) {
    document.fonts.delete(activeFace)
  }
  if (activeUrl && activeUrl !== url) {
    URL.revokeObjectURL(activeUrl)
  }
  document.fonts.add(face)
  activeFace = face
  activeUrl = url
  document.documentElement.setAttribute('data-dshx-font-family', '1')
}

const clearInstalledFont = () => {
  if (activeFace) {
    document.fonts.delete(activeFace)
    activeFace = null
  }
  if (activeUrl) {
    URL.revokeObjectURL(activeUrl)
    activeUrl = ''
  }
  document.documentElement.removeAttribute('data-dshx-font-family')
}

export const uploadChatFont = async (file: File) => {
  if (!/\.ttf$/i.test(file.name)) {
    throw new Error('请选择 .ttf 字体文件')
  }
  if (!file.size) {
    throw new Error('字体文件是空的')
  }
  if (file.size > MAX_FONT_BYTES) {
    throw new Error('字体文件不能超过 50 MB')
  }
  let loaded: { face: FontFace; url: string }
  try {
    loaded = await loadFontFace(file)
  } catch {
    throw new Error('字体读取失败，请确认是有效的 TTF 文件')
  }
  try {
    await putFont(file)
    writeStorage(FONT_NAME_KEY, file.name)
  } catch (error) {
    URL.revokeObjectURL(loaded.url)
    throw error instanceof Error ? error : new Error('字体保存失败')
  }
  activateFont(loaded)
  notifyFontName(file.name)
}

export const removeChatFont = async () => {
  const db = await getDB()
  await db.delete('assets', 'local-ttf')
  removeStorage(FONT_NAME_KEY)
  clearInstalledFont()
  notifyFontName('')
}

let initPromise: Promise<void> | null = null
export const initChatFont = () => {
  applyStoredPreferences()
  initPromise ??= (async () => {
    if (!fontName) {
      return
    }
    try {
      const record = await readFont()
      if (!record) {
        removeStorage(FONT_NAME_KEY)
        notifyFontName('')
        return
      }
      const loaded = await loadFontFace(record.blob)
      activateFont(loaded)
      if (fontName !== record.name) {
        notifyFontName(record.name)
      }
    } catch {
      clearInstalledFont()
      removeStorage(FONT_NAME_KEY)
      notifyFontName('')
    }
  })()
  return initPromise
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useChatFontName = () => useSyncExternalStore(subscribe, () => fontName, () => '')
