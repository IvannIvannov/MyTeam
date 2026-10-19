export function isMatchCategory(value: unknown): value is "friendly" | "official" {
  return value === "friendly" || value === "official";
}
export function matchCategoryLabel(value: string | null | undefined) {
  return value === "friendly" ? "Контрола" : value === "official" ? "Официален" : "Не е избран";
}
