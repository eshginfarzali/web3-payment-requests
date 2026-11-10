import "./style.css";
import {
  BrowserProvider,
  JsonRpcProvider,
  formatUnits,
  getAddress,
  id as keccakText,
  isAddress,
  parseUnits,
  type Eip1193Provider,
  type Signer,
} from "ethers";
import {
  MockUSD__factory,
  PaymentRequests__factory,
  type MockUSD,
  type PaymentRequests,
} from "../../typechain-types";
import deploymentsJson from "./deployments.json";

// ---------- types & config ----------

type Deployment = { network: string; mockUSD: string; paymentRequests: string };
const deployments = deploymentsJson as Record<string, Deployment>;

interface InjectedWallet extends Eip1193Provider {
  on(event: string, handler: (...args: unknown[]) => void): void;
}
declare global {
  interface Window { ethereum?: InjectedWallet }
}

const LOCAL_RPC = "http://127.0.0.1:8545";
const CHAINS: Record<string, { name: string; hex: string; add?: object }> = {
  "31337": {
    name: "Hardhat Localhost",
    hex: "0x7a69",
    add: {
      chainId: "0x7a69",
      chainName: "Hardhat Localhost",
      rpcUrls: [LOCAL_RPC],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
  },
  "11155111": { name: "Sepolia", hex: "0xaa36a7" },
};

/** Mirrors `enum Status` in PaymentRequests.sol. */
enum Status { Pending = 0, Paid = 1, Cancelled = 2 }

const MAX_ROWS = 50;
const DECIMALS = 18;

// ---------- state ----------

type Session = {
  signer: Signer;
  me: string;
  chainId: string;
  token: MockUSD;
  pr: PaymentRequests;
  knownAccounts: string[]; // local test accounts, for friendly labels
};
let session: Session | null = null;
let localProvider: JsonRpcProvider | null = null;

// ---------- small DOM helpers ----------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function log(msg: string, isError = false) {
  const line = document.createElement("div");
  if (isError) line.className = "err";
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $("log").prepend(line);
}

function errorText(e: unknown): string {
  const err = e as { code?: string; reason?: string; shortMessage?: string; message?: string };
  if (err.code === "ACTION_REJECTED") return "İmza rədd edildi";
  return err.reason ?? err.shortMessage ?? err.message ?? String(e);
}

// The chain stores only a hash of the note; keep readable text in this browser.
const notes: Record<string, string> = (() => {
  try { return JSON.parse(localStorage.getItem("notes") ?? "{}"); } catch { return {}; }
})();
function saveNote(hash: string, text: string) {
  notes[hash] = text;
  try { localStorage.setItem("notes", JSON.stringify(notes)); } catch { /* storage unavailable */ }
}

function label(addr: string): string {
  if (!session) return short(addr);
  const i = session.knownAccounts.indexOf(addr);
  const name = i >= 0 ? `Hesab ${i}` : short(addr);
  return addr === session.me ? `${name} (sən)` : name;
}

// ---------- connecting ----------

async function connect() {
  session = null;
  setEnabled(false);
  $("switch").hidden = true;
  const mode = $<HTMLSelectElement>("mode").value;
  $("accountWrap").hidden = mode !== "local";
  $("connect").hidden = mode !== "metamask";

  try {
    if (mode === "local") await connectLocal();
    else await connectMetaMask(false);
  } catch (e) {
    log(`Qoşulmaq alınmadı: ${errorText(e)}`, true);
    renderEmpty("Qoşulmayıb");
  }
}

async function connectLocal() {
  localProvider ??= new JsonRpcProvider(LOCAL_RPC);
  const accounts = (await localProvider.listAccounts()).slice(0, 5).map((s) => s.address);

  const select = $<HTMLSelectElement>("account");
  const previous = select.value;
  select.innerHTML = accounts.map((a, i) => `<option value="${a}">Hesab ${i} · ${short(a)}</option>`).join("");
  if (accounts.includes(previous)) select.value = previous;

  const signer = await localProvider.getSigner(select.value);
  await startSession(signer, "31337", accounts);
}

async function connectMetaMask(requestAccess: boolean) {
  if (!window.ethereum) {
    log("MetaMask tapılmadı. Brauzerə MetaMask əlavə et: https://metamask.io", true);
    renderEmpty("MetaMask yoxdur");
    return;
  }
  const provider = new BrowserProvider(window.ethereum);
  const method = requestAccess ? "eth_requestAccounts" : "eth_accounts";
  const accounts: string[] = await provider.send(method, []);
  if (accounts.length === 0) {
    renderEmpty("“MetaMask qoş” düyməsini bas");
    return;
  }
  const signer = await provider.getSigner();
  const { chainId } = await provider.getNetwork();
  // On localhost, still show "Hesab N" labels for the known Hardhat accounts.
  const known = chainId === 31337n ? await localAccounts() : [];
  await startSession(signer, chainId.toString(), known);
}

