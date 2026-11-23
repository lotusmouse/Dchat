import { useEffect, useReducer } from 'react'
import { enhancementCore, type EnhancementSettings } from '../../services/enhancement.js'

/**
 * 读取增强层设置，并在 dshx:settings 事件时重新渲染。
 * 增强层设置存在它自己的 localStorage 里，不走官方 zustand，所以要手动订阅。
 */
export const useEnhanceSetting = <K extends keyof EnhancementSettings>(
  key: K
): EnhancementSettings[K] | undefined => {
  const [, force] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const onChange = () => force()
    window.addEventListener('dshx:settings', onChange)
    return () => window.removeEventListener('dshx:settings', onChange)
  }, [])
  return enhancementCore()?.getSettings()[key]
}

/** 头像图片：优先使用通话页设置过的自定义头像 */
export const readAvatarSrc = (): string => {
  try {
    const saved = localStorage.getItem('dshx:avatar')
    if (saved) return saved
  } catch {
    // ignore
  }
  return 'icons/icon-192.png'
}
