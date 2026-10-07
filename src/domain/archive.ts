import { pointInPolygon, polygonArea } from "./geometry";
import type {
  Artifact,
  ArtifactConflict,
  ArtifactVersion,
  Attribution,
  AuditEntry,
  FeatureKind,
  FeatureUnit,
  GridUnit,
  Point,
  Site,
  StagingBox,
  Stratum,
  TransferItem,
  TransferRecord,
} from "./types";

export interface ArtifactDraft {
  id: string;
  gridId: string;
  stratumId: string;
  coords: Point;
  weightGrams: number;
  pieces: number;
  label: string;
}

let transferSeq = 0;

/**
 * 现场档案：维护遗址/探方/地层/遗迹单位/出土物/暂存箱，
 * 负责归属计算、边界调整后的失效重算、箱位排队与签字移交。
 */
export class FieldArchive {
  readonly sites = new Map<string, Site>();
  readonly grids = new Map<string, GridUnit>();
  readonly stratums = new Map<string, Stratum>();
  readonly features = new Map<string, FeatureUnit>();
  readonly artifacts = new Map<string, Artifact>();
  readonly boxes = new Map<string, StagingBox>();
  readonly transfers: TransferRecord[] = [];
  readonly conflicts = new Map<string, ArtifactConflict>();
  readonly auditLog: AuditEntry[] = [];
  private readonly transferKeys = new Set<string>();
  private boxSeq = 0;
  private auditSeq = 0;

  addSite(site: Site): void {
    this.sites.set(site.id, site);
  }

  addGrid(grid: GridUnit): void {
    this.grids.set(grid.id, grid);
  }

  addStratum(stratum: Stratum): void {
    this.stratums.set(stratum.id, stratum);
  }

  addFeature(input: {
    id: string;
    gridId: string;
    stratumId: string;
    code: string;
    kind: FeatureKind;
    boundary: Point[];
  }): FeatureUnit {
    const feature: FeatureUnit = { ...input, boundaryVersion: 1 };
    this.features.set(feature.id, feature);
    return feature;
  }

