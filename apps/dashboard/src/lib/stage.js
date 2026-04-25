export const DEFAULT_STAGE_OPTIONS = ['new', 'contacted', 'qualifying', 'accepted', 'denied'];

export function stageLabel(stage = '') {
  return String(stage)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
