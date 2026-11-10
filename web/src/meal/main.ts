import "../style.css";
import "./meal.css";
import { id as keccakText, parseUnits } from "ethers";
import QRCode from "qrcode";
import { ACTORS, ROLE_LABEL, actor, type ActorKey } from "./actors";
import {
  DECIMALS,
  addr,
  contractAlive,
  escapeHtml,
  exec,
  loadAccounts,
  provider,
  save,
  state,
  type ExecResult,
} from "./lab";
import { STEPS } from "./steps";
import { renderChain, renderLedger, renderResults } from "./views";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Results of steps run in this browser session, so earlier steps can be revisited. */
const results = new Map<number, ExecResult[]>();
let viewing = 0; // which step card is open
let busy = false;

// ---------------------------------------------------------------- refreshing side panels

let refreshQueued = false;
async function refreshViews() {
  if (refreshQueued) return;
  refreshQueued = true;
  try {
    await Promise.all([renderLedger(), renderChain()]);
  } catch (e) {
    console.error(e);
  } finally {
    refreshQueued = false;
  }
}

// ---------------------------------------------------------------- lesson

function renderStepList() {
  $("steps").innerHTML = STEPS.map((s, i) => {
    const cls = i < state.step ? "done" : i === state.step ? "current" : "todo";
    const mark = i < state.step ? "✓" : String(i);
    return `<li class="${cls} ${i === viewing ? "viewing" : ""}">
      <button data-step="${i}" ${i > state.step ? "disabled" : ""}><span class="n">${mark}</span>${s.title}</button></li>`;
  }).join("");
  $("steps").querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) => {
    b.onclick = () => { viewing = Number(b.dataset.step); renderStep(); };
  });
}

async function renderStep() {
  renderStepList();
  const card = $("stepCard");

  if (viewing >= STEPS.length) {
    card.innerHTML = `<h2>🎉 Dərs bitdi</h2>
      <p>Bütün dövrü keçdin: deploy → qeydiyyat → mint → ödəniş → qayda yoxlaması → redeem → bank təsdiqi → ay sonu.</p>
      <p>İndi aşağıdakı <b>Qaydaları sına</b> konsolunda özün eksperiment et: yeni ayda balans yüklə,
      Murad Şirvan Kabab-a ödəsin, Kənar şəxs ödəməyə çalışsın…</p>
      <p class="muted">Sağdakı blok zəncirinə bax: hər addımın izi orada qalıb və dəyişdirilə bilməz.</p>`;
    return;
  }

  const s = STEPS[viewing];
  const done = viewing < state.step;
  const signer = s.signer ? actor(s.signer) : null;
  const button = done
    ? `<span class="tag ok">tamamlandı</span>`
    : `<button id="runStep">▶ İcra et${signer ? ` · imzalayan: ${signer.name} (${ROLE_LABEL[signer.role]})` : ""}</button>`;
  const res = results.get(viewing);

  card.innerHTML = `
    <div class="stephead"><span class="badge">Addım ${viewing} / ${STEPS.length - 1}</span><h2>${s.title}</h2></div>
    <div class="explain">
      <div><div class="lbl">🏢 Real həyatda</div><p>${s.story}</p></div>
      <div><div class="lbl">⛓ Blokçeyndə</div><p>${s.chain}</p></div>
    </div>
    <div id="qr"></div>
    <div class="row">${button}</div>
    <div id="stepResults">${res ? renderResults(res) : ""}</div>
    ${res && s.look ? `<p class="look">👀 ${s.look}</p>` : ""}
    ${res && viewing === state.step - 1 && viewing + 1 <= STEPS.length
      ? `<div class="row"><button id="nextStep" class="secondary">Növbəti addım →</button></div>` : ""}`;

  if (s.showQr && state.charge) await renderQr();
  $("runStep")?.addEventListener("click", runCurrent);
  $("nextStep")?.addEventListener("click", () => { viewing = state.step; renderStep(); });
}

async function renderQr() {
  const c = state.charge!;
  const payload = JSON.stringify({ type: "meal-pay", restaurant: addr[c.restaurant], amount: c.amount, ref: c.ref });
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const url = await QRCode.toDataURL(payload, {
    margin: 1,
    width: 168,
    color: dark ? { dark: "#e6e8eb", light: "#181b21" } : { dark: "#1a1d23", light: "#ffffff" },
  });
  $("qr").innerHTML = `<div class="qrbox"><img src="${url}" alt="Ödəniş QR kodu" width="168" height="168">
    <div><div class="lbl">QR-ın içində nə var</div><pre class="mono small">${escapeHtml(JSON.stringify(JSON.parse(payload), null, 2))}</pre>
    <div class="muted small">${actor(c.restaurant).name} · ${c.amount} MEAL</div></div></div>`;
}

