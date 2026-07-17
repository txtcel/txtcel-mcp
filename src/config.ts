import { Commitment, Connection, PublicKey } from '@solana/web3.js'
import type { PriorityFeeConfig } from '@txtcel/protocol'

/** Default compute-unit price (micro-lamports) when TXTCEL_PRIORITY_FEE is unset. */
const DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 10_000

export type TxtcelConfig = {
  connection: Connection
  programId: PublicKey
  rpcUrl: string
  wsUrl: string | undefined
  commitment: Commitment
  /** ComputeBudget priority fee applied to every transaction; null disables. */
  priorityFee: PriorityFeeConfig | null
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

function parsePriorityFee(value: string | undefined): PriorityFeeConfig | null {
  if (!value) return { microLamports: DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS }
  const microLamports = Number(value)
  if (!Number.isFinite(microLamports) || microLamports < 0 || !Number.isInteger(microLamports)) {
    throw new Error(
      `Invalid TXTCEL_PRIORITY_FEE "${value}" (expected a non-negative integer, micro-lamports per compute unit)`,
    )
  }
  return microLamports === 0 ? null : { microLamports }
}

let cached: TxtcelConfig | null = null

/**
 * Builds the shared config from environment variables. The cluster is decided
 * entirely by TXTCEL_RPC + TXTCEL_PROGRAM_ID, so the same binary works on
 * devnet or mainnet with no code changes.
 */
export function loadConfig(): TxtcelConfig {
  if (cached) return cached

  // Required, like TXTCEL_PROGRAM_ID: a silent devnet default paired with a
  // mainnet program id produces confusing "account not found" failures.
  const rpcUrl = process.env.TXTCEL_RPC?.trim()
  if (!rpcUrl) {
    throw new Error(
      'TXTCEL_RPC is required (set it to the RPC endpoint of the cluster where TXTCEL_PROGRAM_ID is deployed, e.g. https://api.devnet.solana.com).',
    )
  }
  const wsUrl = process.env.TXTCEL_WS?.trim() || undefined
  const commitment = parseCommitment(process.env.TXTCEL_COMMITMENT?.trim())
  const priorityFee = parsePriorityFee(process.env.TXTCEL_PRIORITY_FEE?.trim())

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

  cached = { connection, programId, rpcUrl, wsUrl, commitment, priorityFee }
  return cached
}
