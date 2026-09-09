export type UnitsPreference = "metric" | "imperial";

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inch: number) => inch * CM_PER_IN;

export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = cmToIn(cm);
  const ft = Math.floor(totalIn / 12);
  const inches = totalIn - ft * 12;
  return { ft, in: inches };
}

export function ftInToCm(ft: number, inches: number): number {
  return inToCm(ft * 12 + inches);
}

export function formatWeight(kg: number, pref: UnitsPreference, decimals = 1): string {
  if (!Number.isFinite(kg) || kg === 0) return "—";
  if (pref === "imperial") return `${kgToLb(kg).toFixed(decimals)} lb`;
  return `${kg.toFixed(decimals)} kg`;
}

export function formatWeightDelta(kg: number, pref: UnitsPreference, decimals = 1): string {
  if (!Number.isFinite(kg)) return "—";
  const sign = kg > 0 ? "+" : kg < 0 ? "−" : "";
  const abs = Math.abs(kg);
  if (pref === "imperial") return `${sign}${kgToLb(abs).toFixed(decimals)} lb`;
  return `${sign}${abs.toFixed(decimals)} kg`;
}

export function formatHeight(cm: number, pref: UnitsPreference): string {
  if (!Number.isFinite(cm) || cm === 0) return "—";
  if (pref === "imperial") {
    const { ft, in: inches } = cmToFtIn(cm);
    return `${ft}′${Math.round(inches)}″`;
  }
  return `${Math.round(cm)} cm`;
}

export const weightUnitLabel = (pref: UnitsPreference) => (pref === "imperial" ? "lb" : "kg");
export const heightUnitLabel = (pref: UnitsPreference) => (pref === "imperial" ? "in" : "cm");
