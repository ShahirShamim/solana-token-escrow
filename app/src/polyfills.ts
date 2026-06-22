// Must run BEFORE @solana/web3.js or @coral-xyz/anchor are imported: those
// modules reference Node's `Buffer`/`process` at evaluation time. Importing
// this module first (see main.tsx) guarantees the globals exist in time.
import { Buffer } from 'buffer'

globalThis.Buffer = globalThis.Buffer || Buffer
;(globalThis as unknown as { process?: { env: Record<string, string> } }).process ??= { env: {} }
