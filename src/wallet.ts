import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

/** Reads `keypair_path` from the active Solana CLI config, if present. */
function cliConfigKeypairPath(): string | null {
  try {
    const cfg = readFileSync(`${homedir()}/.config/solana/cli/config.yml`, 'utf-8')
    const match = cfg.match(/^\s*keypair_path:\s*(.+?)\s*$/m)
    return match ? match[1].replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

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
 *   3. Solana CLI default (~/.config/solana/id.json)
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

  const explicitPath = process.env.TXTCEL_KEYPAIR?.trim()
  const path = explicitPath || cliConfigKeypairPath() || `${homedir()}/.config/solana/id.json`

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
