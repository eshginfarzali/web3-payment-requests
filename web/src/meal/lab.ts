import {
  JsonRpcProvider,
  ZeroAddress,
  formatUnits,
  type ContractTransactionResponse,
  type JsonRpcSigner,
  type Log,
  type TransactionResponse,
} from "ethers";
import { MealToken__factory, type MealToken } from "../../../typechain-types";
import { LOCAL_RPC_URL } from "../shared/rpc";
import { ACTORS, type ActorKey } from "./actors";

// ---------------------------------------------------------------- connection

export const provider = new JsonRpcProvider(LOCAL_RPC_URL, undefined, { pollingInterval: 1000 });
export const mealInterface = MealToken__factory.createInterface();
export const DECIMALS = 2;

export const addr = {} as Record<ActorKey, string>;

export async function loadAccounts() {
  const accounts = await provider.listAccounts();
  for (const a of ACTORS) addr[a.key] = accounts[a.index].address;
}

export const signerFor = (key: ActorKey): Promise<JsonRpcSigner> => provider.getSigner(addr[key]);

export async function chainNow(): Promise<number> {
  return (await provider.getBlock("latest"))!.timestamp;
}

/** Hardhat-only: move the chain clock forward. Impossible on a real network. */
export async function timeTravel(seconds: number) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

// ---------------------------------------------------------------- saved lab state

export interface Charge { restaurant: ActorKey; amount: string; ref: string }
interface Saved { address: string | null; step: number; charge: Charge | null }

