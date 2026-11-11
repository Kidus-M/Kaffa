import { describe, expect, it } from "vitest";
import { RULES_VERSION } from "@/config/policy";
import { evaluatePlot, type SourceResult } from "./status";
import { evaluateLot } from "./lots";

const src = (source: SourceResult["source"], lossHa = 0, alertCount = 0, available = true): SourceResult => ({
  source,
  available,
  lossHa,
  alertCount,
  datasetVersion: "test",
});
const clean = [src("gfw_loss"), src("gfw_alerts")];

describe("evaluatePlot", () => {
  it("clears a valid plot when every source is clean", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 1, results: clean });
    expect(r).toMatchObject({ status: "clear", agreement: 1, rulesVersion: RULES_VERSION });
  });

  it("blocks when loss reaches 10% of a small plot", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 1, results: [src("gfw_loss", 0.2), src("gfw_alerts")] });
    expect(r.status).toBe("blocked");
  });

  it("sends the same loss on a large plot to review, because the 0.5 ha cap is not reached", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 10, results: [src("gfw_loss", 0.2), src("gfw_alerts", 0, 1)] });
    expect(r.status).toBe("review");
  });

  it("blocks a large plot at 0.5 ha of loss", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 20, results: [src("gfw_loss", 0.5), src("gfw_alerts", 0, 3)] });
    expect(r.status).toBe("blocked");
  });

  it("sends alerts without measured loss to review", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 1, results: [src("gfw_loss"), src("gfw_alerts", 0, 2)] });
    expect(r.status).toBe("review");
    expect(r.reasons).toContain("sources_disagree");
    expect(r.agreement).toBe(0.5);
  });

  it("cannot clear a plot when a required source did not answer", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 1, results: [src("gfw_loss"), src("gfw_alerts", 0, 0, false)] });
    expect(r.status).toBe("not_checked");
    expect(r.reasons).toContain("missing_source:gfw_alerts");
  });

  it("still blocks on clear evidence of loss even if another source is down", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 1, results: [src("gfw_loss", 0.3), src("gfw_alerts", 0, 0, false)] });
    expect(r.status).toBe("blocked");
  });

  it("does not check a plot with invalid geometry", () => {
    expect(evaluatePlot({ geometryOk: false, areaHa: 1, results: clean }).status).toBe("not_checked");
  });

  it("counts an optional extra source in agreement without requiring it", () => {
    const r = evaluatePlot({ geometryOk: true, areaHa: 1, results: [...clean, src("whisp", 0, 0, false)] });
    expect(r.status).toBe("clear");
  });
});

describe("evaluateLot", () => {
  it("is ready when every plot is clear", () => {
    expect(evaluateLot([{ id: "a", status: "clear" }, { id: "b", status: "clear" }])).toEqual({ state: "ready", heldBy: [] });
  });

  it("is held by an unaccepted review plot, and released once a person accepts it", () => {
    expect(evaluateLot([{ id: "a", status: "clear" }, { id: "b", status: "review" }])).toEqual({ state: "held", heldBy: ["b"] });
    expect(evaluateLot([{ id: "b", status: "review", reviewAccepted: true }]).state).toBe("ready");
  });

  it("is always held by blocked or unchecked plots", () => {
    expect(evaluateLot([{ id: "a", status: "blocked", reviewAccepted: true }, { id: "c", status: "not_checked" }]).heldBy).toEqual([
      "a",
      "c",
    ]);
  });

  it("holds an empty lot", () => {
    expect(evaluateLot([]).state).toBe("held");
  });
});
