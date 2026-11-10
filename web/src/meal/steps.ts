import { id as keccakText, parseUnits } from "ethers";
import { MealToken__factory } from "../../../typechain-types";
import type { ActorKey } from "./actors";
import {
  DECIMALS,
  addr,
  chainNow,
  exec,
  fmt,
  meal,
  record,
  save,
  signerFor,
  state,
  timeTravel,
  type ExecResult,
} from "./lab";

const MEAL = (n: string | number) => parseUnits(String(n), DECIMALS);
const DAY = 24 * 3600;

export interface Step {
  title: string;
  /** Who signs, shown on the run button. */
  signer: ActorKey | null;
  /** What happens in the real business. */
  story: string;
  /** What happens on the blockchain, and which rule the contract checks. */
  chain: string;
  /** Short "look here" hint after the step ran. */
  look?: string;
  showQr?: boolean;
  run: () => Promise<ExecResult[]>;
}

export const STEPS: Step[] = [
  {
    title: "Kontraktı yerləşdir (deploy)",
    signer: "issuer",
    story:
      "Sistemi qurursan. Bütün qaydaları (kim token buraxa bilər, kim kimə ödəyə bilər) bir dəfə yazırsan və hamıya açıq elan edirsən.",
    chain: `Emitent MealToken-in <b>bytecode</b>-unu tranzaksiya ilə göndərir. Şəbəkə kontrakta yeni ünvan verir.
      Bu andan etibarən kod <b>dəyişmir</b>, çünki onu yeniləyən funksiya yoxdur. Konstruktor ilk dövrün sonunu
      (30 gün sonra) yazır. Emitent avtomatik <code>owner</code> olur.`,
    look: "Sağdakı “Blok zənciri” panelində yeni blok yarandı. İçində yalnız bir tranzaksiya var: deploy.",
    async run() {
      const signer = await signerFor("issuer");
      const periodEnd = BigInt((await chainNow()) + 30 * DAY);
      const contract = await new MealToken__factory(signer).deploy(periodEnd);
      state.address = await contract.getAddress();
      save();
      const res = await record("MealToken deploy", "issuer", contract.deploymentTransaction()!);
      const size = (MealToken__factory.bytecode.length - 2) / 2;
      res.note = `Kontraktın ünvanı: ${state.address}. Bytecode ölçüsü: ${size.toLocaleString()} bayt.`;
      return [res];
    },
  },
  {
    title: "Şirkəti qeydiyyata al",
    signer: "issuer",
    story: "Alfa MMC ilə müqavilə imzaladın. Şirkət ayda 1000 manata qədər kredit limiti alır.",
    chain: `<code>registerCompany</code> funksiyasını yalnız Emitent çağıra bilər (<code>onlyOwner</code>).
      Kredit limiti kontraktın yaddaşına yazılır. Bundan sonra bu şirkət üçün limitdən çox token buraxmaq
      <b>kodla</b> mümkünsüzdür, hətta Emitent özü üçün də.`,
    run: async () => [
      await exec("Alfa MMC qeydiyyatı", "issuer", (m) => m.registerCompany(addr.alfa, "Alfa MMC", MEAL(1000))),
    ],
  },
  {
    title: "İşçiləri əlavə et",
    signer: "issuer",
    story: "Alfa MMC iki işçisinin siyahısını göndərir: Aysel və Murad.",
    chain: `Hər işçinin <b>ünvanı</b> şirkətə bağlanır (<code>employerOf</code>). İşçinin adı, soyadı, FİN-i zəncirə
      yazılmır, çünki zəncir açıqdır. “Ad ↔ ünvan” uyğunluğu sənin bazanda qalır. Hər qeydiyyat ayrıca tranzaksiyadır.`,
    run: async () => [
      await exec("Aysel → Alfa MMC", "issuer", (m) => m.registerEmployee(addr.aysel, addr.alfa)),
      await exec("Murad → Alfa MMC", "issuer", (m) => m.registerEmployee(addr.murad, addr.alfa)),
    ],
  },
  {
    title: "Restoranları əlavə et",
    signer: "issuer",
    story: "İki restoranla partnyorluq müqaviləsi bağladın.",
    chain: `<code>isRestaurant</code> siyahısına düşən ünvanlar MEAL qəbul edə bilir. Siyahıda olmayan
      heç kim, nə dost, nə qonşu, nə də fırıldaqçı, bu tokeni qəbul edə bilməz.`,
    run: async () => [
      await exec("Dadlı Ev", "issuer", (m) => m.registerRestaurant(addr.dadli, "Dadlı Ev")),
      await exec("Şirvan Kabab", "issuer", (m) => m.registerRestaurant(addr.sirvan, "Şirvan Kabab")),
    ],
  },
  {
    title: "Ay başı: balans yüklə (mint)",
    signer: "issuer",
    story: "Hər işçinin app-inə 150 manat düşür.",
    chain: `300 MEAL <b>yaranır</b> (mint). Bundan əvvəl kontrakt yoxlayır: <i>borc 0 + 300 ≤ limit 1000?</i> Bəli.
      Alfa MMC-nin borcu 300 olur. Sağdakı “Dəftər”də <b>dövriyyədəki token = 300</b>: bu, restoranlar
      qarşısında sənin öhdəliyindir və hər kəs onu görə bilir.`,
    look: "Hadisələrdə “Transfer(∅ → Aysel…) · mint” sətrinə bax. Mint “heç kimdən” (sıfır ünvandan) köçürmədir.",
    run: async () => [
      await exec("150 MEAL × 2 işçi", "issuer", (m) =>
        m.loadAllowance(addr.alfa, [addr.aysel, addr.murad], MEAL(150))
      ),
    ],
  },
  {
    title: "Restoran QR göstərir",
    signer: null,
    showQr: true,
    story: "Aysel nahar etdi. Dadlı Ev-in kassası 12.50 manatlıq hesab üçün QR kod göstərir.",
    chain: `Bu addımda blokçeynə <b>heç nə yazılmır</b>. QR sadəcə məlumat daşıyır: restoranın ünvanı, məbləğ və
      hesabın nömrəsi (<code>ref</code>). Ona görə QR yaratmaq pulsuz və anidir. Yazma yalnız ödəniş anında olacaq.`,
    async run() {
      state.charge = { restaurant: "dadli", amount: "12.50", ref: `DADLI-${Date.now().toString().slice(-6)}` };
      save();
      return [{ title: "QR yaradıldı", ok: true, events: [], note: "Zəncirə heç nə yazılmadı, yeni blok yoxdur." }];
    },
  },
  {
    title: "İşçi QR-ı oxudur və ödəyir",
    signer: "aysel",
    showQr: true,
    story: "Aysel telefonla QR-ı oxudur və “Ödə” düyməsini basır.",
    chain: `Tranzaksiyanı <b>Ayselin öz açarı</b> imzalayır. Kontrakt <code>pay()</code> içində 4 qaydanı yoxlayır:
      Aysel işçidir? Dadlı Ev partnyordur? Dövr bitməyib? Balans çatır? Hamısı ✓ olduğu üçün 12.50 MEAL Ayseldən Dadlı Ev-ə keçir.
      <b>Dövriyyədəki token dəyişmir</b>: token yox olmur, sadəcə yer dəyişir.`,
    async run() {
      const c = state.charge ?? { restaurant: "dadli" as const, amount: "12.50", ref: "DADLI-000000" };
      return [
        await exec(`Aysel → ${c.ref}`, "aysel", (m) => m.pay(addr[c.restaurant], MEAL(c.amount), keccakText(c.ref))),
      ];
    },
  },
  {
    title: "Qaydaları pozmağa cəhd et",
    signer: null,
    story: `Aysel tokenlərinin bir hissəsini Murada nağd pula satmaq istəyir. Emitent isə limitdən artıq token buraxmağa çalışır.`,
    chain: `Hər iki tranzaksiya <b>rədd ediləcək</b>. Node tranzaksiyanı bloka salmazdan əvvəl simulyasiya edir,
      <code>require</code>-in pozulduğunu görür və onu qəbul etmir. Zəncirə heç nə yazılmır, yeni blok yaranmır.
      Diqqət et: <b>Emitent də</b> qaydanı keçə bilmir.`,
    look: "Blok zənciri dəyişmədi: rədd olunan tranzaksiyalar heç vaxt bloka düşmür.",
    run: async () => [
      await exec("Aysel → Murad: adi transfer 50 MEAL", "aysel", // `transfer` is `pure` in the contract, so ethers would only *read* it; `.send` forces a real transaction.
        (m) => m.transfer.send(addr.murad, MEAL(50)), {
        expectRevert: true,
      }),
      await exec("Aysel → Kənar şəxs: pay 10 MEAL", "aysel", (m) => m.pay(addr.kenar, MEAL(10), keccakText("x")), {
        expectRevert: true,
      }),
      await exec(
        "Emitent: hər işçiyə daha 400 MEAL (borc 300 + 800 > 1000)",
        "issuer",
        (m) => m.loadAllowance(addr.alfa, [addr.aysel, addr.murad], MEAL(400)),
        { expectRevert: true }
      ),
    ],
  },
  {
    title: "Restoran tokenləri təhvil verir (redeem)",
    signer: "dadli",
    story: "Ay ərzində yığılan MEAL-ları Dadlı Ev pula çevirmək istəyir.",
    chain: `Restoranın MEAL-ı <b>yandırılır</b> (burn) və dövriyyədəki token azalır. Amma <code>pendingPayouts</code>
      artır, çünki sən hələ bankla pul köçürməmisən. <b>Ümumi öhdəlik</b> (dövriyyə + gözləyən ödəniş) dəyişmir:
      borc sadəcə bir formadan digərinə keçir.`,
    async run() {
      const balance = await meal().balanceOf(addr.dadli);
      return [await exec(`Dadlı Ev: ${fmt(balance)} redeem`, "dadli", (m) => m.redeem(balance))];
    },
  },
  {
    title: "Bank köçürməsini təsdiqlə",
    signer: "issuer",
    story: "Mühasibat Dadlı Ev-ə bankdan 12.50 AZN köçürür (komissiya varsa, çıxılır).",
    chain: `<b>Vacib dərs:</b> blokçeyn bank köçürməsini özü görə bilmir, çünki bank zəncirdən kənardadır (off-chain).
      Emitent yalnız “ödədim” qeydini və bank referansını yazır. Kontrakt təmin edir ki, eyni ödəniş
      <b>iki dəfə</b> təsdiqlənməsin. Real pul ilə zəncir arasındakı bu körpüyə <b>oracle problemi</b> deyilir.`,
    run: async () => [await exec("Redeem #0 → BANK-2026-0001", "issuer", (m) => m.confirmPayout(0, "BANK-2026-0001"))],
  },
  {
    title: "Şirkət fakturanı ödəyir",
    signer: "issuer",
    story: "Alfa MMC aylıq fakturanı (300 AZN) bankla ödədi.",
    chain: `Şirkətin borcu 300-dən 0-a düşür, kredit limiti yenidən açılır. Yenə: bank köçürməsi zəncirdən kənardadır,
      zəncirdə yalnız qeyd və referans qalır. Bu qeyd artıq <b>silinə və ya dəyişdirilə bilməz</b>.`,
    run: async () => [
      await exec("Alfa MMC: 300 MEAL ödəndi", "issuer", (m) => m.recordCompanyPayment(addr.alfa, MEAL(300), "BANK-ALFA-11")),
    ],
  },
  {
    title: "Ay bitir: vaxtı irəli çək, qalığı yandır",
    signer: "issuer",
    story: "Ay bitdi. Müqaviləyə görə istifadə olunmamış balanslar yanır və yeni ay başlayır.",
    chain: `Bu addımdan <b>əvvəl</b> <code>expireBalances</code> çağırılsa, kontrakt “Period not over” deyib rədd edər
      (aşağıdakı konsolda yoxla). Hardhat-da vaxtı süni şəkildə 31 gün irəli çəkirik (<code>evm_increaseTime</code>).
      Real şəbəkədə bunu <b>heç kim</b> edə bilməz. Sonra işçilərin qalığı yanır. Restoranların qazandığı MEAL yanmır.`,
    look: "Boş blok (0 tranzaksiya) gördün? O, vaxt dəyişəndən sonra yeni vaxtla çıxarılan blokdur (evm_mine).",
    async run() {
      await timeTravel(31 * DAY);
      const travelled: ExecResult = {
        title: "⏩ Vaxt 31 gün irəli çəkildi",
        ok: true,
        events: [],
        note: "Yalnız test şəbəkəsində mümkündür. Yeni boş blok çıxarıldı.",
      };
      const expired = await exec("Aysel və Murad: qalığı yandır", "issuer", (m) =>
        m.expireBalances([addr.aysel, addr.murad])
      );
      const next = BigInt((await chainNow()) + 30 * DAY);
      const started = await exec("Yeni dövr: +30 gün", "issuer", (m) => m.startNewPeriod(next));
      return [travelled, expired, started];
    },
  },
];
