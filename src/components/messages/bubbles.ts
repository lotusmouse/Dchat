/** 气泡最多占屏幕宽度的比例 */
export const BUBBLE_WIDTH_RATIO = 0.66

/** 估算一个气泡能放多少字（按 2/3 屏宽、16px 字号） */
export const bubbleCapacity = (): number => {
  const vw = typeof window === 'undefined' ? 390 : window.innerWidth || 390
  const usable = vw * BUBBLE_WIDTH_RATIO - 34
  return Math.max(8, Math.min(90, Math.floor(usable / 15)))
}

/**
 * 按「一屏 2/3 宽能放多少字」把文本切成多个气泡：
 * - 换行仍然是硬分界；
 * - 空行忽略；
 * - 一行放得下就单独一个气泡（不拆），放不下才按长度继续切，优先在标点处断。
 */
export const splitIntoBubbles = (text: string, capacity = bubbleCapacity()): string[] => {
  const out: string[] = []
  const marks = '，。！？；：、）】…,.!?;:)'
  for (const raw of String(text || '').split(/\r?\n/)) {
    let rest = raw.trim()
    if (!rest) continue
    while (rest.length > capacity) {
      let cut = capacity
      for (let i = capacity; i > Math.floor(capacity * 0.6); i -= 1) {
        if (marks.includes(rest[i - 1])) {
          cut = i
          break
        }
      }
      const piece = rest.slice(0, cut).trim()
      if (piece) out.push(piece)
      rest = rest.slice(cut).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}
