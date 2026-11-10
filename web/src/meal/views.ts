import { ACTORS, ROLE_LABEL } from "./actors";
import {
  addr,
  describeLog,
  describeTx,
  escapeHtml,
  fmt,
  fmtDate,
  labelOf,
  meal,
  provider,
  short,
  state,
  type ExecResult,
} from "./lab";

const $ = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------- results of one step

export function renderResults(results: ExecResult[]): string {
  return results
    .map((r) => {
      const who = r.signer ? `<span class="who">${escapeHtml(labelOf(addr[r.signer]))} imzaladı</span>` : "";
      if (r.error) {
        const cls = r.expectedFail ? "res blocked" : "res failed";
        const head = r.expectedFail ? "🛡 Rədd edildi (gözlənilən)" : "✗ Xəta";
        return `<div class="${cls}"><div class="rt">${head}: ${escapeHtml(r.title)} ${who}</div>
          <div class="reason">${escapeHtml(r.error)}</div>
          ${r.expectedFail ? `<div class="muted">Zəncirə heç nə yazılmadı.</div>` : ""}</div>`;
      }
      const tx = r.txHash
        ? `<div class="kv mono">blok #${r.block} · tx ${short(r.txHash)} · gas ${r.gasUsed?.toLocaleString()}</div>`
        : "";
      const ev = r.events.length
        ? `<ul class="events">${r.events.map((e) => `<li class="mono">${escapeHtml(e)}</li>`).join("")}</ul>`
        : "";
      const note = r.note ? `<div class="muted">${escapeHtml(r.note)}</div>` : "";
      return `<div class="res ok"><div class="rt">✓ ${escapeHtml(r.title)} ${who}</div>${tx}${ev}${note}</div>`;
    })
    .join("");
}

// ---------------------------------------------------------------- ledger

export async function renderLedger() {
  const box = $("ledger");
  if (!state.address) {
    box.innerHTML = `<p class="muted">Kontrakt hələ deploy olunmayıb.</p>`;
    return;
  }
  const m = meal();
  const [supply, pending, liability, company, periodEnd, latest] = await Promise.all([
    m.totalSupply(),
    m.pendingPayouts(),
    m.totalLiability(),
    m.companies(addr.alfa),
    m.periodEnd(),
    provider.getBlock("latest"),
  ]);

  const rows = await Promise.all(
    ACTORS.filter((a) => a.role !== "issuer").map(async (a) => {
      const address = addr[a.key];
      const [balance, employer, isRest] = await Promise.all([
        m.balanceOf(address),
        m.employerOf(address),
        m.isRestaurant(address),
      ]);
      const registered =
        a.role === "company" ? company.active
        : a.role === "employee" ? employer !== "0x0000000000000000000000000000000000000000"
        : a.role === "restaurant" ? isRest
        : false;
      const extra =
        a.role === "company" && company.active
          ? `<div class="muted">borc ${fmt(company.debt)} / limit ${fmt(company.creditLimit)}</div>`
          : "";
      return `<tr class="${registered ? "" : "unreg"}">
        <td><b>${a.name}</b><div class="muted mono">${short(address)}</div>${extra}</td>
        <td><span class="role ${a.role}">${ROLE_LABEL[a.role]}</span>${registered || a.role === "outsider" ? "" : `<div class="muted">qeydiyyatsız</div>`}</td>
        <td class="num">${a.role === "company" ? "—" : fmt(balance)}</td>
      </tr>`;
    })
  );

  const chainTime = latest!.timestamp;
  const periodOver = chainTime > Number(periodEnd);
  box.innerHTML = `
    <div class="totals">
      <div><div class="k">Dövriyyədə (totalSupply)</div><div class="v">${fmt(supply)}</div></div>
      <div><div class="k">Gözləyən bank ödənişi</div><div class="v">${fmt(pending)}</div></div>
      <div class="hl"><div class="k">Ümumi öhdəliyin</div><div class="v">${fmt(liability)}</div></div>
      <div><div class="k">Şirkətlərin sənə borcu</div><div class="v">${fmt(company.debt)}</div></div>
    </div>
    <p class="muted small">Öhdəlik = dövriyyə + gözləyən ödəniş. Bu rəqəm zəncirdədir: restoran, şirkət və auditor
      onu sənə güvənmədən özü yoxlaya bilər.</p>
    <div class="tablewrap"><table class="ledger">
      <thead><tr><th>İştirakçı</th><th>Rol</th><th class="num">Balans</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>
    <p class="muted small">Zəncir vaxtı: <b>${fmtDate(chainTime)}</b> · Dövrün sonu: <b>${fmtDate(periodEnd)}</b>
      ${periodOver ? `<span class="tag warn">dövr bitib</span>` : ""}</p>`;
}

// ---------------------------------------------------------------- blockchain

const BLOCKS_SHOWN = 6;
const blockCache = new Map<string, string>(); // blocks never change, so render each once

async function renderBlock(n: number): Promise<{ html: string; hash: string; parent: string }> {
  const block = (await provider.getBlock(n, true))!;
  const key = `${state.address}:${block.hash}`;
  let body = blockCache.get(key);
  if (!body) {
    const txs = await Promise.all(
      block.prefetchedTransactions.map(async (tx) => {
        const rc = await provider.getTransactionReceipt(tx.hash);
        const events = (rc?.logs ?? []).map(describeLog).filter((x): x is string => !!x);
        return `<li><span class="who">${escapeHtml(labelOf(tx.from))}</span> →
          <span class="mono">${escapeHtml(describeTx(tx, rc?.contractAddress ?? null))}</span>
          ${events.map((e) => `<div class="ev mono">↳ ${escapeHtml(e)}</div>`).join("")}</li>`;
      })
    );
    body = txs.length ? `<ul class="txs">${txs.join("")}</ul>` : `<div class="muted small">0 tranzaksiya (boş blok)</div>`;
    blockCache.set(key, body);
  }
  return {
    hash: block.hash!,
    parent: block.parentHash,
    html: `<div class="bh"><b>Blok #${block.number}</b><span class="muted small">${fmtDate(block.timestamp)}</span></div>
      <div class="mono small">hash: <span class="h" title="${block.hash}">${short(block.hash!)}</span></div>
      <div class="mono small">əvvəlki: <span class="h" title="${block.parentHash}">${short(block.parentHash)}</span></div>
      ${body}`,
  };
}

export async function renderChain() {
  const latest = await provider.getBlockNumber();
  const numbers = Array.from({ length: Math.min(BLOCKS_SHOWN, latest + 1) }, (_, i) => latest - i);
  const blocks = await Promise.all(numbers.map(renderBlock));

  $("chain").innerHTML = blocks
    .map((b, i) => {
      const older = blocks[i + 1];
      const link = older
        ? b.parent === older.hash
          ? `<div class="link ok">⛓ “əvvəlki” = blok #${numbers[i + 1]}-in hash-i</div>`
          : `<div class="link bad">✗ zəncir qırılıb</div>`
        : "";
      return `<div class="block">${b.html}</div>${link}`;
    })
    .join("");
  $("height").textContent = `${latest + 1} blok`;
}
