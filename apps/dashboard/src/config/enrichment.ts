// Centralized enrichment UI config
// Reads from Vite env (VITE_HIGH_QUALITY_MATCH) with a safe default

export const HIGH_QUALITY_MATCH: number = (() => {
  const raw = (import.meta as any)?.env?.VITE_HIGH_QUALITY_MATCH;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 && num <= 1 ? num : 0.75;
})();

export default {
  HIGH_QUALITY_MATCH,
};
