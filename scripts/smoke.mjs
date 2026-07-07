// Gated smoke test: verifies the MCP server's environment against a REAL
// cluster (RPC reachable, program deployed, agent wallet funded) without
// sending any transaction. Costs nothing and is safe on mainnet.
//
// Gated behind TXTCEL_SMOKE=1 so it never runs accidentally in CI:
//   TXTCEL_SMOKE=1 TXTCEL_RPC=... TXTCEL_PROGRAM_ID=... TXTCEL_SECRET_KEY=... node scripts/smoke.mjs
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import bs58 from 'bs58'

if (process.env.TXTCEL_SMOKE !== '1') {
  console.log('Skipped: set TXTCEL_SMOKE=1 to run the smoke test against a real cluster.')
  process.exit(0)
}

const fail = (message) => {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

const rpcUrl = process.env.TXTCEL_RPC?.trim()
if (!rpcUrl) fail('TXTCEL_RPC is required (a smoke test against a default cluster is meaningless).')

const programIdStr = process.env.TXTCEL_PROGRAM_ID?.trim()
if (!programIdStr) fail('TXTCEL_PROGRAM_ID is required.')

const connection = new Connection(rpcUrl, 'confirmed')

// 1. RPC reachable + cluster identity.
const genesisHash = await connection.getGenesisHash().catch((err) => fail(`RPC unreachable: ${err.message}`))
const CLUSTERS = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
}
console.log(`OK   RPC reachable (${CLUSTERS[genesisHash] ?? `custom cluster ${genesisHash}`})`)

// 2. Program exists and is executable.
const programId = new PublicKey(programIdStr)
const programInfo = await connection.getAccountInfo(programId)
if (!programInfo) fail(`Program ${programIdStr} not found on this cluster.`)
if (!programInfo.executable) fail(`Account ${programIdStr} exists but is not executable.`)
console.log(`OK   Program deployed: ${programIdStr}`)

// 3. Agent wallet parses and is funded (mirrors src/wallet.ts resolution).
const secret = process.env.TXTCEL_SECRET_KEY?.trim()
const keypairPath = process.env.TXTCEL_KEYPAIR?.trim()
if (!secret && !keypairPath) fail('Set TXTCEL_SECRET_KEY or TXTCEL_KEYPAIR (no implicit wallet fallback).')

let wallet
try {
  wallet = secret
    ? secret.startsWith('[')
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)))
      : Keypair.fromSecretKey(bs58.decode(secret))
    : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf-8'))))
} catch (err) {
  fail(`Agent wallet failed to load: ${err.message}`)
}

const lamports = await connection.getBalance(wallet.publicKey)
console.log(`OK   Agent wallet ${wallet.publicKey.toBase58()}: ${lamports / LAMPORTS_PER_SOL} SOL`)
if (lamports === 0) fail('Agent wallet has zero balance — it cannot pay fees or rent.')

console.log('PASS smoke test')
