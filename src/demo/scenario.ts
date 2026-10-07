import { FieldArchive } from "../domain/archive";
import { backfillLegacy, type BackfillResult, type LegacyEntry } from "../domain/legacy";
import { SyncEngine, type FieldBatch, type Transport } from "../domain/sync";

export interface DemoState {
  archive: FieldArchive;
  engine: SyncEngine;
  batch: FieldBatch;
  legacyEntries: LegacyEntry[];
  backfill: BackfillResult | null;
}

/** 构造演示档案：浒湾遗址 T0203 探方，H12 灰坑 + F2 房址 */
export function createDemo(): DemoState {
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
  archive.addFeature({
    id: "F2",
    gridId: "T0203",
    stratumId: "L3",
    code: "F2",
    kind: "房址",
    boundary: [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
    ],
  });

  const seed = [
    { id: "A1", label: "陶片 12 件", x: 5, y: 5, weightGrams: 1200, pieces: 12 },
    { id: "A2", label: "兽骨", x: 7, y: 8, weightGrams: 800, pieces: 3 },
    { id: "A3", label: "石斧", x: 25, y: 5, weightGrams: 2600, pieces: 1 },
    { id: "A4", label: "陶纺轮", x: 15, y: 5, weightGrams: 300, pieces: 1 },
  ];
  for (const s of seed) {
    archive.logArtifact({
      id: s.id,
      gridId: "T0203",
      stratumId: "L3",
      coords: { x: s.x, y: s.y },
      weightGrams: s.weightGrams,
      pieces: s.pieces,
      label: s.label,
    });
  }

  // 断网期间平板-07 上记的探方批次
  const batch: FieldBatch = {
    id: "BATCH-T0203-20261006",
    gridId: "T0203",
    excavationDate: "2026-10-06",
    deviceId: "平板-07",
    records: [
      {
        kind: "artifact-logged",
        recordId: "R1",
        artifact: {
          id: "A5",
          gridId: "T0203",
          stratumId: "L3",
          coords: { x: 8, y: 9 },
          weightGrams: 50,
          pieces: 1,
          label: "玉饰",
        },
      },
      {
        // 平板上 A2 的层位/坐标与驻地不一致 → 冲突待裁定
        kind: "artifact-logged",
        recordId: "R2",
        artifact: {
          id: "A2",
          gridId: "T0203",
          stratumId: "L4",
          coords: { x: 9, y: 4 },
          weightGrams: 800,
          pieces: 3,
          label: "兽骨",
        },
      },
      {
        // 驻地已签过的移交，同步时重放 → 不新增记录
        kind: "transfer-signed",
        recordId: "R3",
        idempotencyKey: "TR-KEY-A1",
        items: [{ artifactId: "A1", basis: "位于 H12（灰坑）边界内，边界版本 v1", boundaryVersion: 1 }],
        signedBy: "领队",
        signedAt: "2026-10-06T18:30:00Z",
      },
      {
        // 平板上新签的移交（A3 石斧），第一次同步会遇上网络中断
        kind: "transfer-signed",
        recordId: "R4",
        idempotencyKey: "TR-KEY-A3",
        items: [{ artifactId: "A3", basis: "位于 F2（房址）边界内，边界版本 v1", boundaryVersion: 1 }],
        signedBy: "领队",
        signedAt: "2026-10-06T19:10:00Z",
      },
    ],
  };

  const legacyEntries: LegacyEntry[] = [
    {
      id: "L1",
      siteId: "S1",
      gridCode: "T0203",
      excavationDate: "2026-09-01",
      artifact: {
        id: "LA1",
        gridId: "T0203",
        stratumId: "L3",
        coords: { x: 3, y: 3 },
        weightGrams: 90,
        pieces: 2,
        label: "旧档陶片一",
      },
    },
    {
      id: "L2",
      siteId: "S1",
      gridCode: "T0203",
      excavationDate: "2026-09-01",
      artifact: {
        id: "LA2",
        gridId: "T0203",
        stratumId: "L3",
        coords: { x: 4, y: 2 },
        weightGrams: 60,
        pieces: 1,
        label: "旧档陶片二",
      },
    },
    {
      // 缺发掘日 → 待核
      id: "L3",
      siteId: "S1",
      gridCode: "T0203",
      artifact: {
        id: "LA3",
        gridId: "T0203",
        stratumId: "L3",
        coords: { x: 2, y: 6 },
        weightGrams: 40,
        pieces: 1,
        label: "旧档残片",
      },
    },
  ];

  return { archive, engine: new SyncEngine(archive), batch, legacyEntries, backfill: null };
}

/** 第一次同步用的不稳定链路：TR-KEY-A3 移交时网络中断 */
export const flakyTransport: Transport = (_batch, record) => {
  if (record.kind === "transfer-signed" && record.idempotencyKey === "TR-KEY-A3") {
    throw new Error("网络中断：移交明细未送达");
  }
};

export function runBackfill(demo: DemoState): void {
  demo.backfill = backfillLegacy(demo.legacyEntries);
}
