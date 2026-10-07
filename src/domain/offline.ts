import { 同坐标 } from "./geometry";
import { 档案仓库 } from "./repository";
import {
  状态,
  type 出土物录入载荷,
  type 断网批次,
  type 断网操作,
  type 归属冲突,
  type 封箱载荷,
  type 点位,
} from "./types";

export interface 合并明细 {
  opId: string;
  类型: string;
  结果: "新增" | "幂等跳过" | "生成冲突" | "完成" | "失败";
  说明: string;
}

export interface 合并报告 {
  批次id: string;
  明细: 合并明细[];
  重算: { 出土物id: string; 旧遗迹?: string; 新遗迹?: string }[];
  冲突ids: string[];
}

/** 封箱移交记录的确定性编号：同一操作重放永远落到同一条记录 */
export function 移交记录键(op: 断网操作): string {
  return `YJ-${op.opId}`;
}

/** 对一个仓库应用单条断网操作；返回是否真正执行（false=幂等跳过） */
export function 应用操作(库: 档案仓库, op: 断网操作): {
  执行: boolean;
  说明: string;
  冲突id?: string;
  重算?: { 出土物id: string; 旧遗迹?: string; 新遗迹?: string }[];
} {
  if (库.已应用op.has(op.opId)) {
    return { 执行: false, 说明: `操作 ${op.opId} 已应用，跳过` };
  }
  switch (op.类型) {
    case "录入出土物": {
      const p = op.载荷 as 出土物录入载荷;
      const 既有 = 库.出土物.get(p.id);
      const 坐标 = p.坐标 as 点位 | undefined;
      if (既有 && 既有.状态 !== 状态.待裁定) {
        const 坐标异 = !同坐标(既有.坐标, 坐标);
        const 层位异 = (既有.地层id ?? "") !== (p.地层id ?? "");
        if (坐标异 || 层位异) {
          // 坐标或层位两边不同：留两份待领队裁定，不覆盖任何一边
          // 冲突编号由触发操作确定性派生，保证远端重放得到同一 id
          const 账已冻结 = 既有.状态 === 状态.已移交 || 既有.依据?.冻结 === true;
          const 冲突: 归属冲突 = {
            id: `CT-${op.opId}`,
            出土物id: p.id,
            批次id: op.批次id,
            差异: 坐标异 && 层位异 ? "坐标与层位" : 坐标异 ? "坐标" : "层位",
            两份: [
              { 坐标: 既有.坐标, 地层id: 既有.地层id, 来源: 既有.来源, 时间: 既有.依据?.时间 ?? op.时间 },
              { 坐标, 地层id: p.地层id, 来源: op.平板id, 时间: op.时间 },
            ],
            状态: "待裁定",
            账已冻结,
          };
          库.冲突.set(冲突.id, 冲突);
          if (!账已冻结) 既有.状态 = 状态.待裁定;
          return {
            执行: true,
            说明: 账已冻结
              ? `${p.id} 两边${冲突.差异}不一致，两份读法留档；原件已${既有.状态 === 状态.已移交 ? "签字移交" : "装箱冻结"}，账保留原依据`
              : `${p.id} 两边${冲突.差异}不一致，留两份待领队裁定`,
            冲突id: 冲突.id,
          };
        }
        库.已应用op.add(op.opId);
        return { 执行: false, 说明: `${p.id} 坐标与层位一致，按幂等处理` };
      }
      if (既有 && 既有.状态 === 状态.待裁定) {
        return { 执行: false, 说明: `${p.id} 已在待裁定，不再叠加版本` };
      }
      库.录出土物({
        id: p.id,
        遗址id: p.遗址id,
        探方id: p.探方id,
        批次id: op.批次id,
        坐标,
        地层id: p.地层id,
        重量: p.重量,
        名称: p.名称,
        发掘日: p.发掘日,
        来源: op.平板id,
      });
      return { 执行: true, 说明: `录入出土物 ${p.id}（${p.名称}）` };
    }
    case "调整遗迹边界": {
      const p = op.载荷 as { 遗迹id: string; 边界: 点位[] };
      const r = 库.遗迹.get(p.遗迹id);
      // 迟到的边界调整：未装箱件归属马上失效重算，已签字件不受影响
      const 变更 = 库.调整遗迹边界(p.遗迹id, p.边界, op.时间);
      return {
        执行: true,
        说明: `${r?.编号 ?? p.遗迹id} 边界调整，重算 ${变更.length} 件`,
        重算: 变更.map((c) => ({
          出土物id: c.出土物id,
          旧遗迹: c.旧?.遗迹id,
          新遗迹: c.新.遗迹id,
        })),
      };
    }
    case "装箱": {
      const p = op.载荷 as { 暂存箱id: string; 出土物ids: string[] };
      const 待装 = p.出土物ids.filter((id) => 库.出土物.get(id)?.暂存箱id !== p.暂存箱id);
      if (待装.length === 0) {
        库.已应用op.add(op.opId);
        return { 执行: false, 说明: "所列件均已在该箱，幂等跳过" };
      }
      库.装箱(p.暂存箱id, 待装, op.时间);
      return { 执行: true, 说明: `${p.暂存箱id} 装入 ${待装.length} 件` };
    }
    case "封箱移交": {
      const p = op.载荷 as 封箱载荷;
      const 记录 = 库.封箱移交(p.暂存箱id, p.移交人, p.接收人, p.签字时间, 移交记录键(op));
      return { 执行: true, 说明: `${p.暂存箱id} 封箱，移交记录 ${记录.id}（${记录.出土物ids.length}件）` };
    }
    case "领队裁定": {
      const p = op.载荷 as { 冲突id: string; 采用序号: number; 裁定人: string };
      库.裁定(p.冲突id, p.采用序号, p.裁定人, op.时间);
      return { 执行: true, 说明: `冲突 ${p.冲突id} 已裁定采用第 ${p.采用序号 + 1} 份` };
    }
  }
}

/** 断网记录按探方批次合并：一个批次内按时间序重放，opId 去重 */
export function 合并批次(库: 档案仓库, 批次: 断网批次): 合并报告 {
  if (!库.批次.has(批次.id)) {
    库.批次.set(批次.id, {
      id: 批次.id,
      遗址id: 批次.遗址id,
      探方id: 批次.探方id,
      发掘日: 批次.发掘日,
      来源: "断网平板",
    });
  }
  const 明细: 合并明细[] = [];
  const 冲突ids: string[] = [];
  const 重算: 合并报告["重算"] = [];

  for (const op of [...批次.操作].sort((a, b) => a.时间.localeCompare(b.时间))) {
    try {
      const r = 应用操作(库, op);
      if (r.执行) 库.已应用op.add(op.opId);
      if (r.冲突id) 冲突ids.push(r.冲突id);
      if (r.重算) 重算.push(...r.重算);
      明细.push({
        opId: op.opId,
        类型: op.类型,
        结果: !r.执行
          ? "幂等跳过"
          : r.冲突id
            ? "生成冲突"
            : op.类型 === "封箱移交" || op.类型 === "装箱"
              ? "完成"
              : "新增",
        说明: r.说明,
      });
    } catch (e) {
      明细.push({ opId: op.opId, 类型: op.类型, 结果: "失败", 说明: (e as Error).message });
    }
  }

  return { 批次id: 批次.id, 明细, 重算, 冲突ids };
}