async function localAccounts(): Promise<string[]> {
  try {
    localProvider ??= new JsonRpcProvider(LOCAL_RPC);
    return (await localProvider.listAccounts()).slice(0, 5).map((s) => s.address);
  } catch {
    return [];
  }
}

async function startSession(signer: Signer, chainId: string, knownAccounts: string[]) {
  const me = await signer.getAddress();
  const chainName = CHAINS[chainId]?.name ?? `chainId ${chainId}`;
  $("network").textContent = chainName;
  $("me").textContent = short(me);
  $("me").title = me;

  const deployment = deployments[chainId];
  if (!deployment) {
    log(`${chainName} şəbəkəsində kontrakt deploy olunmayıb.`, true);
    showNetworkSwitch();
    renderEmpty("Bu şəbəkədə kontrakt yoxdur");
    $("balance").textContent = "—";
    return;
  }

  session = {
    signer,
    me,
    chainId,
    knownAccounts,
    token: MockUSD__factory.connect(deployment.mockUSD, signer),
    pr: PaymentRequests__factory.connect(deployment.paymentRequests, signer),
  };

  $("knownAccounts").innerHTML = knownAccounts
    .filter((a) => a !== me)
    .map((a, i) => `<option value="${a}">Hesab ${knownAccounts.indexOf(a) ?? i}</option>`)
    .join("");
  const payer = $<HTMLInputElement>("payer");
  if (!payer.value || payer.value === me) payer.value = knownAccounts.find((a) => a !== me) ?? "";

  setEnabled(true);
  log(`Qoşuldu: ${chainName}, ${label(me)} · PaymentRequests ${short(deployment.paymentRequests)}`);
  await refresh();
}

function showNetworkSwitch() {
  const box = $("switch");
  const targets = Object.keys(deployments).filter((id) => CHAINS[id]);
  if ($<HTMLSelectElement>("mode").value !== "metamask" || targets.length === 0) return;
  box.innerHTML = targets
    .map((id) => `<button class="secondary" data-chain="${id}">${CHAINS[id].name} şəbəkəsinə keç</button>`)
    .join("");
  box.hidden = false;
  box.querySelectorAll<HTMLButtonElement>("[data-chain]").forEach((b) => {
    b.onclick = () => switchChain(b.dataset.chain!);
  });
}

async function switchChain(chainId: string) {
  const chain = CHAINS[chainId];
  try {
    await window.ethereum!.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.hex }] });
  } catch (e) {
    // 4902 = MetaMask doesn't know this chain yet; add it (only possible for localhost here).
    if ((e as { code?: number }).code === 4902 && chain.add) {
      await window.ethereum!.request({ method: "wallet_addEthereumChain", params: [chain.add] });
    } else {
      log(errorText(e), true);
    }
  }
  // chainChanged listener reconnects.
}

function setEnabled(on: boolean) {
  for (const id of ["create", "mint"]) $<HTMLButtonElement>(id).disabled = !on;
}

// ---------- reading ----------

function renderEmpty(text: string) {
  $("requests").innerHTML = `<tr><td colspan="8" class="sub">${escapeHtml(text)}</td></tr>`;
}

let refreshing = false;
async function refresh() {
  if (!session || refreshing) return;
  refreshing = true;
  const { token, pr, me } = session;
  try {
    $("balance").textContent = formatUnits(await token.balanceOf(me), DECIMALS);

    const count = Number(await pr.nextRequestId());
    const ids = Array.from({ length: Math.min(count, MAX_ROWS) }, (_, i) => count - 1 - i);
    const rows = await Promise.all(ids.map(async (rid) => ({ rid, r: await pr.requests(rid) })));
    const now = Math.floor(Date.now() / 1000);

    const html = rows.map(({ rid, r }) => {
      const status = Number(r.status) as Status;
      const due = Number(r.dueDate);
      const overdue = status === Status.Pending && due !== 0 && now > due;
      const [tagClass, tagText] = overdue
        ? ["overdue", "Vaxtı keçib"]
        : status === Status.Paid ? ["paid", "Ödənilib"]
        : status === Status.Cancelled ? ["cancelled", "Ləğv edilib"]
        : ["pending", "Gözləyir"];

      const actions: string[] = [];
      if (status === Status.Pending && r.payer === me && !overdue)
        actions.push(`<button data-pay="${rid}">Ödə</button>`);
      if (status === Status.Pending && r.creator === me)
        actions.push(`<button class="danger" data-cancel="${rid}">Ləğv et</button>`);

      const note = notes[r.referenceHash];
      const mine = r.payer === me || r.creator === me;
      return `<tr class="${mine ? "mine" : ""}">
        <td>${rid}</td>
        <td>${label(r.creator)}</td>
        <td>${label(r.payer)}</td>
        <td>${formatUnits(r.amount, DECIMALS)}</td>
        <td class="mono" title="${r.referenceHash}">${note ? escapeHtml(note) : short(r.referenceHash)}</td>
        <td>${due ? new Date(due * 1000).toLocaleString() : "—"}</td>
        <td><span class="tag ${tagClass}">${tagText}</span></td>
        <td>${actions.join("")}</td>
      </tr>`;
    });

    if (html.length) $("requests").innerHTML = html.join("");
    else renderEmpty("Hələ sorğu yoxdur");

    $("requests").querySelectorAll<HTMLButtonElement>("[data-pay]").forEach((b) => {
      b.onclick = () => pay(Number(b.dataset.pay), b);
    });
    $("requests").querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach((b) => {
      b.onclick = () => cancel(Number(b.dataset.cancel), b);
    });
  } catch (e) {
    log(`Oxumaq alınmadı: ${errorText(e)}`, true);
  } finally {
    refreshing = false;
  }
}

