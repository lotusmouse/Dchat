/** 气泡最多占屏幕宽度的比例 */
export const BUBBLE_WIDTH_RATIO = 0.66

/**
 * 只按「消息里的换行」分气泡：
 * - 每个换行 = 一个新气泡；
 * - 空行忽略；
 * - 气泡内的文字按 2/3 屏宽自然折行（不在这里切字）。
 */
export const splitIntoBubbles = (text: string): string[] =>
  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
