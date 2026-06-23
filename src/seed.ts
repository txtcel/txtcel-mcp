import { PublicKey } from '@solana/web3.js'

const HEX_64 = /^[0-9a-fA-F]{64}$/

/**
 * Normalizes a user-supplied channel reference to the 32-byte thread seed the
 * SDK expects. Accepts either:
 *   - a 64-char hex string (the `rootAllocId` form stored by the client), or
 *   - a base58 thread address (the channel's on-chain pubkey).
 */
export function resolveSeed(channel: string): Uint8Array {
  const value = channel.trim()

  if (HEX_64.test(value)) {
    return Uint8Array.from(Buffer.from(value, 'hex'))
  }

  try {
    return new PublicKey(value).toBytes()
  } catch {
    throw new Error(
      `Invalid channel "${channel}": expected a 64-char hex seed or a base58 thread address.`,
    )
  }
}

/** Hex form of a seed (the client's `rootAllocId`). */
export function seedToHex(seed: Uint8Array): string {
  return Buffer.from(seed).toString('hex')
}

/** Base58 address form of a seed (the thread's on-chain pubkey). */
export function seedToAddress(seed: Uint8Array): string {
  return new PublicKey(seed).toBase58()
}