// ---------- writing (transactions) ----------

/** Runs a transaction-sending action with button locking and logging. */
async function withTx(button: HTMLButtonElement, action: () => Promise<void>) {
  button.disabled = true;
  try {
    await action();
    await refresh();
  } catch (e) {
    log(`✗ ${errorText(e)}`, true);
  } finally {
    button.disabled = false;
  }
}

async function createRequest() {
  const s = session!;
  await withTx($("create"), async () => {
    const payerInput = $<HTMLInputElement>("payer").value.trim();
    if (!isAddress(payerInput)) throw new Error("Ödəyicinin ünvanı düzgün deyil");
    const payer = getAddress(payerInput);
    const amount = parseUnits($<HTMLInputElement>("amount").value || "0", DECIMALS);
    const note = $<HTMLInputElement>("note").value;
    const dueValue = $<HTMLInputElement>("dueDate").value;
    const dueDate = dueValue ? BigInt(Math.floor(new Date(dueValue).getTime() / 1000)) : 0n;

    const hash = keccakText(note);
    saveNote(hash, note);
    log(`createRequest → ${label(payer)}, ${formatUnits(amount, DECIMALS)} mUSD${dueDate ? ", son tarix " + dueValue : ""}`);
    const tx = await s.pr.createRequest(payer, await s.token.getAddress(), amount, hash, dueDate);
    log(`  tx göndərildi ${short(tx.hash)}, təsdiq gözlənilir…`);
    const rc = await tx.wait();
    log(`✓ Sorğu yaradıldı (blok ${rc?.blockNumber})`);
  });
}

async function pay(requestId: number, button: HTMLButtonElement) {
  const s = session!;
  await withTx(button, async () => {
    const r = await s.pr.requests(requestId);
    const spender = await s.pr.getAddress();

    // Only ask for approval if the existing allowance is not enough.
    if ((await s.token.allowance(s.me, spender)) < r.amount) {
      log(`approve: kontrakta ${formatUnits(r.amount, DECIMALS)} mUSD xərcləmə icazəsi`);
      await (await s.token.approve(spender, r.amount)).wait();
    }
    log(`payRequest(${requestId})`);
    const tx = await s.pr.payRequest(requestId);
    const rc = await tx.wait();
    log(`✓ Ödənildi (blok ${rc?.blockNumber}, tx ${short(tx.hash)})`);
  });
}

async function cancel(requestId: number, button: HTMLButtonElement) {
  const s = session!;
  await withTx(button, async () => {
    log(`cancelRequest(${requestId})`);
    const rc = await (await s.pr.cancelRequest(requestId)).wait();
    log(`✓ Ləğv edildi (blok ${rc?.blockNumber})`);
  });
}

async function mint() {
  const s = session!;
  await withTx($("mint"), async () => {
    log("mint: 100 test mUSD");
    await (await s.token.mint(s.me, parseUnits("100", DECIMALS))).wait();
    log("✓ 100 mUSD əlavə olundu");
  });
}

// ---------- wiring ----------

$("mode").onchange = connect;
$("account").onchange = connect;
$("connect").onclick = () => connectMetaMask(true).catch((e) => log(errorText(e), true));
$("create").onclick = createRequest;
$("mint").onclick = mint;
$("refresh").onclick = refresh;

window.ethereum?.on("accountsChanged", () => { if ($<HTMLSelectElement>("mode").value === "metamask") connect(); });
window.ethereum?.on("chainChanged", () => { if ($<HTMLSelectElement>("mode").value === "metamask") connect(); });

// Pick up payments made by other people / tabs.
setInterval(refresh, 8000);

connect();
