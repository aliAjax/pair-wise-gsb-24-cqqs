import { 档案仓库 } from "./repository";
import { 状态, type 出土物 } from "./types";

/**
 * 旧档案行：没有探方批次字段。
 * 按「遗址 + 发掘日」回推出探方批次键（同日同遗址视为一批）；
 * 缺遗址、发掘日或关键归属项的，出土物先待核，不猜。
 */
export interface 旧档案行 {
  旧编号: string;
  遗址id?: string;
  探方编号?: string;
  发掘日?: string;
  坐标?: { x: number; y: number };
  地层编号?: string;
  重量?: number;
  名称?: string;
}

export interface 回填结果 {
  出土物id: string;
  旧编号: string;
  批次id?: string;
  状态: string;
  待核项: string[];
}

export function 派生批次键(遗址id: string, 发掘日: string): string {
  return `BAT-${遗址id}-${发掘日.replace(/-/g, "")}`;
}

export function 回填旧档案(库: 档案仓库, 行组: 旧档案行[]): 回填结果[] {
  const 结果: 回填结果[] = [];
  for (const 行 of 行组) {
    const 待核项: string[] = [];
    if (!行.遗址id) 待核项.push("遗址");
    if (!行.发掘日) 待核项.push("发掘日");
    if (!行.探方编号) 待核项.push("探方");
    if (!行.坐标) 待核项.push("坐标");
    if (!行.地层编号) 待核项.push("层位");
    if (行.重量 === undefined) 待核项.push("重量");
    if (!行.名称) 待核项.push("名称");

    const 遗址id = 行.遗址id ?? "待核";
    const 发掘日 = 行.发掘日 ?? "待定日";
    const 批次id = 行.遗址id && 行.发掘日 ? 派生批次键(行.遗址id, 行.发掘日) : undefined;

    if (批次id && !库.批次.has(批次id)) {
      库.批次.set(批次id, {
        id: 批次id,
        遗址id: 行.遗址id!,
        探方id: undefined,
        发掘日: 行.发掘日!,
        来源: "旧档案回填",
      });
    }

    const 探方 = 行.探方编号
      ? [...库.探方.values()].find((s) => s.遗址id === 行.遗址id && s.编号 === 行.探方编号)
      : undefined;
    if (行.探方编号 && !探方) 待核项.push("探方未建档");
    const 地层 = 行.地层编号
      ? [...库.地层.values()].find((l) => l.探方id === 探方?.id && l.编号 === 行.地层编号)
      : undefined;
    if (行.地层编号 && 探方 && !地层) 待核项.push("层位未建档");

    const id = `LEG-${行.旧编号}`;
    const 物: 出土物 = {
      id,
      遗址id,
      探方id: 探方?.id ?? "待核",
      批次id,
      坐标: 行.坐标,
      地层id: 地层?.id,
      重量: 行.重量 ?? 0,
      名称: 行.名称 ?? `待核(${行.旧编号})`,
      发掘日: 行.发掘日,
      状态: 待核项.length > 0 ? 状态.待核 : 状态.在册,
      待核项,
      来源: `旧档案:${行.旧编号}`,
    };
    if (待核项.length === 0) {
      物.依据 = 库.计算归属(物, new Date().toISOString(), "旧档案回填，按遗址与发掘日归批");
      物.遗迹id = 物.依据.遗迹id;
    }
    库.出土物.set(id, 物);
    结果.push({ 出土物id: id, 旧编号: 行.旧编号, 批次id, 状态: 物.状态, 待核项 });
  }
  return 结果;
}