  /** 登记出土物并立即计算归属 */
  logArtifact(draft: ArtifactDraft): Artifact {
    if (this.artifacts.has(draft.id)) {
      throw new Error(`出土物 ${draft.id} 已存在`);
    }
    const artifact: Artifact = {
      ...draft,
      coords: { ...draft.coords },
      attribution: this.computeAttribution(draft.gridId, draft.stratumId, draft.coords),
      location: "field",
      boxId: null,
    };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  /** 归属计算：落入遗迹边界则归遗迹（同层位优先，其次面积最小者），否则归地层 */
  computeAttribution(gridId: string, stratumId: string, coords: Point): Attribution {
    const containing = [...this.features.values()].filter(
      (f) => f.gridId === gridId && pointInPolygon(coords, f.boundary),
    );
    const sameStratum = containing.filter((f) => f.stratumId === stratumId);
    const pool = sameStratum.length > 0 ? sameStratum : containing;
    const chosen = pool.sort((a, b) => polygonArea(a.boundary) - polygonArea(b.boundary))[0];
    const stratumLabel = this.stratums.get(stratumId)?.label ?? stratumId;
    if (chosen) {
      return {
        featureId: chosen.id,
        stratumId,
        basis: `位于 ${chosen.code}（${chosen.kind}）边界内，边界版本 v${chosen.boundaryVersion}`,
        boundaryVersion: chosen.boundaryVersion,
        status: "有效",
      };
    }
    return {
      featureId: null,
      stratumId,
      basis: `未落入任何遗迹边界，归 ${stratumLabel}`,
      boundaryVersion: null,
      status: "有效",
    };
  }

  /**
   * 调整遗迹边界：版本号 +1。
   * 未装箱的出土物归属立即失效并重算；
   * 已装箱的保留装箱时归属（实物已入箱贴签）；
   * 已签字移交的以移交记录快照为准，永不受影响。
   */
  adjustFeatureBoundary(featureId: string, boundary: Point[]): void {
    const feature = this.mustFeature(featureId);
    feature.boundary = boundary.map((p) => ({ ...p }));
    feature.boundaryVersion += 1;
    this.audit(
      "边界调整",
      `${feature.code} 边界调整为 v${feature.boundaryVersion}，未装箱出土物归属失效重算`,
    );
    for (const artifact of this.artifacts.values()) {
      if (artifact.gridId !== feature.gridId) continue;
      if (artifact.location !== "field") continue;
      const oldBasis = artifact.attribution.basis;
      artifact.attribution = { ...artifact.attribution, status: "失效" };
      artifact.attribution = this.computeAttribution(
        artifact.gridId,
        artifact.stratumId,
        artifact.coords,
      );
      if (artifact.attribution.basis !== oldBasis) {
        this.audit(
          "归属重算",
          `${artifact.label}：${oldBasis} → ${artifact.attribution.basis}`,
          artifact.id,
        );
      }
    }
  }

  /** 箱位排队：未封箱的箱子按剩余承重、剩余件数升序排列，装箱时取队首能放下的箱子 */
  boxQueue(): StagingBox[] {
    return [...this.boxes.values()]
      .filter((b) => !b.sealed)
      .sort(
        (a, b) =>
          a.maxWeightGrams - a.usedWeightGrams - (b.maxWeightGrams - b.usedWeightGrams) ||
          a.maxPieces - a.usedPieces - (b.maxPieces - b.usedPieces),
      );
  }

  /** 出土物装箱：按箱位队列找第一个装得下的箱子，都装不下则开新箱 */
  packArtifact(artifactId: string): StagingBox {
    const artifact = this.mustArtifact(artifactId);
    if (artifact.location !== "field") {
      throw new Error(`${artifact.label} 已${artifact.location === "boxed" ? "装箱" : "移交"}`);
    }
    const fits = (box: StagingBox) =>
      box.usedWeightGrams + artifact.weightGrams <= box.maxWeightGrams &&
      box.usedPieces + artifact.pieces <= box.maxPieces;
    let box = this.boxQueue().find(fits);
    if (!box) {
      box = this.openBox();
      if (!fits(box)) {
        throw new Error(`${artifact.label} 超出单箱承重/件数上限，无法装箱`);
      }
    }
    box.artifactIds.push(artifact.id);
    box.usedWeightGrams += artifact.weightGrams;
    box.usedPieces += artifact.pieces;
    artifact.location = "boxed";
    artifact.boxId = box.id;
    this.audit("装箱", `${artifact.label} 装入 ${box.label}`, artifact.id);
    return box;
  }

  sealBox(boxId: string): void {
    const box = this.boxes.get(boxId);
    if (!box) throw new Error(`暂存箱 ${boxId} 不存在`);
    box.sealed = true;
  }

  /**
   * 签字移交：快照每件出土物当时的归属依据。
   * 幂等：同一 idempotencyKey 重放不会产生第二条移交记录。
   */
  signTransfer(input: {
    artifactIds: string[];
    signedBy: string;
    signedAt: string;
    idempotencyKey: string;
  }): { record: TransferRecord; replayed: boolean } {
    const items: TransferItem[] = input.artifactIds.map((id) => {
      const artifact = this.mustArtifact(id);
      if (artifact.location !== "boxed") {
        throw new Error(`${artifact.label} 未装箱，不能移交`);
      }
      return {
        artifactId: id,
        basis: artifact.attribution.basis,
        boundaryVersion: artifact.attribution.boundaryVersion,
      };
    });
    return this.applyTransfer({
      idempotencyKey: input.idempotencyKey,
      items,
      signedBy: input.signedBy,
      signedAt: input.signedAt,
    });
  }

  /** 应用一条移交（本地签字或远端同步），按幂等键去重 */
  applyTransfer(input: {
    idempotencyKey: string;
    items: TransferItem[];
    signedBy: string;
    signedAt: string;
  }): { record: TransferRecord; replayed: boolean } {
    if (this.transferKeys.has(input.idempotencyKey)) {
      const existing = this.transfers.find((t) => t.idempotencyKey === input.idempotencyKey)!;
      return { record: existing, replayed: true };
    }
    const record: TransferRecord = {
      id: `TR-${String(++transferSeq).padStart(4, "0")}`,
      idempotencyKey: input.idempotencyKey,
      items: input.items.map((item) => ({ ...item })),
      signedBy: input.signedBy,
      signedAt: input.signedAt,
    };
    for (const item of record.items) {
      const artifact = this.mustArtifact(item.artifactId);
      artifact.location = "transferred";
    }
    this.transfers.push(record);
    this.transferKeys.add(record.idempotencyKey);
    this.audit(
      "移交",
      `${record.id}：${record.items.length} 件出土物由 ${record.signedBy} 签字移交`,
    );
    return { record, replayed: false };
  }

  hasTransferKey(idempotencyKey: string): boolean {
    return this.transferKeys.has(idempotencyKey);
  }

  /** 登记同步冲突：同一出土物坐标或层位两边不一致，两份版本都保留 */
  registerConflict(artifactId: string, incoming: ArtifactVersion): ArtifactConflict {
    const artifact = this.mustArtifact(artifactId);
    const existing = this.conflicts.get(artifactId);
    if (existing && existing.status === "待裁定") {
      if (!existing.versions.some((v) => sameVersion(v, incoming))) {
        existing.versions.push(incoming);
      }
      return existing;
    }
    const conflict: ArtifactConflict = {
      artifactId,
      versions: [
        {
          coords: { ...artifact.coords },
          stratumId: artifact.stratumId,
          source: "驻地档案",
        },
        incoming,
      ],
      status: "待裁定",
    };
    this.conflicts.set(artifactId, conflict);
    artifact.attribution = { ...artifact.attribution, status: "待核" };
    this.audit(
      "冲突登记",
      `${artifact.label} 坐标/层位两边不一致，留 ${conflict.versions.length} 份待领队裁定`,
      artifactId,
    );
    return conflict;
  }

  /** 领队裁定：选定一版坐标/层位，重算归属并关闭冲突 */
  resolveConflict(artifactId: string, chosenIndex: number, resolvedBy: string): void {
    const conflict = this.conflicts.get(artifactId);
    if (!conflict || conflict.status !== "待裁定") {
      throw new Error(`出土物 ${artifactId} 没有待裁定的冲突`);
    }
    const chosen = conflict.versions[chosenIndex];
    if (!chosen) throw new Error(`冲突版本序号 ${chosenIndex} 无效`);
    const artifact = this.mustArtifact(artifactId);
    artifact.coords = { ...chosen.coords };
    artifact.stratumId = chosen.stratumId;
    if (artifact.location === "field") {
      artifact.attribution = this.computeAttribution(
        artifact.gridId,
        artifact.stratumId,
        artifact.coords,
      );
    } else {
      artifact.attribution = { ...artifact.attribution, status: "有效" };
    }
    conflict.status = "已裁定";
    conflict.resolution = {
      chosenIndex,
      resolvedBy,
      resolvedAt: new Date().toISOString(),
    };
    this.audit(
      "冲突裁定",
      `${artifact.label} 由 ${resolvedBy} 裁定采用第 ${chosenIndex + 1} 版（来源：${chosen.source}）`,
      artifactId,
    );
  }

  pendingConflicts(): ArtifactConflict[] {
    return [...this.conflicts.values()].filter((c) => c.status === "待裁定");
  }

  mustArtifact(id: string): Artifact {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`出土物 ${id} 不存在`);
    return artifact;
  }

  private mustFeature(id: string): FeatureUnit {
    const feature = this.features.get(id);
    if (!feature) throw new Error(`遗迹单位 ${id} 不存在`);
    return feature;
  }

  private openBox(): StagingBox {
    this.boxSeq += 1;
    const box: StagingBox = {
      id: `BOX-${this.boxSeq}`,
      label: `箱位 ${String(this.boxSeq).padStart(2, "0")}`,
      maxWeightGrams: 5000,
      maxPieces: 20,
      usedWeightGrams: 0,
      usedPieces: 0,
      artifactIds: [],
      sealed: false,
    };
    this.boxes.set(box.id, box);
    return box;
  }

  private audit(kind: AuditEntry["kind"], message: string, artifactId?: string): void {
    this.auditLog.push({ seq: ++this.auditSeq, kind, message, artifactId });
  }
}

function sameVersion(a: ArtifactVersion, b: ArtifactVersion): boolean {
  return (
    a.coords.x === b.coords.x &&
    a.coords.y === b.coords.y &&
    a.stratumId === b.stratumId &&
    a.source === b.source
  );
}
