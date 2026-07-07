// One-off message sender using the same code path as the MCP send_message tool.
// Usage: TXTCEL_PROGRAM_ID=... TXTCEL_KEYPAIR=... node scripts/send.mjs <channelHexSeedOrAddress> "<text>"
import { readFileSync } from 'node:fs'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { buildExtendAllocTransaction, buildSendMessageTransactions } from '@txtcel/protocol'

const RPC = process.env.TXTCEL_RPC ?? 'https://api.devnet.solana.com'
const PROGRAM_ID = process.env.TXTCEL_PROGRAM_ID
const KEYPAIR = process.env.TXTCEL_KEYPAIR

if (!PROGRAM_ID) {
  console.error('TXTCEL_PROGRAM_ID is required (no hardcoded default).')
  process.exit(1)
}
// Same policy as the MCP server: never touch the personal CLI wallet implicitly.
if (!KEYPAIR) {
  console.error('TXTCEL_KEYPAIR is required (a dedicated agent keypair; the CLI default wallet is never used implicitly).')
  process.exit(1)
}

const channel = process.argv[2]
const text = process.argv[3]
if (!channel || !text) {
  console.error('Usage: node scripts/send.mjs <channelHexSeedOrAddress> "<text>"')
  process.exit(1)
}

const seed = /^[0-9a-fA-F]{64}$/.test(channel)
  ? Uint8Array.from(Buffer.from(channel, 'hex'))
  : new PublicKey(channel).toBytes()

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, 'utf-8'))),
)
const connection = new Connection(RPC, 'confirmed')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function confirm(sig) {
  const start = Date.now()
  while (Date.now() - start < 90_000) {
    const { value } = await connection.getSignatureStatuses([sig])
    const s = value?.[0]
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
      if (s.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
      return
    }
    await sleep(1500)
  }
  throw new Error(`Confirmation timeout for ${sig}`)
}

const programId = new PublicKey(PROGRAM_ID)
const balance = await connection.getBalance(payer.publicKey, 'confirmed')
console.error(`wallet:  ${payer.publicKey.toBase58()}`)
console.error(`balance: ${balance / 1e9} SOL`)
console.error(`channel: ${new PublicKey(seed).toBase58()}`)

const txs = await buildSendMessageTransactions(connection, programId, payer.publicKey, seed, text)
const sigs = []
for (const tx of txs) {
  tx.feePayer = payer.publicKey
  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.sign(payer)
  const sig = await connection.sendRawTransaction(tx.serialize())
  await confirm(sig)
  sigs.push(sig)
}

// Decoupled, best-effort extend: grow the alloc chain after the post when the
// tail page is filling up. Racy and optional — never let it fail the post.
let extendSig = null
try {
  const extendTx = await buildExtendAllocTransaction(connection, programId, payer.publicKey, seed)
  if (extendTx) {
    extendTx.feePayer = payer.publicKey
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    extendTx.recentBlockhash = blockhash
    extendTx.sign(payer)
    extendSig = await connection.sendRawTransaction(extendTx.serialize())
  }
} catch {
  extendSig = null
}

console.log(JSON.stringify({
  ok: true,
  signatures: sigs,
  extendSignature: extendSig,
  explorer: sigs.map((s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`),
}, null, 2))
