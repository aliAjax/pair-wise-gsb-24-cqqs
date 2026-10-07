/** 现场档案领域模型：遗址 → 探方 → 地层 → 遗迹单位 → 出土物 → 暂存箱 */

export interface Point {
  x: number;
  y: number;
}

export interface Site {
  id: string;
  name: string;
}

/** 探方，如 T0203 */
export interface GridUnit {
  id: string;
  siteId: string;
  code: string;
}

/** 地层，如 第3层 */
export interface Stratum {
  id: string;
  gridId: string;
  label: string;
}

export type FeatureKind = "灰坑" | "墓葬" | "房址" | "沟状遗迹";

/** 遗迹单位：带边界多边形，边界每次调整版本号 +1 */
export interface FeatureUnit {
  id: string;
  gridId: string;
  stratumId: string;
  code: string;
  kind: FeatureKind;
  boundary: Point[];
  boundaryVersion: number;
}

export type AttributionStatus = "有效" | "失效" | "待核";

/** 出土物归属依据：属于哪个遗迹单位、依据文本、基于哪版边界 */
export interface Attribution {
  featureId: string | null;
  stratumId: string;
  basis: string;
  boundaryVersion: number | null;
  status: AttributionStatus;
}

export type ArtifactLocation = "field" | "boxed" | "transferred";

export interface Artifact {
  id: string;
  gridId: string;
  stratumId: string;
  coords: Point;
  weightGrams: number;
  pieces: number;
  label: string;
  attribution: Attribution;
  location: ArtifactLocation;
  boxId: string | null;
}

/** 暂存箱：按重量与件数限制装箱 */
export interface StagingBox {
  id: string;
  label: string;
  maxWeightGrams: number;
  maxPieces: number;
  usedWeightGrams: number;
  usedPieces: number;
  artifactIds: string[];
  sealed: boolean;
}

/** 移交条目：签字时快照归属依据，之后边界再改也不变 */
export interface TransferItem {
  artifactId: string;
  basis: string;
  boundaryVersion: number | null;
}

export interface TransferRecord {
  id: string;
  idempotencyKey: string;
  items: TransferItem[];
  signedBy: string;
  signedAt: string;
}

/** 归属变更审计 */
export interface AuditEntry {
  seq: number;
  kind: "归属重算" | "边界调整" | "装箱" | "移交" | "冲突登记" | "冲突裁定" | "旧档回填";
  message: string;
  artifactId?: string;
}

/** 同步冲突：同一出土物两边坐标或层位不同，两份都留，待领队裁定 */
export interface ArtifactVersion {
  coords: Point;
  stratumId: string;
  source: string;
}

export interface ArtifactConflict {
  artifactId: string;
  versions: ArtifactVersion[];
  status: "待裁定" | "已裁定";
  resolution?: {
    chosenIndex: number;
    resolvedBy: string;
    resolvedAt: string;
  };
}
