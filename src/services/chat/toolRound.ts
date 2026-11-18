import type {
  AssistantBlockParam,
  MessageParam,
  MessageStreamEvent,
  OutputBlockStart,
  StopReason,
  ToolUseBlock,
} from '../api/types.js'

type ToolRound = {
  blocks: OutputBlockStart[]
  blockIndexes: Map<number, number>
  partialJson: Map<number, string>
  stopReason?: StopReason
}

/** 每次模型响应单独收集；工具内容不进入可见回复，只用于同轮请求的往返。 */
export const createToolRound = (): ToolRound => ({
  blocks: [],
  blockIndexes: new Map(),
  partialJson: new Map(),
})

const finishToolInput = (round: ToolRound, index: number, block: ToolUseBlock) => {
  const partial = round.partialJson.get(index)
  round.partialJson.delete(index)
  if (!partial?.trim()) {
    return
  }
  try {
    block.input = JSON.parse(partial)
  } catch {
    throw new Error('客户端工具参数不是有效的 JSON')
  }
}

/** 收集原始内容块和流式工具参数；索引在每轮响应内独立。 */
export const applyToolRoundEvent = (round: ToolRound, event: MessageStreamEvent) => {
  switch (event.type) {
    case 'content_block_start': {
      const block = { ...event.content_block }
      round.blockIndexes.set(event.index, round.blocks.length)
      round.blocks.push(block)
      if (block.type === 'tool_use') {
        round.partialJson.set(event.index, '')
      }
      break
    }
    case 'content_block_delta': {
      const index = round.blockIndexes.get(event.index)
      const block = index === undefined ? undefined : round.blocks[index]
      if (!block) {
        break
      }
      const { delta } = event
      if (block.type === 'text' && delta.type === 'text_delta') {
        block.text += delta.text
      } else if (block.type === 'thinking' && delta.type === 'thinking_delta') {
        block.thinking += delta.thinking
      } else if (block.type === 'thinking' && delta.type === 'signature_delta') {
        block.signature = (block.signature ?? '') + delta.signature
      } else if (block.type === 'text' && delta.type === 'citations_delta') {
        block.citations = [...(block.citations ?? []), delta.citation]
      } else if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
        round.partialJson.set(
          event.index,
          (round.partialJson.get(event.index) ?? '') + delta.partial_json
        )
      }
      break
    }
    case 'content_block_stop': {
      const index = round.blockIndexes.get(event.index)
      const block = index === undefined ? undefined : round.blocks[index]
      if (block?.type === 'tool_use') {
        finishToolInput(round, event.index, block)
      }
      round.blockIndexes.delete(event.index)
      break
    }
    case 'message_delta':
      round.stopReason = event.delta.stop_reason
      break
  }
}

export const getToolCalls = (round: ToolRound): ToolUseBlock[] =>
  round.blocks.filter((block): block is ToolUseBlock => block.type === 'tool_use')

/** 工具调用前的文本、思考和联网工具块也必须按原顺序回传。 */
export const toToolRoundParam = (
  round: ToolRound
): Extract<MessageParam, { role: 'assistant' }> => ({
  role: 'assistant',
  content: round.blocks.map((block): AssistantBlockParam => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text }
      case 'thinking':
        return { type: 'thinking', thinking: block.thinking, signature: block.signature ?? '' }
      case 'server_tool_use': {
        const { type, id, name, input, kind } = block
        return { type, id, name, input, kind }
      }
      default:
        return block
    }
  }),
})
