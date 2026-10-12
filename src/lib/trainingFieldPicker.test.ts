import { expect, it } from "vitest";
import { toggleTrainingFieldPiece } from "./trainingFieldPicker";

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
