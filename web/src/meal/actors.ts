/**
 * The lab's cast. Each one is a Hardhat test account (index = account number), so every
 * participant has their own key and signs their own transactions — just like in real life.
 */
export type Role = "issuer" | "company" | "employee" | "restaurant" | "outsider";

export const ACTORS = [
  { key: "issuer", name: "Emitent (sən)", role: "issuer", index: 0 },
  { key: "alfa", name: "Alfa MMC", role: "company", index: 1 },
  { key: "aysel", name: "Aysel", role: "employee", index: 2 },
  { key: "murad", name: "Murad", role: "employee", index: 3 },
  { key: "dadli", name: "Dadlı Ev", role: "restaurant", index: 4 },
  { key: "sirvan", name: "Şirvan Kabab", role: "restaurant", index: 5 },
  { key: "kenar", name: "Kənar şəxs", role: "outsider", index: 6 },
] as const satisfies readonly { key: string; name: string; role: Role; index: number }[];

export type ActorKey = (typeof ACTORS)[number]["key"];

export const ROLE_LABEL: Record<Role, string> = {
  issuer: "Emitent",
  company: "Şirkət",
  employee: "İşçi",
  restaurant: "Restoran",
  outsider: "Qeydiyyatsız",
};

export const actor = (key: ActorKey) => ACTORS.find((a) => a.key === key)!;
