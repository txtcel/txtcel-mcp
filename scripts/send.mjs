// One-off message sender using the same code path as the MCP send_message tool.
// Usage: node scripts/send.mjs <channelHexSeedOrAddress> "<text>"
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { buildSendMessageTransactions } from '@txtcel/protocol'

const RPC = process.env.TXTCEL_RPC ?? 'https://api.devnet.solana.com'
const PROGRAM_ID = process.env.TXTCEL_PROGRAM_ID ?? 'CiJm3YBx4qK5tBMwEjfmVtyu5jwJmTXw9Ro9GB8P62jv'
const KEYPAIR = process.env.TXTCEL_KEYPAIR ?? `${homedir()}/.config/solana/id.json`

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

console.log(JSON.stringify({
  ok: true,
  signatures: sigs,
  explorer: sigs.map((s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`),
}, null, 2))
