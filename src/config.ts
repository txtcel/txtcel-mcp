import { Commitment, Connection, PublicKey } from '@solana/web3.js'

export type TxtcelConfig = {
  connection: Connection
  programId: PublicKey
  rpcUrl: string
  wsUrl: string | undefined
  commitment: Commitment
}

function parseCommitment(value: string | undefined): Commitment {
  if (!value) return 'confirmed'
  if (value === 'processed' || value === 'confirmed' || value === 'finalized') {
    return value
  }
  throw new Error(
    `Invalid TXTCEL_COMMITMENT "${value}" (expected processed | confirmed | finalized)`,
  )
}

let cached: TxtcelConfig | null = null

/**
 * Builds the shared config from environment variables. The cluster is decided
 * entirely by TXTCEL_RPC + TXTCEL_PROGRAM_ID, so the same binary works on
 * devnet or mainnet with no code changes.
 */
export function loadConfig(): TxtcelConfig {
  if (cached) return cached

  const rpcUrl = process.env.TXTCEL_RPC?.trim() || 'https://api.devnet.solana.com'
  const wsUrl = process.env.TXTCEL_WS?.trim() || undefined
  const commitment = parseCommitment(process.env.TXTCEL_COMMITMENT?.trim())

  const programIdStr = process.env.TXTCEL_PROGRAM_ID?.trim()
  if (!programIdStr) {
    throw new Error(
      'TXTCEL_PROGRAM_ID is required (set it to the program address on your cluster).',
    )
  }

  let programId: PublicKey
  try {
    programId = new PublicKey(programIdStr)
  } catch {
    throw new Error(`TXTCEL_PROGRAM_ID "${programIdStr}" is not a valid public key.`)
  }

  const connection = new Connection(rpcUrl, {
    commitment,
    wsEndpoint: wsUrl,
  })

  cached = { connection, programId, rpcUrl, wsUrl, commitment }
  return cached
}