const KEY = "meal-lab";
export const state: Saved = (() => {
  try {
    return { address: null, step: 0, charge: null, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { address: null, step: 0, charge: null };
  }
})();
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function meal(): MealToken {
  if (!state.address) throw new Error("Kontrakt hələ deploy olunmayıb");
  return MealToken__factory.connect(state.address, provider);
}

/** True if the saved contract still exists (it disappears when `npm run node` restarts). */
export async function contractAlive(): Promise<boolean> {
  return !!state.address && (await provider.getCode(state.address)) !== "0x";
}

// ---------------------------------------------------------------- formatting

export const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function fmt(v: bigint): string {
  const [i, d = ""] = formatUnits(v, DECIMALS).split(".");
  return `${i}.${d.padEnd(2, "0")} MEAL`;
}

export const fmtDate = (unix: number | bigint) =>
  new Date(Number(unix) * 1000).toLocaleString("az-AZ", { dateStyle: "short", timeStyle: "short" });

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function labelOf(address: string): string {
  if (address === ZeroAddress) return "∅";
  if (state.address && address.toLowerCase() === state.address.toLowerCase()) return "MealToken";
  const a = ACTORS.find((x) => addr[x.key]?.toLowerCase() === address.toLowerCase());
  return a ? a.name : short(address);
}

function fmtValue(name: string, type: string, v: unknown): string {
  if (type === "address") return labelOf(v as string);
  if (type === "address[]") return `[${(v as string[]).map(labelOf).join(", ")}]`;
  if (type.startsWith("uint")) {
    if (/period/i.test(name)) return fmtDate(v as bigint);
    if (/^id$/i.test(name)) return String(v);
    return fmt(v as bigint);
  }
  if (type === "bytes32") return short(v as string);
  if (type === "string") return `"${v}"`;
  return String(v);
}

function fmtCall(name: string, inputs: readonly { name: string; type: string }[], args: readonly unknown[]) {
  return `${name}(${inputs.map((p, i) => fmtValue(p.name, p.type, args[i])).join(", ")})`;
}

/** Turns a MealToken log into "Transfer(∅ → Aysel, 150.00 MEAL)"-style text. */
export function describeLog(log: Log): string | null {
  if (!state.address || log.address.toLowerCase() !== state.address.toLowerCase()) return null;
  const parsed = mealInterface.parseLog(log);
  if (!parsed) return null;
  if (parsed.name === "Transfer") {
    const [from, to, value] = parsed.args as unknown as [string, string, bigint];
    const kind = from === ZeroAddress ? " · mint" : to === ZeroAddress ? " · burn" : "";
    return `Transfer(${labelOf(from)} → ${labelOf(to)}, ${fmt(value)})${kind}`;
  }
  return fmtCall(parsed.name, parsed.fragment.inputs, parsed.args);
}

/** Turns a transaction into "loadAllowance(Alfa MMC, [Aysel, Murad], 150.00 MEAL)". */
export function describeTx(tx: TransactionResponse, contractAddress: string | null): string {
  if (!tx.to) {
    return state.address && contractAddress?.toLowerCase() === state.address.toLowerCase()
      ? "MealToken kontraktını deploy et"
      : "Başqa kontraktın deploy-u (Dərs 1)";
  }
  if (!state.address || tx.to.toLowerCase() !== state.address.toLowerCase()) {
    return `Başqa kontrakt ilə əməliyyat (${short(tx.to)})`;
  }
  const parsed = mealInterface.parseTransaction({ data: tx.data, value: tx.value });
  return parsed ? fmtCall(parsed.name, parsed.fragment.inputs, parsed.args) : "naməlum";
}

// ---------------------------------------------------------------- errors

const REASONS: Record<string, string> = {
  "Not an employee": "İmzalayan şəxs qeydiyyatlı işçi deyil",
  "Not a partner restaurant": "Bu ünvan partnyor restoran deyil",
  "Transfers disabled: use pay()": "Adi köçürmə bağlıdır: MEAL yalnız restoranda pay() ilə xərclənə bilər",
  "Credit limit exceeded": "Şirkətin kredit limiti aşılır",
  "Period ended": "Dövr bitib, xərcləmək və yükləmək olmaz",
  "Period not over": "Dövr hələ bitməyib, balansları yandırmaq olmaz",
  "Already paid out": "Bu ödəniş artıq təsdiqlənib",
  "Not an employee of this company": "Bu şəxs həmin şirkətin işçisi deyil",
  "Address already has a role": "Bu ünvanın artıq rolu var",
  "Unknown company": "Şirkət qeydiyyatda deyil",
  "Amount must be positive": "Məbləğ müsbət olmalıdır",
  "Invalid amount": "Məbləğ düzgün deyil",
  "Unknown redemption": "Belə redeem yoxdur",
  OwnableUnauthorizedAccount: "Bu funksiyanı yalnız Emitent (owner) çağıra bilər",
  ERC20InsufficientBalance: "Balans kifayət etmir",
};

export function explainError(e: unknown): string {
  const err = e as { reason?: string | null; revert?: { name?: string }; shortMessage?: string; message?: string };
  const raw =
    err.reason ??
    err.revert?.name ??
    err.message?.match(/reverted with reason string '([^']+)'/)?.[1] ??
    err.message?.match(/reverted with custom error '(\w+)/)?.[1] ??
    err.shortMessage ??
    err.message ??
    String(e);
  return REASONS[raw] ? `${REASONS[raw]} (“${raw}”)` : raw;
}

// ---------------------------------------------------------------- running transactions

export interface ExecResult {
  title: string;
  signer?: ActorKey;
  ok: boolean;
  expectedFail?: boolean;
  txHash?: string;
  block?: number;
  gasUsed?: bigint;
  events: string[];
  error?: string;
  note?: string;
}

/** Waits for a sent transaction and collects what landed on-chain. */
export async function record(title: string, signer: ActorKey, tx: TransactionResponse): Promise<ExecResult> {
  const rc = (await tx.wait())!;
  return {
    title,
    signer,
    ok: true,
    txHash: tx.hash,
    block: rc.blockNumber,
    gasUsed: rc.gasUsed,
    events: rc.logs.map(describeLog).filter((x): x is string => !!x),
  };
}

/**
 * Sends one MealToken call as `signer`. If the contract rejects it, nothing is written
 * on-chain: the node simulates the call first and refuses to include it.
 */
export async function exec(
  title: string,
  signer: ActorKey,
  call: (m: MealToken) => Promise<ContractTransactionResponse>,
  opts: { expectRevert?: boolean } = {}
): Promise<ExecResult> {
  try {
    const m = meal().connect(await signerFor(signer));
    const res = await record(title, signer, await call(m));
    if (opts.expectRevert) res.note = "⚠️ Gözlənilirdi ki, rədd olunsun, amma keçdi.";
    return res;
  } catch (e) {
    return { title, signer, ok: !!opts.expectRevert, expectedFail: opts.expectRevert, events: [], error: explainError(e) };
  }
}
