export const MATCH_EVENT_TYPES = {
  match: "Мач",
  duel: "Двубой",
  competition: "Състезание",
  participation: "Участие",
} as const;

export type MatchEventType = keyof typeof MATCH_EVENT_TYPES;

export function isMatchEventType(value: unknown): value is MatchEventType {
  return typeof value === "string" && Object.hasOwn(MATCH_EVENT_TYPES, value);
}

export function matchEventTypeLabel(value?: string | null): string {
  return isMatchEventType(value) ? MATCH_EVENT_TYPES[value] : MATCH_EVENT_TYPES.match;
}
