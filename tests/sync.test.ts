import { describe, expect, it } from "vitest";
import { FieldArchive } from "../src/domain/archive";
import { SyncEngine, type FieldBatch, type Transport } from "../src/domain/sync";

function buildBase() {
  const archive = new FieldArchive();
  archive.addSite({ id: "S1", name: "浒湾遗址" });
  archive.addGrid({ id: "T0203", siteId: "S1", code: "T0203" });
  archive.addStratum({ id: "L3", gridId: "T0203", label: "第3层" });
  archive.addStratum({ id: "L4", gridId: "T0203", label: "第4层" });
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
  archive.logArtifact({
    id: "A1",
    gridId: "T0203",
    stratumId: "L3",
    coords: { x: 5, y: 5 },
    weightGrams: 100,
    pieces: 1,
    label: "陶片",
  });
  archive.logArtifact({
    id: "A2",
    gridId: "T0203",
    stratumId: "L3",
    coords: { x: 6, y: 6 },
    weightGrams: 200,
    pieces: 1,
    label: "兽骨",
  });
  archive.packArtifact("A2");
  return archive;
}

function makeBatch(): FieldBatch {
  return {
    id: "BATCH-T0203-20261006",
    gridId: "T0203",
    excavationDate: "2026-10-06",
    deviceId: "平板-07",
    records: [
      {
        kind: "artifact-logged",
        recordId: "R1",
        artifact: {
          id: "A3",
          gridId: "T0203",
          stratumId: "L3",
          coords: { x: 8, y: 8 },
          weightGrams: 50,
          pieces: 1,
          label: "玉饰",
        },
      },
      {
        // 与驻地档案中 A1 的坐标/层位不一致 → 冲突
        kind: "artifact-logged",
        recordId: "R2",
        artifact: {
          id: "A1",
          gridId: "T0203",
          stratumId: "L4",
          coords: { x: 9, y: 9 },
          weightGrams: 100,
          pieces: 1,
          label: "陶片",
        },
      },
      {
        kind: "transfer-signed",
        recordId: "R3",
        idempotencyKey: "TR-KEY-A2",
        items: [{ artifactId: "A2", basis: "位于 H12（灰坑）边界内，边界版本 v1", boundaryVersion: 1 }],
        signedBy: "领队",
        signedAt: "2026-10-06T19:00:00Z",
      },
    ],
  };
}

describe("断网批次同步", () => {
  it("新出土物入库，坐标/层位不一致的留两份待裁定", () => {
    const archive = buildBase();
    const engine = new SyncEngine(archive);
    const session = engine.syncBatch(makeBatch());

    expect(session.items.every((i) => i.status === "done")).toBe(true);
    expect(archive.artifacts.has("A3")).toBe(true);

    const conflict = archive.conflicts.get("A1");
    expect(conflict?.status).toBe("待裁定");
    expect(conflict?.versions).toHaveLength(2);
    expect(conflict?.versions[0].source).toBe("驻地档案");
    expect(conflict?.versions[1].stratumId).toBe("L4");
    // 冲突未裁定前，出土物标记待核
    expect(archive.mustArtifact("A1").attribution.status).toBe("待核");
  });

  it("领队裁定后采用选定版本并重算归属", () => {
    const archive = buildBase();
    const engine = new SyncEngine(archive);
    engine.syncBatch(makeBatch());

    archive.resolveConflict("A1", 1, "领队");
    const artifact = archive.mustArtifact("A1");
    expect(artifact.coords).toEqual({ x: 9, y: 9 });
    expect(artifact.stratumId).toBe("L4");
    expect(artifact.attribution.status).toBe("有效");
    expect(archive.conflicts.get("A1")?.status).toBe("已裁定");
    expect(archive.pendingConflicts()).toHaveLength(0);
  });

  it("移交记录按幂等键去重，整批重放不增加移交记录", () => {
    const archive = buildBase();
    const engine = new SyncEngine(archive);
    engine.syncBatch(makeBatch());
    expect(archive.transfers).toHaveLength(1);

    // 网络恢复后整个批次重放
    const replay = engine.syncBatch(makeBatch());
    // 同批次直接返回原会话；换引擎模拟驻地重启后重放
    expect(replay.items.filter((i) => i.status === "done")).toHaveLength(3);

    const engine2 = new SyncEngine(archive);
    const session2 = engine2.syncBatch(makeBatch());
    const transferItem = session2.items.find((i) => i.recordId === "R3")!;
    expect(transferItem.replayed).toBe(true);
    expect(archive.transfers).toHaveLength(1);
  });

  it("同步失败后只按未完成明细重试", () => {
    const archive = buildBase();
    const engine = new SyncEngine(archive);
    const batch = makeBatch();

    // 第一次同步：R3 移交时网络中断
    const flaky: Transport = (_b, record) => {
      if (record.kind === "transfer-signed") throw new Error("网络中断");
    };
    const session = engine.syncBatch(batch, flaky);
    expect(session.items.find((i) => i.recordId === "R3")?.status).toBe("failed");
    expect(session.items.find((i) => i.recordId === "R1")?.status).toBe("done");
    expect(archive.transfers).toHaveLength(0);

    // 重试只处理未完成明细，网络恢复后移交补登
    const retried = engine.retryIncomplete(batch);
    expect(retried.items.every((i) => i.status === "done")).toBe(true);
    expect(archive.transfers).toHaveLength(1);
    expect(archive.mustArtifact("A2").location).toBe("transferred");

    // 再次重试：没有未完成明细，移交记录不增加
    engine.retryIncomplete(batch);
    expect(archive.transfers).toHaveLength(1);
  });

  it("重放已登记的出土物且坐标层位一致时不产生冲突", () => {
    const archive = buildBase();
    const engine = new SyncEngine(archive);
    const batch: FieldBatch = {
      id: "BATCH-REPLAY",
      gridId: "T0203",
      excavationDate: "2026-10-06",
      deviceId: "平板-07",
      records: [
        {
          kind: "artifact-logged",
          recordId: "R1",
          artifact: {
            id: "A1",
            gridId: "T0203",
            stratumId: "L3",
            coords: { x: 5, y: 5 },
            weightGrams: 100,
            pieces: 1,
            label: "陶片",
          },
        },
      ],
    };
    const session = engine.syncBatch(batch);
    expect(session.items[0].replayed).toBe(true);
    expect(archive.conflicts.size).toBe(0);
  });
});