async function runCurrent() {
  if (busy) return;
  busy = true;
  const btn = $<HTMLButtonElement>("runStep");
  btn.disabled = true;
  btn.textContent = "⏳ Göndərilir…";
  const index = state.step;
  try {
    const res = await STEPS[index].run();
    results.set(index, res);
    // Advance only if nothing failed unexpectedly.
    if (res.every((r) => r.ok)) {
      state.step = index + 1;
      save();
    }
  } catch (e) {
    results.set(index, [{ title: STEPS[index].title, ok: false, events: [], error: (e as Error).message }]);
  } finally {
    busy = false;
  }
  viewing = index;
  await renderStep();
  await refreshViews();
  setConsoleEnabled();
}

// ---------------------------------------------------------------- rules console

type ActionKey = "pay" | "transfer" | "redeem" | "load" | "expire" | "registerRestaurant";
const ACTIONS: Record<ActionKey, { label: string; target?: boolean; amount?: boolean }> = {
  pay: { label: "pay — restorana ödə", target: true, amount: true },
  transfer: { label: "transfer — adi ERC20 köçürmə", target: true, amount: true },
  redeem: { label: "redeem — MEAL-ı pula çevir", amount: true },
  load: { label: "loadAllowance — Alfa MMC işçilərinə yüklə", amount: true },
  expire: { label: "expireBalances — işçi balanslarını yandır" },
  registerRestaurant: { label: "registerRestaurant — hədəfi restoran et", target: true },
};

function setupConsole() {
  const opts = ACTORS.map((a) => `<option value="${a.key}">${a.name} · ${ROLE_LABEL[a.role]}</option>`).join("");
  $("cSigner").innerHTML = opts;
  $("cTarget").innerHTML = opts;
  $("cAction").innerHTML = Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  $<HTMLSelectElement>("cSigner").value = "aysel";
  $<HTMLSelectElement>("cAction").value = "transfer";
  $<HTMLSelectElement>("cTarget").value = "murad";
  $("cAction").onchange = syncConsoleFields;
  $("cRun").onclick = runConsole;
  syncConsoleFields();
}

function syncConsoleFields() {
  const a = ACTIONS[$<HTMLSelectElement>("cAction").value as ActionKey];
  $("cTargetWrap").hidden = !a.target;
  $("cAmountWrap").hidden = !a.amount;
}

function setConsoleEnabled() {
  $<HTMLButtonElement>("cRun").disabled = !state.address || state.step === 0;
}

async function runConsole() {
  const signer = $<HTMLSelectElement>("cSigner").value as ActorKey;
  const target = addr[$<HTMLSelectElement>("cTarget").value as ActorKey];
  const action = $<HTMLSelectElement>("cAction").value as ActionKey;
  const amount = parseUnits($<HTMLInputElement>("cAmount").value || "0", DECIMALS);
  const title = `${actor(signer).name}: ${ACTIONS[action].label.split(" — ")[0]}`;

  const btn = $<HTMLButtonElement>("cRun");
  btn.disabled = true;
  const res = await exec(title, signer, (m) => {
    switch (action) {
      case "pay": return m.pay(target, amount, keccakText(`console-${Date.now()}`));
      case "transfer": return m.transfer.send(target, amount); // pure fn: force a real transaction
      case "redeem": return m.redeem(amount);
      case "load": return m.loadAllowance(addr.alfa, [addr.aysel, addr.murad], amount);
      case "expire": return m.expireBalances([addr.aysel, addr.murad]);
      case "registerRestaurant": return m.registerRestaurant(target, "Konsol restoranı");
    }
  });
  btn.disabled = false;
  $("cOut").innerHTML = renderResults([res]) + $("cOut").innerHTML;
  await refreshViews();
}

// ---------------------------------------------------------------- start

async function reset() {
  if (busy) return;
  state.address = null;
  state.step = 0;
  state.charge = null;
  save();
  results.clear();
  viewing = 0;
  $("cOut").innerHTML = "";
  await renderStep();
  await refreshViews();
  setConsoleEnabled();
}

async function start() {
  try {
    await provider.getBlockNumber();
  } catch {
    $("offline").hidden = false;
    return;
  }
  await loadAccounts();

  if (state.address && !(await contractAlive())) {
    // The node was restarted: the old contract is gone, start the lesson again.
    state.address = null;
    state.step = 0;
    state.charge = null;
    save();
  }
  viewing = Math.min(state.step, STEPS.length);

  setupConsole();
  setConsoleEnabled();
  $("reset").onclick = reset;
  await renderStep();
  await refreshViews();
  provider.on("block", refreshViews); // live updates, also from other tabs
}

start();
