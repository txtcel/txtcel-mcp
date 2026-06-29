import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { loadConfig } from './config.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function confirm(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature])
    const status = value?.[0]
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`)
      return
    }
    await sleep(1_500)
  }
  throw new Error(`Confirmation timeout for ${signature}`)
}

/**
 * Signs, sends and confirms a single transaction built from raw instructions.
 * The agent wallet is always the fee payer and first signer; extra signers
 * (e.g. a fresh thread keypair for create_channel) are appended.
 */
export async function sendInstructions(
  payer: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = [],
): Promise<string> {
  const { connection } = loadConfig()
  const tx = new Transaction().add(...instructions)
  tx.feePayer = payer.publicKey
  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.sign(payer, ...extraSigners)
  const sig = await connection.sendRawTransaction(tx.serialize())
  await confirm(connection, sig)
  return sig
}

/** Sends a pre-built list of transactions sequentially (e.g. fill + append). */
export async function sendTransactions(
  payer: Keypair,
  txs: Transaction[],
): Promise<string[]> {
  const { connection } = loadConfig()
  const sigs: string[] = []
  for (const tx of txs) {
    tx.feePayer = payer.publicKey
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.sign(payer)
    const sig = await connection.sendRawTransaction(tx.serialize())
    await confirm(connection, sig)
    sigs.push(sig)
  }
  return sigs
}

/**
 * Signs and submits a single transaction best-effort: it NEVER throws and
 * returns the signature or `null`. Used for the decoupled, optional alloc
 * extend (`buildExtendAllocTransaction`), which must never fail a post — the
 * extend is racy and is expected to bounce (e.g. `InvalidAllocSeq`) when
 * another sender already grew the chain.
 */
export async function trySendBestEffort(
  payer: Keypair,
  tx: Transaction,
): Promise<string | null> {
  try {
    const { connection } = loadConfig()
    tx.feePayer = payer.publicKey
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.sign(payer)
    return await connection.sendRawTransaction(tx.serialize())
  } catch {
    return null
  }
}

/** Solana explorer URL for a signature on the configured cluster. */
export function explorerTx(signature: string): string {
  const { rpcUrl } = loadConfig()
  const cluster = rpcUrl.includes('devnet')
    ? '?cluster=devnet'
    : rpcUrl.includes('testnet')
      ? '?cluster=testnet'
      : rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')
        ? '?cluster=custom'
        : ''
  return `https://explorer.solana.com/tx/${signature}${cluster}`
}

export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / 1_000_000_000
}

export function pubkey(value: string): PublicKey {
  return new PublicKey(value)
}
