import type {
  ChatModel,
  CreateMessageRequest,
  MessageParam,
  ToolUseBlock,
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
  autoCompress: boolean
  compressedHashes: string[]
  compressAt: number
  model: string
  safety: 'standard' | 'high'
  showUsage: boolean
}

export type EnhancementBalance = {
  available: boolean
  currency: string
  total: string
}

type MemoryToolResult = { content: string; isError?: boolean }

type EnhancementCore = {
  model(): string
  sys(): string
  ctx(messages: MessageParam[]): MessageParam[]
  safety(): { level: 'high' } | undefined
  memoryTools(): CreateMessageRequest['tools']
  executeMemoryTool(call: ToolUseBlock): MemoryToolResult
  getSettings(): EnhancementSettings
  saveSettings(patch: Partial<EnhancementSettings>): EnhancementSettings
  defaults: EnhancementSettings
  memoryNow(): Promise<{ applies?: number; skipped?: boolean }>
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
  lastUsage: { input: number; output: number; cacheRead: number } | null
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
export const enhancementModel = (fallback: ChatModel): ChatModel =>
  (enhancementCore()?.model() || fallback) as ChatModel

export const enhancementSystem = (fallback: string): string =>
  enhancementCore()?.sys() ?? fallback

export const enhancementMessages = (messages: MessageParam[]): MessageParam[] =>
  enhancementCore()?.ctx(messages) ?? messages

export const enhancementSafety = (
  fallback: CreateMessageRequest['safety_check']
): CreateMessageRequest['safety_check'] =>
  (enhancementCore()?.safety() ?? fallback) as CreateMessageRequest['safety_check']

/** 只有允许 AI 写入时才声明工具；读取已有记忆由 sys() 独立控制。 */
export const enhancementMemoryTools = (): CreateMessageRequest['tools'] =>
  enhancementCore()?.memoryTools() ?? []

export const enhancementExecuteMemoryTool = (call: ToolUseBlock): MemoryToolResult =>
  enhancementCore()?.executeMemoryTool(call) ?? {
    content: '记忆功能当前不可用',
    isError: true,
  }
