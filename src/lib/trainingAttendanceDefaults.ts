export function trainingRequiresCheckIn(workflow: string | null | undefined): boolean {
  return workflow === "training_credits" || workflow === "training_credits_30_days";
}
