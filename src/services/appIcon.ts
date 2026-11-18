import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'dchat:welcome-icon'
const listeners = new Set<() => void>()
let currentIcon = localStorage.getItem(STORAGE_KEY) ?? ''

/** 欢迎页图标仅保存在本机；使用图片 Data URL，离线也能显示。 */
export const getAppIcon = () => currentIcon

export const setAppIcon = (value: string) => {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    return false
  }
  currentIcon = value
  listeners.forEach((listener) => listener())
  return true
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useAppIcon = () => useSyncExternalStore(subscribe, getAppIcon, () => '')
