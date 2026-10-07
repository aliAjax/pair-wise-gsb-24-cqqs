import { describe, expect, it } from "vitest";
import { FieldArchive } from "../src/domain/archive";

function buildArchive() {
  const archive = new FieldArchive();
  archive.addSite({ id: "S1", name: "浒湾遗址" });
  archive.addGrid({ id: "T0203", siteId: "S1", code: "T0203" });
  archive.addStratum({ id: "L3", gridId: "T0203", label: "第3层" });
  archive.addFeature({
    id: "H12",
    gridId: "T0203",
    stratumId: "L3",
    code: "H12",
    kind: "灰坑",
    boundary: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  });
  return archive;
}

function logArtifact(archive: FieldArchive, id: string, x: number, y: number) {
  return archive.logArtifact({
    id,
    gridId: "T0203",
    stratumId: "L3",
    coords: { x, y },
    weightGrams: 100,
    pieces: 1,
    label: `出土物${id}`,
  });
}

describe("归属计算", () => {
  it("落入遗迹边界的归遗迹，边界外的归地层", () => {
    const archive = buildArchive();
    const inside = logArtifact(archive, "A1", 5, 5);
    const outside = logArtifact(archive, "A2", 50, 50);
    expect(inside.attribution.featureId).toBe("H12");
    expect(inside.attribution.boundaryVersion).toBe(1);
    expect(outside.attribution.featureId).toBeNull();
    expect(outside.attribution.basis).toContain("第3层");
  });
});

describe("边界调整", () => {
  it("未装箱出土物归属立即失效重算，已装箱与已移交的保留原依据", () => {
    const archive = buildArchive();
    const boxed = logArtifact(archive, "A1", 5, 5);
    const transferred = logArtifact(archive, "A2", 6, 6);
    const loose = logArtifact(archive, "A3", 15, 5); // 边界外，归地层

    archive.packArtifact("A1");
    archive.packArtifact("A2");
    const { record } = archive.signTransfer({
      artifactIds: ["A2"],
      signedBy: "领队",
      signedAt: "2026-10-06T18:00:00Z",
      idempotencyKey: "TR-KEY-1",
    });
    const basisBefore = record.items[0].basis;

    // 边界外扩到 (0,0)-(20,10)：A3 落入 H12
    archive.adjustFeatureBoundary("H12", [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);

    // 未装箱：重算，归 H12 v2
    expect(loose.attribution.featureId).toBe("H12");
    expect(loose.attribution.boundaryVersion).toBe(2);
    expect(loose.attribution.status).toBe("有效");
    // 已装箱：保留装箱时归属
    expect(boxed.attribution.boundaryVersion).toBe(1);
    // 已签字移交：移交记录保留原依据
    expect(record.items[0].basis).toBe(basisBefore);
    expect(record.items[0].boundaryVersion).toBe(1);
    expect(transferred.location).toBe("transferred");
  });
});

describe("箱位排队", () => {
  it("按重量与件数限制装箱，装不下自动开新箱", () => {
    const archive = buildArchive();
    // 单箱上限 5000g / 20 件；这件 4000g 独占一箱后，剩余承重放不下第二件大的
    archive.logArtifact({
      id: "BIG1",
      gridId: "T0203",
      stratumId: "L3",
      coords: { x: 1, y: 1 },
      weightGrams: 4000,
      pieces: 2,
      label: "大陶罐",
    });
    archive.logArtifact({
      id: "BIG2",
      gridId: "T0203",
      stratumId: "L3",
      coords: { x: 2, y: 2 },
      weightGrams: 3000,
      pieces: 1,
      label: "大石斧",
    });
    const box1 = archive.packArtifact("BIG1");
    const box2 = archive.packArtifact("BIG2");
    expect(box1.id).not.toBe(box2.id);
    expect(box1.usedWeightGrams).toBe(4000);
    expect(box2.usedWeightGrams).toBe(3000);
  });

  it("箱位队列按剩余承重升序，优先填满快满的箱子", () => {
    const archive = buildArchive();
    archive.logArtifact({
      id: "P1",
      gridId: "T0203",
      stratumId: "L3",
      coords: { x: 1, y: 1 },
      weightGrams: 4500,
      pieces: 18,
      label: "陶片堆",
    });
    archive.logArtifact({
      id: "P2",
      gridId: "T0203",
      stratumId: "L3",
      coords: { x: 2, y: 2 },
      weightGrams: 600,
      pieces: 1,
      label: "小铜钱",
    });
    archive.packArtifact("P1");
    archive.packArtifact("P2"); // 开第二箱
    const queue = archive.boxQueue();
    expect(queue).toHaveLength(2);
    // 队首是剩余承重更小的箱子（先装满它）
    expect(queue[0].usedWeightGrams).toBe(4500);
  });
});

describe("签字移交", () => {
  it("未装箱不能移交", () => {
    const archive = buildArchive();
    logArtifact(archive, "A1", 5, 5);
    expect(() =>
      archive.signTransfer({
        artifactIds: ["A1"],
        signedBy: "领队",
        signedAt: "2026-10-06T18:00:00Z",
        idempotencyKey: "K1",
      }),
    ).toThrow(/未装箱/);
  });
});
