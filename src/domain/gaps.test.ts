import { describe, expect, it } from "vitest";
import { gapsForPlot } from "./gaps";

describe("gapsForPlot", () => {
  it("asks for a walked boundary when a polygon is required or the shape is broken", () => {
    expect(gapsForPlot({ issueCodes: ["polygon_required"], status: "not_checked", overlaps: false })).toEqual([
      { need: "boundary", reason: "polygon_required" },
    ]);
    expect(gapsForPlot({ issueCodes: ["self_intersection", "low_precision"], status: "not_checked", overlaps: false })).toEqual([
      { need: "boundary", reason: "self_intersection" },
    ]);
  });

  it("asks the field agent to confirm swapped coordinates on site", () => {
    expect(gapsForPlot({ issueCodes: ["swapped_coordinates"], status: "not_checked", overlaps: false })).toEqual([
      { need: "confirm", reason: "swapped_coordinates" },
    ]);
  });

  it("asks for a boundary re-walk when plots overlap, and photos for a review plot", () => {
    expect(gapsForPlot({ issueCodes: [], status: "clear", overlaps: true })).toEqual([{ need: "boundary", reason: "overlap" }]);
    expect(gapsForPlot({ issueCodes: [], status: "review", overlaps: false })).toEqual([{ need: "photo", reason: "review" }]);
  });

  it("opens nothing for a clean plot or for warnings and safely repairable issues", () => {
    expect(gapsForPlot({ issueCodes: ["low_precision", "ring_not_closed", "has_holes"], status: "clear", overlaps: false })).toEqual([]);
  });
});
