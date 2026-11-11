/**
 * Every compliance threshold and timing in one versioned place.
 * Values marked "design choice" are not legal figures; see the solution design.
 */

/** Stored on every check so a status can be traced to the rules that produced it. */
export const RULES_VERSION = "2026-11-11.1";

/** EUDR deforestation cut-off date. */
export const CUTOFF_DATE = "2020-12-31";

/** Blocked when loss after the cut-off is at least min(BLOCK_FRACTION x plot area, BLOCK_HA). Design choice. */
export const BLOCK_FRACTION = 0.1;
export const BLOCK_HA = 0.5;

/** EUDR: plots above 4 ha need a polygon. The EU system assumes 4 ha for a point with no Area. */
export const POLYGON_REQUIRED_ABOVE_HA = 4;
export const POINT_DEFAULT_HA = 4;

/** Warn when a declared area differs from the mapped area by more than this fraction. Design choice. */
export const AREA_MISMATCH_FRACTION = 0.2;

/** Sanity box for Ethiopia, used to catch swapped or wrong coordinates. */
export const ETHIOPIA_BBOX = { minLat: 3.4, maxLat: 14.9, minLon: 33.0, maxLon: 48.0 } as const;

/** GPS points less accurate than this are dropped from a boundary walk. Design choice. */
export const WALK_MAX_ACCURACY_M = 25;

/** Chase workflow timings and limits. Design choices. */
export const CHASE_REMINDER_HOURS = 48;
export const CHASE_ESCALATE_HOURS = 96;
export const DAILY_MESSAGE_CAP = 5;

/** Forecast simulation settings. */
export const FORECAST_RUNS = 10_000;
export const FORECAST_SEED = 42;
export const FORECAST_PRIOR_DAYS = [1, 2, 3, 5, 8];
export const FORECAST_MIN_SAMPLES = 3;

/** A plot cannot be cleared unless all of these sources answered. */
export const REQUIRED_SOURCES = ["gfw_loss", "gfw_alerts"] as const;

/** EU information system limit per due diligence statement. */
export const EU_MAX_GEOJSON_BYTES = 25 * 1024 * 1024;
