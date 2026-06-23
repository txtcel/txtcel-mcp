import { explainError } from './errors.js'

type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** Serializes a value to a pretty JSON text result (bigint-safe). */
export function jsonResult(value: unknown): CallToolResult {
  const text = JSON.stringify(
    value,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  )
  return { content: [{ type: 'text', text }] }
}

export function errorResult(err: unknown): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${explainError(err)}` }], isError: true }
}

/**
 * Wraps an async tool handler so any throw becomes a clean MCP error result.
 * Args are typed `any` so the SDK's per-tool schema inference at the call site
 * still drives validation while keeping this wrapper reusable across tools.
 */
export function handler(
  fn: (args: any) => Promise<CallToolResult>,
): (args: any) => Promise<CallToolResult> {
  return async (args: any) => {
    try {
      return await fn(args)
    } catch (err) {
      return errorResult(err)
    }
  }
}

/** Parses a lamports input (number or string) into a bigint. */
export function toLamports(value: number | string): bigint {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('Fee/lamports must be a non-negative integer')
    }
    return BigInt(value)
  }
  return BigInt(value)
}
