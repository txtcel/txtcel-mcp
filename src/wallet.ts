import { readFileSync } from 'node:fs'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

function keypairFromFile(path: string): Keypair {
  const raw = readFileSync(path, 'utf-8')
  const bytes = Uint8Array.from(JSON.parse(raw) as number[])
  return Keypair.fromSecretKey(bytes)
}

function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim()
  // JSON array of bytes, e.g. "[12,34,...]"
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]))
  }
  // base58 encoded secret key
  return Keypair.fromSecretKey(bs58.decode(trimmed))
}

let cached: Keypair | null = null

/**
 * Resolves the agent signing wallet. Resolution order:
 *   1. TXTCEL_SECRET_KEY (JSON byte array or base58 string)
 *   2. TXTCEL_KEYPAIR (path to a Solana keypair JSON file)
 *
 * There is deliberately NO fallback to the user's Solana CLI wallet
 * (~/.config/solana/id.json): an AI agent must never silently gain control of
 * a personal wallet that may hold real funds. The agent wallet is always an
 * explicit, dedicated keypair.
 */
export function loadWallet(): Keypair {
  if (cached) return cached

  const secret = process.env.TXTCEL_SECRET_KEY?.trim()
  if (secret) {
    try {
      cached = keypairFromSecret(secret)
      return cached
    } catch (err) {
      throw new Error(`Failed to parse TXTCEL_SECRET_KEY: ${(err as Error).message}`)
    }
  }

  const path = process.env.TXTCEL_KEYPAIR?.trim()
  if (!path) {
    throw new Error(
      'No agent wallet configured. Set TXTCEL_SECRET_KEY or TXTCEL_KEYPAIR to a ' +
        'DEDICATED agent keypair funded with only what the agent needs. ' +
        'Personal wallets (e.g. ~/.config/solana/id.json) are never used implicitly.',
    )
  }

  try {
    cached = keypairFromFile(path)
    return cached
  } catch (err) {
    throw new Error(
      `Failed to load agent keypair from "${path}": ${(err as Error).message}. ` +
        'Set TXTCEL_SECRET_KEY or TXTCEL_KEYPAIR.',
    )
  }
}
