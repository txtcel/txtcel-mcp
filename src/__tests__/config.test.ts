import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'

const PROGRAM_ID = Keypair.generate().publicKey.toBase58()

// loadConfig caches at module scope, so each test re-imports a fresh instance.
async function freshLoadConfig() {
  vi.resetModules()
  const { loadConfig } = await import('../config.js')
  return loadConfig
}

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('TXTCEL_')) delete process.env[key]
  }
  process.env.TXTCEL_PROGRAM_ID = PROGRAM_ID
})

afterEach(() => {
  process.env = savedEnv
})

describe('loadConfig', () => {
  it('requires TXTCEL_PROGRAM_ID', async () => {
    delete process.env.TXTCEL_PROGRAM_ID
    const loadConfig = await freshLoadConfig()
    expect(() => loadConfig()).toThrow(/TXTCEL_PROGRAM_ID is required/)
  })

  it('rejects an invalid TXTCEL_PROGRAM_ID', async () => {
    process.env.TXTCEL_PROGRAM_ID = 'garbage'
    const loadConfig = await freshLoadConfig()
    expect(() => loadConfig()).toThrow(/not a valid public key/)
  })

  it('applies safe defaults: devnet RPC, confirmed, 10k micro-lamports priority fee', async () => {
    const loadConfig = await freshLoadConfig()
    const config = loadConfig()
    expect(config.rpcUrl).toBe('https://api.devnet.solana.com')
    expect(config.commitment).toBe('confirmed')
    expect(config.priorityFee).toEqual({ microLamports: 10_000 })
    expect(config.programId.toBase58()).toBe(PROGRAM_ID)
  })

  it('parses an explicit TXTCEL_PRIORITY_FEE', async () => {
    process.env.TXTCEL_PRIORITY_FEE = '25000'
    const loadConfig = await freshLoadConfig()
    expect(loadConfig().priorityFee).toEqual({ microLamports: 25_000 })
  })

  it('disables the priority fee when TXTCEL_PRIORITY_FEE=0', async () => {
    process.env.TXTCEL_PRIORITY_FEE = '0'
    const loadConfig = await freshLoadConfig()
    expect(loadConfig().priorityFee).toBeNull()
  })

  it.each(['abc', '-1', '1.5'])('rejects invalid TXTCEL_PRIORITY_FEE %s', async (value) => {
    process.env.TXTCEL_PRIORITY_FEE = value
    const loadConfig = await freshLoadConfig()
    expect(() => loadConfig()).toThrow(/Invalid TXTCEL_PRIORITY_FEE/)
  })

  it('rejects an invalid TXTCEL_COMMITMENT', async () => {
    process.env.TXTCEL_COMMITMENT = 'super-final'
    const loadConfig = await freshLoadConfig()
    expect(() => loadConfig()).toThrow(/Invalid TXTCEL_COMMITMENT/)
  })

  it('honors TXTCEL_RPC and TXTCEL_COMMITMENT', async () => {
    process.env.TXTCEL_RPC = 'https://example-rpc.invalid'
    process.env.TXTCEL_COMMITMENT = 'finalized'
    const loadConfig = await freshLoadConfig()
    const config = loadConfig()
    expect(config.rpcUrl).toBe('https://example-rpc.invalid')
    expect(config.commitment).toBe('finalized')
  })
})
