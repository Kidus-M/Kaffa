import type { MultiPolygon, Point, Polygon, Position } from "geojson";

export type { MultiPolygon, Point, Polygon, Position };
export type LonLat = [number, number];
export type PlotGeometry = Point | Polygon | MultiPolygon;
export type AreaGeometry = Polygon | MultiPolygon;

export type IssueCode =
  | "missing_geometry"
  | "invalid_type"
  | "out_of_bounds"
  | "swapped_coordinates"
  | "low_precision"
  | "polygon_required"
  | "ring_not_closed"
  | "too_few_vertices"
  | "self_intersection"
  | "has_holes"
  | "duplicate_vertices"
  | "degenerate_after_truncation"
  | "area_mismatch";

export type Issue = { code: IssueCode; severity: "error" | "warning"; message: string };

export type PlotStatus = "clear" | "review" | "blocked" | "not_checked";
