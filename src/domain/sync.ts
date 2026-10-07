import { FieldArchive, type ArtifactDraft } from "./archive";
import type { Point, TransferItem } from "./types";

/** 断网期间在平板上产生的一条现场记录 */
export type FieldRecord =
  | { kind: "artifact-logged"; recordId: string; artifact: ArtifactDraft }
  | { kind: "boundary-adjusted"; recordId: string; featureId: string; boundary: Point[] }
  | {
      kind: "transfer-signed";
      recordId: string;
      idempotencyKey: string;
      items: TransferItem[];
      signedBy: string;
      signedAt: string;
    };

/** 探方批次：同一探方、同一发掘日、同一台设备的断网记录打包同步 */
export interface FieldBatch {
  id: string;
  gridId: string;
  excavationDate: string;
  deviceId: string;
  records: FieldRecord[];
}

export type SyncItemStatus = "pending" | "done" | "failed";

export interface SyncItem {
  recordId: string;
  status: SyncItemStatus;
  /** 重放时被幂等键挡下、未产生新记录 */
  replayed: boolean;
  error?: string;
}

export interface SyncSession {
  batchId: string;
  items: SyncItem[];
}

/** 模拟驻地接收端：抛错即视为这条明细同步失败 */
export type Transport = (batch: FieldBatch, record: FieldRecord) => void;

export const reliableTransport: Transport = () => {};

/**
 * 同步引擎：按探方批次合并断网记录。
 * - 同一出土物坐标或层位两边不同 → 两份都留，登记冲突待领队裁定；
 * - 移交记录按幂等键去重，重放不新增；
 * - 失败的明细留在会话里，retry 只重试未完成明细。
 */
export class SyncEngine {
  private readonly sessions = new Map<string, SyncSession>();

  constructor(private readonly archive: FieldArchive) {}

  syncBatch(batch: FieldBatch, transport: Transport = reliableTransport): SyncSession {
    const existing = this.sessions.get(batch.id);
    if (existing) return existing;
    const session: SyncSession = {
      batchId: batch.id,
      items: batch.records.map((r) => ({ recordId: r.recordId, status: "pending", replayed: false })),
    };
    this.sessions.set(batch.id, session);
    this.processItems(batch, session, session.items, transport);
    return session;
  }

  /** 同步失败后按未完成明细重试；已完成的明细不再触碰 */
  retryIncomplete(batch: FieldBatch, transport: Transport = reliableTransport): SyncSession {
    const session = this.sessions.get(batch.id);
    if (!session) {
      throw new Error(`批次 ${batch.id} 尚未同步过，无法重试`);
    }
    const incomplete = session.items.filter((item) => item.status !== "done");
    this.processItems(batch, session, incomplete, transport);
    return session;
  }

  sessionOf(batchId: string): SyncSession | undefined {
    return this.sessions.get(batchId);
  }

  private processItems(
    batch: FieldBatch,
    session: SyncSession,
    items: SyncItem[],
    transport: Transport,
  ): void {
    for (const item of items) {
      const record = batch.records.find((r) => r.recordId === item.recordId);
      if (!record) {
        item.status = "failed";
        item.error = "批次中找不到该明细";
        continue;
      }
      try {
        transport(batch, record);
        item.replayed = this.applyRecord(batch, record);
        item.status = "done";
        item.error = undefined;
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  /** 应用一条记录到驻地档案；返回 true 表示是幂等重放 */
  private applyRecord(batch: FieldBatch, record: FieldRecord): boolean {
    switch (record.kind) {
      case "artifact-logged": {
        const existing = this.archive.artifacts.get(record.artifact.id);
        if (!existing) {
          this.archive.logArtifact(record.artifact);
          return false;
        }
        const samePlace =
          existing.coords.x === record.artifact.coords.x &&
          existing.coords.y === record.artifact.coords.y &&
          existing.stratumId === record.artifact.stratumId;
        if (samePlace) return true;
        this.archive.registerConflict(record.artifact.id, {
          coords: { ...record.artifact.coords },
          stratumId: record.artifact.stratumId,
          source: `批次 ${batch.id}（${batch.deviceId}）`,
        });
        return false;
      }
      case "boundary-adjusted":
        this.archive.adjustFeatureBoundary(record.featureId, record.boundary);
        return false;
      case "transfer-signed": {
        const result = this.archive.applyTransfer({
          idempotencyKey: record.idempotencyKey,
          items: record.items,
          signedBy: record.signedBy,
          signedAt: record.signedAt,
        });
        return result.replayed;
      }
    }
  }
}
