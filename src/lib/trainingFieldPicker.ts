type Selection = { trainingFieldId: string | null; trainingFieldPieceIds: string[] };

export function toggleTrainingFieldPiece(current: Selection | undefined, fieldId: string, pieceId: string, allPieceIds: string[]): Selection {
  const previous = current?.trainingFieldId === fieldId && current.trainingFieldPieceIds.length > 0 ? current.trainingFieldPieceIds : [];
  let next = previous.includes(pieceId) ? previous.filter((id) => id !== pieceId) : [...previous, pieceId];
  if (next.length === 0) return { trainingFieldId: null, trainingFieldPieceIds: [] };
  if (next.length === allPieceIds.length) next = [];
  return { trainingFieldId: fieldId, trainingFieldPieceIds: next };
}
