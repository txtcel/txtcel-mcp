// Mirrors ProtocolError in txtcel-program/src/error.rs. Program errors surface
// as `custom program error: 0x<hex>` in logs / SendTransactionError; we map the
// code back to a readable name + hint for the agent.
const PROTOCOL_ERRORS: Record<number, string> = {
  0: 'MissingSigner',
  1: 'NotWritable',
  2: 'InvalidTag',
  3: 'TextTooLong',
  4: 'AllocAlreadyLinked',
  5: 'SlotAlreadyUsed',
  6: 'InvalidCandidateCount',
  7: 'AccountOwnerMismatch',
  8: 'AccountAlreadyInitialized',
  9: 'InvalidAccountData',
  10: 'NoFreeSlot',
  11: 'InvalidShard',
  12: 'ThreadMismatch',
  13: 'InvalidPda',
  14: 'Unauthorized',
  15: 'InvalidTreasury',
  16: 'InvalidProgramAccount',
  17: 'AccessDenied',
  18: 'AccessListFull',
  19: 'AccessListDuplicate',
  20: 'AccessListMissing',
  21: 'MissingAccessAccount',
  22: 'InvalidFeeBps',
  23: 'InvalidAuthor',
  25: 'ZeroEntryFee',
  26: 'InvalidSlot',
  27: 'AccessListConflict',
  28: 'InvalidAllocSeq',
  29: 'NothingToSweep',
  30: 'AppendWindowExpired',
  31: 'FeeExceedsMax',
  32: 'AlreadyFollowing',
  33: 'NotFollowing',
  34: 'FollowListFull',
  35: 'ExtendNotAuthorized',
  36: 'InvalidWitness',
  37: 'WitnessSlotEmpty',
}

const HINTS: Record<string, string> = {
  AccessDenied: 'This channel is gated. Use request_access (if it has an entry fee) or ask the channel admin to whitelist your wallet.',
  Unauthorized: 'Your wallet is not the required authority for this operation (channel author or program admin).',
  FeeExceedsMax: 'The on-chain fee exceeded the slippage cap. Retry; if it persists the fee may have been raised.',
  AlreadyFollowing: 'The wallet already follows this channel.',
  NotFollowing: 'The wallet does not follow this channel.',
  ExtendNotAuthorized: 'Chain extension requires the channel author, a stale tail, or a witness proof of tail occupancy. Retry via send_message, which assembles the witness set automatically.',
  InvalidWitness: 'The witness set was malformed or stale. Re-read the channel and retry so a fresh witness set is built.',
  WitnessSlotEmpty: 'A witnessed slot was freed concurrently (raced with close_message). Retry — a fresh occupancy scan will pick new witnesses.',
}

function extractCustomCode(message: string): number | null {
  const m = message.match(/custom program error:\s*0x([0-9a-fA-F]+)/)
  if (m) return parseInt(m[1], 16)
  const m2 = message.match(/"Custom"\s*:\s*(\d+)/)
  if (m2) return parseInt(m2[1], 10)
  return null
}

/** Turns any thrown error into a readable message, decoding program codes. */
export function explainError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err)
  const code = extractCustomCode(base)
  if (code === null) return base

  const name = PROTOCOL_ERRORS[code]
  if (!name) return `${base} (unknown program error code ${code})`

  const hint = HINTS[name]
  return hint ? `${name}: ${hint}` : `${name} (program error)`
}
