import { describe, expect, it } from "vitest";
import { backfillLegacy, type LegacyEntry } from "../src/domain/legacy";

const artifact = {
  gridId: "T0203",
  stratumId: "L3",
  coords: { x: 1, y: 1 },
  weightGrams: 80,
  pieces: 1,
  label: "陶片",
};

describe("旧档案回填", () => {
  it("没有探方批次的按遗址和发掘日归并成批次", () => {
    const entries: LegacyEntry[] = [
      { id: "L1", siteId: "S1", gridCode: "T0203", excavationDate: "2026-09-01", artifact: { ...artifact, id: "LA1" } },
      { id: "L2", siteId: "S1", gridCode: "T0203", excavationDate: "2026-09-01", artifact: { ...artifact, id: "LA2" } },
      { id: "L3", siteId: "S1", gridCode: "T0204", excavationDate: "2026-09-02", artifact: { ...artifact, id: "LA3" } },
    ];
    const result = backfillLegacy(entries);
    expect(result.batches).toHaveLength(2);
    expect(result.assigned).toHaveLength(3);
    expect(result.pending).toHaveLength(0);

    const day1 = result.batches.find((b) => b.id === "LEGACY-S1-2026-09-01")!;
    expect(day1.records).toHaveLength(2);
    expect(day1.records.every((r) => r.kind === "artifact-logged")).toBe(true);
  });

  it("缺遗址、探方或发掘日的条目不归批，列入待核", () => {
    const entries: LegacyEntry[] = [
      { id: "L1", siteId: "S1", gridCode: "T0203", artifact: { ...artifact, id: "LA1" } },
      { id: "L2", gridCode: "T0203", excavationDate: "2026-09-01", artifact: { ...artifact, id: "LA2" } },
      { id: "L3", siteId: "S1", gridCode: "T0203", excavationDate: "2026-09-01", artifact: { ...artifact, id: "LA3" } },
    ];
    const result = backfillLegacy(entries);
    expect(result.assigned).toHaveLength(1);
    expect(result.pending).toHaveLength(2);
    expect(result.pending.find((p) => p.entryId === "L1")?.missing).toContain("发掘日");
    expect(result.pending.find((p) => p.entryId === "L2")?.missing).toContain("遗址");
  });
});
