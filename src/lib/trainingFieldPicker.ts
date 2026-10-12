type Selection = { trainingFieldId: string | null; trainingFieldPieceIds: string[] };

export function applyTrainingFieldToDates(current: Record<string, Selection>, dates: string[], selection: Selection, occupied: { date: string; fieldId: string; pieceIds: string[] }[]) {
  if (!selection.trainingFieldId) throw new Error("Изберете терен и позиции за текущия ден.");
  const conflictingDates = [...new Set(occupied.filter((resource) => dates.includes(resource.date) && resource.fieldId === selection.trainingFieldId &&
    (!selection.trainingFieldPieceIds.length || !resource.pieceIds.length || selection.trainingFieldPieceIds.some((id) => resource.pieceIds.includes(id))))
    .map((resource) => resource.date))].sort();
  if (conflictingDates.length) return { conflictingDates, selections: null };
  const selections = { ...current };
  for (const date of dates) selections[date] = { trainingFieldId: selection.trainingFieldId, trainingFieldPieceIds: [...selection.trainingFieldPieceIds] };
  return { conflictingDates, selections };
}

export function toggleTrainingFieldPiece(current: Selection | undefined, fieldId: string, pieceId: string, allPieceIds: string[]): Selection {
  const previous = current?.trainingFieldId === fieldId && current.trainingFieldPieceIds.length > 0 ? current.trainingFieldPieceIds : [];
  let next = previous.includes(pieceId) ? previous.filter((id) => id !== pieceId) : [...previous, pieceId];
  if (next.length === 0) return { trainingFieldId: null, trainingFieldPieceIds: [] };
  if (next.length === allPieceIds.length) next = [];
  return { trainingFieldId: fieldId, trainingFieldPieceIds: next };
}
