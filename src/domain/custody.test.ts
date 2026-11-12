import { describe, expect, it } from "vitest";
import { buildCustodyGraph, checkLotVolumes, plausibleKg } from "./custody";

const plots = [
  { id: "p1", ref: "KNG-001", farmerId: "f1", areaHa: 1, declaredAreaHa: 1 },
  { id: "p2", ref: "KNG-002", farmerId: "f2", areaHa: 0.5, declaredAreaHa: 0.5 },
];

describe("plausibleKg", () => {
  it("is area times regional yield times tolerance", () => {
    expect(plausibleKg(1)).toBe(1350);
    expect(plausibleKg(0)).toBe(0);
  });
});

describe("checkLotVolumes", () => {
  it("passes deliveries the plots could grow", () => {
    const deliveries = [
      { farmerId: "f1", plotId: "p1", siteId: "s", lotId: "L", kg: 1200 },
      { farmerId: "f2", plotId: "p2", siteId: "s", lotId: "L", kg: 600 },
    ];
    expect(checkLotVolumes({ lotId: "L", deliveries, plots })).toEqual([]);
  });

  it("flags a farmer who delivered more than their plots could grow", () => {
    const deliveries = [{ farmerId: "f2", plotId: "p2", siteId: "s", lotId: "L", kg: 2000 }];
    const [f] = checkLotVolumes({ lotId: "L", deliveries, plots });
    expect(f).toMatchObject({ kind: "volume_farmer", subjectId: "f2", deliveredKg: 2000, plausibleKg: 675 });
  });

  it("flags a supplier with no mapped plot", () => {
    const deliveries = [{ farmerId: "ghost", plotId: null, siteId: "s", lotId: "L", kg: 300 }];
    expect(checkLotVolumes({ lotId: "L", deliveries, plots }).map((f) => f.kind)).toEqual(["unmapped_supplier", "volume_lot"]);
  });

  it("ignores deliveries into other lots", () => {
    const deliveries = [{ farmerId: "f2", plotId: "p2", siteId: "s", lotId: "OTHER", kg: 9000 }];
    expect(checkLotVolumes({ lotId: "L", deliveries, plots })).toEqual([]);
  });
});

describe("buildCustodyGraph", () => {
  it("connects plots through collectors and washing stations to the lot and shipment, summing kilograms", () => {
    const g = buildCustodyGraph({
      lot: { id: "L", ref: "KNG-L1" },
      shipment: { id: "S", ref: "HAM-2612" },
      deliveries: [
        { farmerId: "f1", plotId: "p1", siteId: "col", lotId: "L", kg: 100 },
        { farmerId: "f2", plotId: "p2", siteId: "col", lotId: "L", kg: 50 },
      ],
      plots,
      sites: [
        { id: "col", kind: "collector", name: "Collector", parentId: "ws" },
        { id: "ws", kind: "washing_station", name: "Station", parentId: null },
      ],
      flaggedFarmers: new Set(["f2"]),
    });
    expect(g.nodes.map((n) => n.kind).sort()).toEqual(["collector", "lot", "plot", "plot", "shipment", "washing_station"]);
    expect(g.edges).toContainEqual({ from: "col", to: "ws", kg: 150 });
    expect(g.edges).toContainEqual({ from: "L", to: "S", kg: 150 });
    expect(g.nodes.find((n) => n.id === "p2")?.flagged).toBe(true);
  });
});
