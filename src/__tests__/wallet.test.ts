import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

// loadWallet caches the keypair at module scope, so each test re-imports a
// fresh module instance.
async function freshLoadWallet() {
  vi.resetModules()
  const { loadWallet } = await import('../wallet.js')
  return loadWallet
}

const AGENT = Keypair.generate()
let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  delete process.env.TXTCEL_SECRET_KEY
  delete process.env.TXTCEL_KEYPAIR
})

afterEach(() => {
  process.env = savedEnv
})

describe('loadWallet', () => {
  it('throws when no wallet is configured (no implicit CLI-wallet fallback)', async () => {
    const loadWallet = await freshLoadWallet()
    expect(() => loadWallet()).toThrow(/No agent wallet configured/)
    expect(() => loadWallet()).toThrow(/never used implicitly/)
  })

  it('loads a base58 TXTCEL_SECRET_KEY', async () => {
    process.env.TXTCEL_SECRET_KEY = bs58.encode(AGENT.secretKey)
    const loadWallet = await freshLoadWallet()
    expect(loadWallet().publicKey.equals(AGENT.publicKey)).toBe(true)
  })

  it('loads a JSON-array TXTCEL_SECRET_KEY', async () => {
    process.env.TXTCEL_SECRET_KEY = JSON.stringify([...AGENT.secretKey])
    const loadWallet = await freshLoadWallet()
    expect(loadWallet().publicKey.equals(AGENT.publicKey)).toBe(true)
  })

  it('rejects an unparseable TXTCEL_SECRET_KEY', async () => {
    process.env.TXTCEL_SECRET_KEY = 'not-a-key'
    const loadWallet = await freshLoadWallet()
    expect(() => loadWallet()).toThrow(/Failed to parse TXTCEL_SECRET_KEY/)
  })

  it('loads a keypair file from TXTCEL_KEYPAIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'txtcel-mcp-test-'))
    try {
      const path = join(dir, 'agent.json')
      writeFileSync(path, JSON.stringify([...AGENT.secretKey]))
      process.env.TXTCEL_KEYPAIR = path
      const loadWallet = await freshLoadWallet()
      expect(loadWallet().publicKey.equals(AGENT.publicKey)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a broken TXTCEL_KEYPAIR path instead of falling back', async () => {
    process.env.TXTCEL_KEYPAIR = '/nonexistent/agent.json'
    const loadWallet = await freshLoadWallet()
    expect(() => loadWallet()).toThrow(/Failed to load agent keypair from "\/nonexistent\/agent\.json"/)
  })

  it('prefers TXTCEL_SECRET_KEY over TXTCEL_KEYPAIR', async () => {
    process.env.TXTCEL_SECRET_KEY = bs58.encode(AGENT.secretKey)
    process.env.TXTCEL_KEYPAIR = '/nonexistent/agent.json'
    const loadWallet = await freshLoadWallet()
    expect(loadWallet().publicKey.equals(AGENT.publicKey)).toBe(true)
  })
})
