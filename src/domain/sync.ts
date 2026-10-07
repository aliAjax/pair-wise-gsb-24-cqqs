import { 应用操作 } from "./offline";
import { 档案仓库 } from "./repository";
import type { 断网批次, 断网操作, 失败明细 } from "./types";

/** 远端档案：除操作幂等外，移交记录也去重，保证重放不增加移交记录 */
export class 模拟远端 {
  库 = new 档案仓库();
  收到op = new Map<string, boolean>();
  /** 注入失败：返回错误信息则该操作本次失败（应用前失败）；"响应丢失"模拟应用后断连 */
  故障注入?: (op: 断网操作) => string | undefined;
  网络日志: { opId: string; 结果: "应用" | "应用后响应丢失" | "失败" | "幂等命中" }[] = [];

  constructor(基准库?: 档案仓库) {
    if (基准库) this.载入基准(基准库);
  }

  载入基准(库: 档案仓库): void {
    this.库 = 复制仓库(库);
  }

  提交(op: 断网操作): { ok: boolean; 已应用: boolean; 错误?: string } {
    if (this.收到op.has(op.opId)) {
      this.网络日志.push({ opId: op.opId, 结果: "幂等命中" });
      return { ok: true, 已应用: false };
    }
    const 故障 = this.故障注入?.(op);
    if (故障 && 故障 !== "响应丢失") {
      this.网络日志.push({ opId: op.opId, 结果: "失败" });
      return { ok: false, 已应用: false, 错误: 故障 };
    }
    const r = 应用操作(this.库, op);
    if (r.执行) this.库.已应用op.add(op.opId);
    if (故障 === "响应丢失") {
      this.收到op.set(op.opId, true);
      this.网络日志.push({ opId: op.opId, 结果: "应用后响应丢失" });
      return { ok: false, 已应用: true, 错误: "响应丢失（远端已应用）" };
    }
    this.收到op.set(op.opId, true);
    this.网络日志.push({ opId: op.opId, 结果: "应用" });
    return { ok: true, 已应用: r.执行 };
  }
}

export interface 同步报告 {
  成功: string[];
  未完成: 失败明细[];
  远端移交记录数: number;
}

/** 复制一份仓库作为远端基线（已签字的移交依据原样带过去） */
export function 复制仓库(库: 档案仓库): 档案仓库 {
  const 副本 = structuredClone(库) as 档案仓库;
  Object.setPrototypeOf(副本, 档案仓库.prototype); // 保留 Map/Set 数据与仓库方法
  return 副本;
}

export class 同步引擎 {
  constructor(
    public 远端: 模拟远端,
    public 本地: 档案仓库
  ) {}

  /** 同步若干探方批次；失败后保留未完成明细，供下轮只重试这些 op */
  同步(批次组: 断网批次[], 未完成: 失败明细[] = [], 时间 = new Date().toISOString()): 同步报告 {
    const 待试op = new Set(未完成.map((f) => f.opId));
    const 成功: string[] = [];
    const 仍未完成: 失败明细[] = [];
    const 已过 = new Set<string>();

    const 操作流: 断网操作[] = [];
    if (未完成.length > 0) {
      // 按未完成明细重试：明细即重试队列，不整批重放
      for (const 批次 of 批次组) {
        for (const op of 批次.操作) {
          if (待试op.has(op.opId)) 操作流.push(op);
        }
      }
    } else {
      for (const 批次 of 批次组) {
        操作流.push(...[...批次.操作].sort((a, b) => a.时间.localeCompare(b.时间)));
      }
    }

    for (const op of 操作流) {
      if (已过.has(op.opId)) continue; // 重放不增加移交记录：opId 只提交一次
      已过.add(op.opId);
      const r = this.远端.提交(op);
      if (r.ok) {
        成功.push(op.opId);
        continue;
      }
      if (!r.已应用) {
        仍未完成.push({
          opId: op.opId,
          类型: op.类型,
          批次id: op.批次id,
          错误: r.错误 ?? "未知故障",
          最后尝试: 时间,
        });
      } else {
        // 响应丢失：远端已生效，记入未完成明细但下轮幂等重放，不产生第二条移交记录
        仍未完成.push({
          opId: op.opId,
          类型: op.类型,
          批次id: op.批次id,
          错误: r.错误 ?? "响应丢失",
          最后尝试: 时间,
          远端已生效: true,
        });
      }
    }
    return {
      成功,
      未完成: 仍未完成,
      远端移交记录数: this.远端.库.移交记录.size,
    };
  }
}
