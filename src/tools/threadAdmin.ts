import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PublicKey } from '@solana/web3.js'
import { z } from 'zod'
import {
  N_AUTHOR_FEE_SHARDS,
  buildAddToBlacklistInstruction,
  buildAddToFeeWhitelistInstruction,
  buildAddToWhitelistInstruction,
  buildInitThreadAccessInstruction,
  buildRemoveFromBlacklistInstruction,
  buildRemoveFromFeeWhitelistInstruction,
  buildRemoveFromWhitelistInstruction,
  buildSetEntryFeeInstruction,
  buildSetLikeFeeInstruction,
  buildSetMessageFeeInstruction,
  buildSetThreadAccessInstruction,
  buildSweepAuthorFeesInstruction,
  deriveAccessPda,
  deriveThreadPda,
} from '@txtcel/protocol'
import { loadConfig } from '../config.js'
import { loadWallet } from '../wallet.js'
import { resolveSeed } from '../seed.js'
import { sendInstructions, explorerTx } from '../tx.js'
import { handler, jsonResult, toLamports } from '../result.js'

const channelArg = z
  .string()
  .describe('Channel reference: a 64-char hex seed (rootAllocId) or a base58 thread address.')

const walletArg = z.string().describe('Target wallet address (base58).')

const feeArg = z.union([z.number(), z.string()]).describe('Fee amount in lamports.')

export function registerThreadAdminTools(server: McpServer): void {
  server.registerTool(
    'init_thread_access',
    {
      title: 'Init thread access',
      description:
        'Initialize the access-control record for a channel (one-time). Only the channel author may do this.',
      inputSchema: {
        channel: channelArg,
        enabled: z.boolean().describe('Whether gating is enabled on creation.'),
      },
    },
    handler(async ({ channel, enabled }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildInitThreadAccessInstruction(programId, payer.publicKey, seed, enabled)
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'set_thread_access',
    {
      title: 'Set thread access',
      description: 'Enable or disable gating on a channel. Only the channel author/admin may do this.',
      inputSchema: { channel: channelArg, enabled: z.boolean() },
    },
    handler(async ({ channel, enabled }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildSetThreadAccessInstruction(
        programId,
        payer.publicKey,
        deriveAccessPda(programId, seed),
        enabled,
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'set_entry_fee',
    {
      title: 'Set entry fee',
      description: 'Set the paid-entry fee (lamports) for a gated channel.',
      inputSchema: { channel: channelArg, fee: feeArg },
    },
    handler(async ({ channel, fee }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildSetEntryFeeInstruction(
        programId,
        payer.publicKey,
        deriveAccessPda(programId, seed),
        toLamports(fee),
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'set_message_fee',
    {
      title: 'Set message fee',
      description: 'Set the per-message fee (lamports) non-authors pay to post in a channel.',
      inputSchema: { channel: channelArg, fee: feeArg },
    },
    handler(async ({ channel, fee }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildSetMessageFeeInstruction(
        programId,
        payer.publicKey,
        deriveThreadPda(programId, seed),
        toLamports(fee),
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  server.registerTool(
    'set_like_fee',
    {
      title: 'Set like fee',
      description: 'Set the per-like fee (lamports) for a channel.',
      inputSchema: { channel: channelArg, fee: feeArg },
    },
    handler(async ({ channel, fee }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const ix = buildSetLikeFeeInstruction(
        programId,
        payer.publicKey,
        deriveThreadPda(programId, seed),
        toLamports(fee),
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )

  const aclTool = (
    name: string,
    title: string,
    description: string,
    build: (programId: PublicKey, authority: PublicKey, seed: Uint8Array, wallet: PublicKey) => ReturnType<typeof buildAddToWhitelistInstruction>,
  ) => {
    server.registerTool(
      name,
      { title, description, inputSchema: { channel: channelArg, wallet: walletArg } },
      handler(async ({ channel, wallet }) => {
        const { programId } = loadConfig()
        const payer = loadWallet()
        const seed = resolveSeed(channel)
        const ix = build(programId, payer.publicKey, seed, new PublicKey(wallet))
        const signature = await sendInstructions(payer, [ix])
        return jsonResult({ signature, explorer: explorerTx(signature) })
      }),
    )
  }

  aclTool('add_to_whitelist', 'Add to whitelist', 'Allow a wallet to post in a gated channel.', buildAddToWhitelistInstruction)
  aclTool('remove_from_whitelist', 'Remove from whitelist', 'Remove a wallet from a channel whitelist.', buildRemoveFromWhitelistInstruction)
  aclTool('add_to_blacklist', 'Add to blacklist', 'Block a wallet from posting in a channel.', buildAddToBlacklistInstruction)
  aclTool('remove_from_blacklist', 'Remove from blacklist', 'Unblock a wallet in a channel.', buildRemoveFromBlacklistInstruction)
  aclTool('add_to_fee_whitelist', 'Add to fee whitelist', 'Exempt a wallet from the per-message fee in a channel.', buildAddToFeeWhitelistInstruction)
  aclTool('remove_from_fee_whitelist', 'Remove from fee whitelist', 'Remove a wallet fee exemption in a channel.', buildRemoveFromFeeWhitelistInstruction)

  server.registerTool(
    'sweep_author_fees',
    {
      title: 'Sweep author fees',
      description:
        'Sweep accumulated author fees for a channel into the author wallet (the agent wallet must be the channel author).',
      inputSchema: {
        channel: channelArg,
        shardIndices: z
          .array(z.number().int().min(0).max(N_AUTHOR_FEE_SHARDS - 1))
          .optional()
          .describe(`Author-fee shard indices to sweep (0..${N_AUTHOR_FEE_SHARDS - 1}). Default: all.`),
      },
    },
    handler(async ({ channel, shardIndices }) => {
      const { programId } = loadConfig()
      const payer = loadWallet()
      const seed = resolveSeed(channel)
      const shards = shardIndices ?? Array.from({ length: N_AUTHOR_FEE_SHARDS }, (_, i) => i)
      const ix = buildSweepAuthorFeesInstruction(
        programId,
        seed,
        deriveThreadPda(programId, seed),
        payer.publicKey,
        shards,
      )
      const signature = await sendInstructions(payer, [ix])
      return jsonResult({ signature, explorer: explorerTx(signature) })
    }),
  )
}
