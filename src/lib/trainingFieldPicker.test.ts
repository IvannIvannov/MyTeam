import { expect, it } from "vitest";
import { applyTrainingFieldToDates, toggleTrainingFieldPiece } from "./trainingFieldPicker";

it("deselecting the last available section clears the field instead of selecting occupied sections", () => {
  expect(toggleTrainingFieldPiece({ trainingFieldId: "field", trainingFieldPieceIds: ["free"] }, "field", "free", ["free", "occupied"]))
    .toEqual({ trainingFieldId: null, trainingFieldPieceIds: [] });
});

it("selects only the free section without expanding to the whole field", () => {
  expect(toggleTrainingFieldPiece(undefined, "field", "free", ["free", "occupied"]))
    .toEqual({ trainingFieldId: "field", trainingFieldPieceIds: ["free"] });
});

it("selects the whole field when all its sections have been selected", () => {
  expect(toggleTrainingFieldPiece({ trainingFieldId: "field", trainingFieldPieceIds: ["a"] }, "field", "b", ["a", "b"]))
    .toEqual({ trainingFieldId: "field", trainingFieldPieceIds: [] });
});

it("copies the selected sections to every date while keeping unselected days unchanged", () => {
  const current = { later: { trainingFieldId: "other", trainingFieldPieceIds: [] } };
  const selection = { trainingFieldId: "field", trainingFieldPieceIds: ["north"] };
  const result = applyTrainingFieldToDates(current, ["day1", "day2"], selection, [{ date: "day2", fieldId: "field", pieceIds: ["south"] }]);
  expect(result.conflictingDates).toEqual([]);
  expect(result.selections).toEqual({ ...current, day1: selection, day2: selection });
  expect(result.selections!.day1.trainingFieldPieceIds).not.toBe(result.selections!.day2.trainingFieldPieceIds);
});

it("does not apply anything when the chosen section is occupied on one selected day", () => {
  const current = { day1: { trainingFieldId: "other", trainingFieldPieceIds: [] } };
  const result = applyTrainingFieldToDates(current, ["day1", "day2"], { trainingFieldId: "field", trainingFieldPieceIds: ["north"] }, [{ date: "day2", fieldId: "field", pieceIds: ["north"] }]);
  expect(result).toEqual({ conflictingDates: ["day2"], selections: null });
  expect(current.day1.trainingFieldId).toBe("other");
});

it("rejects whole-field overlap in either direction, but ignores other fields and dates", () => {
  const occupied = [{ date: "day2", fieldId: "field", pieceIds: ["north"] }];
  expect(applyTrainingFieldToDates({}, ["day1", "day2"], { trainingFieldId: "field", trainingFieldPieceIds: [] }, occupied).conflictingDates).toEqual(["day2"]);
  expect(applyTrainingFieldToDates({}, ["day1", "day2"], { trainingFieldId: "field", trainingFieldPieceIds: ["south"] }, [{ ...occupied[0], pieceIds: [] }]).conflictingDates).toEqual(["day2"]);
  expect(applyTrainingFieldToDates({}, ["day1"], { trainingFieldId: "field", trainingFieldPieceIds: [] }, occupied).conflictingDates).toEqual([]);
  expect(applyTrainingFieldToDates({}, ["day2"], { trainingFieldId: "other", trainingFieldPieceIds: [] }, occupied).conflictingDates).toEqual([]);
});
