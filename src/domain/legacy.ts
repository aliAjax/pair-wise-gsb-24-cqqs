import type { ArtifactDraft } from "./archive";
import type { FieldBatch, FieldRecord } from "./sync";

/** 旧档案条目：没有探方批次号，字段也可能缺 */
export interface LegacyEntry {
  id: string;
  siteId?: string;
  gridCode?: string;
  excavationDate?: string;
  artifact: ArtifactDraft;
}

export interface BackfillResult {
  /** 按 遗址 + 发掘日 回填生成的探方批次 */
  batches: FieldBatch[];
  assigned: { entryId: string; batchId: string }[];
  /** 缺关键字段、无法回填的条目，先挂待核 */
  pending: { entryId: string; missing: string[] }[];
}

/**
 * 旧档案回填：没有探方批次的记录按 遗址 + 发掘日 归并成批次；
 * 缺遗址、探方或发掘日的条目不强行归入，列入待核清单。
 */
export function backfillLegacy(entries: LegacyEntry[]): BackfillResult {
  const batches = new Map<string, FieldBatch>();
  const assigned: BackfillResult["assigned"] = [];
  const pending: BackfillResult["pending"] = [];

  for (const entry of entries) {
    const missing: string[] = [];
    if (!entry.siteId) missing.push("遗址");
    if (!entry.gridCode) missing.push("探方");
    if (!entry.excavationDate) missing.push("发掘日");
    if (missing.length > 0) {
      pending.push({ entryId: entry.id, missing });
      continue;
    }
    const batchId = `LEGACY-${entry.siteId}-${entry.excavationDate}`;
    let batch = batches.get(batchId);
    if (!batch) {
      batch = {
        id: batchId,
        gridId: entry.gridCode!,
        excavationDate: entry.excavationDate!,
        deviceId: "legacy-backfill",
        records: [],
      };
      batches.set(batchId, batch);
    }
    const record: FieldRecord = {
      kind: "artifact-logged",
      recordId: `${batchId}#${entry.id}`,
      artifact: entry.artifact,
    };
    batch.records.push(record);
    assigned.push({ entryId: entry.id, batchId });
  }

  return { batches: [...batches.values()], assigned, pending };
}
