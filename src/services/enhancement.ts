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
  /** 历史回忆（关键词 + 向量召回） */
  recallEnabled: boolean
  /** 每次最多召回几轮（1-3） */
  recallTopK: number
  /** 按换行拆成多个气泡 */
  bubbleSplit: boolean
  /** 气泡旁显示头像 */
  showAvatars: boolean
  autoCompress: boolean
  compressedHashes: string[]
  compressAt: number
  model: string
  /** 关闭深度思考时使用的模型 */
  modelOff: string
  safety: 'standard' | 'high'
  showUsage: boolean
}

export type RecallRound = { user: string; answer: string }

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
  getSettings(): EnhancementSettings
  saveSettings(patch: Partial<EnhancementSettings>): EnhancementSettings
  defaults: EnhancementSettings
  refreshRecall(force?: boolean): Promise<number>
  lastRecall: { user: string; answer: string }[] | null
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

