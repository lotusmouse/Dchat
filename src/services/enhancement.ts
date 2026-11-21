import type {
  ChatModel,
  CreateMessageRequest,
  MessageParam,
} from './api/types.js'

export type EnhancementMemoryItem = {
  id: string
  text: string
  enabled: boolean
  kind: 'fact' | 'summary'
}

export type EnhancementSettings = {
  system: string
  systemEnabled: boolean
  memoryEnabled: boolean
  items: EnhancementMemoryItem[]
  autoMemory: boolean
  /** 每多少轮对话自动总结一次记忆；0 表示不自动总结 */
  summaryEvery: number
  autoCompress: boolean
  compressedHashes: string[]
  compressAt: number
  model: string
  /** 关闭深度思考时使用的模型 */
  modelOff: string
  safety: 'standard' | 'high'
  showUsage: boolean
}

export type EnhancementBalance = {
  available: boolean
  currency: string
  total: string
}

type EnhancementCore = {
  model(thinkingOn?: boolean): string
  sys(): string
  ctx(messages: MessageParam[]): MessageParam[]
  safety(): { level: 'high' } | undefined
  turnDone(): void
  getSettings(): EnhancementSettings
  saveSettings(patch: Partial<EnhancementSettings>): EnhancementSettings
  defaults: EnhancementSettings
  memoryNow(): Promise<{ applies?: number; skipped?: boolean; ignored?: number; items?: string[] }>
  compressNow(): Promise<{ chars: number; compressed: number }>
  resetCompression(): void
  fetchModels(): Promise<string[]>
  fetchBalance(force?: boolean): Promise<EnhancementBalance & { at: number }>
  fmtMoney(value: string, currency: string): string
  getKey(): string
  getChatBg(): string
  setChatBg(value: string): void
  getBubbleColor(): string
  setBubbleColor(value: string): void
  getCustomCss(): string
  setCustomCss(value: string): void
  getCustomCssAi(): string
  setCustomCssAi(value: string): void
  lastCtx: { kept: number; dropped: number; tokens: number } | null
  lastUsage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
  lastBalance: (EnhancementBalance & { at: number }) | null
}

type EnhancementVoice = {
  start(): boolean
  capability(): { mic: boolean; secure: boolean; browserAsr: boolean; browserTts: boolean }
  state: { handsFree: boolean }
}

declare global {
  interface Window {
    __DSHXF?: EnhancementCore
    __DSHV?: EnhancementVoice
  }
}

export const enhancementCore = () => window.__DSHXF

// 官方源码直接调用增强钩子；独立运行未加载增强核心时回退到官方默认值。
export const enhancementModel = (fallback: ChatModel, thinkingOn?: boolean): ChatModel =>
  (enhancementCore()?.model(thinkingOn) || fallback) as ChatModel

export const enhancementSystem = (fallback: string): string =>
  enhancementCore()?.sys() ?? fallback

export const enhancementMessages = (messages: MessageParam[]): MessageParam[] =>
  enhancementCore()?.ctx(messages) ?? messages

export const enhancementSafety = (
  fallback: CreateMessageRequest['safety_check']
): CreateMessageRequest['safety_check'] =>
  (enhancementCore()?.safety() ?? fallback) as CreateMessageRequest['safety_check']

/** 每完成一轮对话通知增强层；达到设定的轮数后会后台做一次记忆总结。 */
export const enhancementTurnDone = (): void => {
  enhancementCore()?.turnDone()
}
