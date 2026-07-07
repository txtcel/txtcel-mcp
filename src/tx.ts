import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  buildPriorityFeeInstructions,
  confirmTransactionWithRebroadcast,
} from '@txtcel/protocol'
import { loadConfig } from './config.js'

/**
 * Signs, sends and confirms a single transaction built from raw instructions,
 * prepending the configured priority fee. Confirmation is expiry-aware: the
 * signed bytes are re-broadcast until the transaction lands or its blockhash
 * expires (mainnet RPC nodes drop queued transactions under load).
 * The agent wallet is always the fee payer and first signer; extra signers
 * (e.g. a fresh thread keypair for create_channel) are appended.
 */
export async function sendInstructions(
  payer: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = [],
): Promise<string> {
  const { connection, priorityFee } = loadConfig()
  const tx = new Transaction()
  if (priorityFee) tx.add(...buildPriorityFeeInstructions(priorityFee))
  tx.add(...instructions)
  tx.feePayer = payer.publicKey
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.sign(payer, ...extraSigners)
  const rawTransaction = tx.serialize()
  const signature = await connection.sendRawTransaction(rawTransaction)
  await confirmTransactionWithRebroadcast({ connection, rawTransaction, signature, lastValidBlockHeight })
  return signature
}

/**
 * Sends a pre-built list of transactions sequentially (e.g. fill + append).
 * Each transaction gets its own fresh blockhash and expiry-aware confirmation.
 * Priority-fee instructions are expected to already be part of the prebuilt
 * transactions (the SDK builders add them when given `priorityFee`).
 */
export async function sendTransactions(
  payer: Keypair,
  txs: Transaction[],
): Promise<string[]> {
  const { connection } = loadConfig()
  const sigs: string[] = []
  for (const tx of txs) {
    tx.feePayer = payer.publicKey
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.sign(payer)
    const rawTransaction = tx.serialize()
    const signature = await connection.sendRawTransaction(rawTransaction)
    await confirmTransactionWithRebroadcast({ connection, rawTransaction, signature, lastValidBlockHeight })
    sigs.push(signature)
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
