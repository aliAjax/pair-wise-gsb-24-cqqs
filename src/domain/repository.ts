import { 多边形面积, 点在多边形内 } from "./geometry";
import { 状态, type 点位, type 依据, type 遗迹单位, type 出土物 } from "./types";

export function 新id(前缀: string): string {
  序号 += 1;
  return `${前缀}${Date.now().toString(36)}${序号.toString(36)}`;
}
let 序号 = 0;

export interface 重算结果 {
  出土物id: string;
  旧: 依据 | undefined;
  新: 依据;
}

export class 档案仓库 {
  遗址 = new Map<string, { id: string; 名称: string }>();
  探方 = new Map<string, { id: string; 遗址id: string; 编号: string; 批次id?: string }>();
  地层 = new Map<string, { id: string; 探方id: string; 编号: string; 层序: number }>();
  遗迹 = new Map<string, 遗迹单位>();
  出土物 = new Map<string, 出土物>();
  暂存箱 = new Map<string, import("./types").暂存箱>();
  移交记录 = new Map<string, import("./types").移交记录>();
  冲突 = new Map<string, import("./types").归属冲突>();
  批次 = new Map<string, import("./types").批次信息>();
  已应用op = new Set<string>();

  取探方遗迹(探方id: string): 遗迹单位[] {
    return [...this.遗迹.values()].filter((r) => r.探方id === 探方id);
  }

  /**
   * 计算一件未装箱出土物的实时归属。
   * 取坐标所在、且层位与遗迹开口层位一致的最小遗迹；
   * 不在任何遗迹内则归属到探方/地层。
   */
  计算归属(
    物: 出土物,
    时间: string,
    说明: string,
    边界版本覆盖?: number
  ): 依据 {
    let 命中: 遗迹单位 | undefined;
    if (物.坐标) {
      const 候选 = this.取探方遗迹(物.探方id)
        .filter((r) => 点在多边形内(物.坐标!, r.边界))
        .filter((r) => !r.地层id || !物.地层id || r.地层id === 物.地层id)
        .sort((a, b) => 多边形面积(a.边界) - 多边形面积(b.边界));
      命中 = 候选[0];
    }
    return {
      探方id: 物.探方id,
      遗迹id: 命中?.id,
      地层id: 物.地层id,
      边界版本: 边界版本覆盖 ?? 命中?.版本 ?? 0,
      时间,
      说明,
    };
  }

  private 物是否受边界影响(物: 出土物): boolean {
    // 已签字移交：保留原依据；已装箱（未移交）：装箱时冻结；待裁定：由领队处理
    return (
      !物.依据?.冻结 &&
      物.状态 !== 状态.已移交 &&
      物.状态 !== 状态.待裁定
    );
  }

  /** 边界一改：探方内所有未装箱出土物归属马上失效重算 */
  调整遗迹边界(遗迹id: string, 新边界: 点位[], 时间: string): 重算结果[] {
    const r = this.遗迹.get(遗迹id);
    if (!r) throw new Error(`遗迹不存在：${遗迹id}`);
    r.边界 = 新边界;
    r.版本 += 1;

    const 变更: 重算结果[] = [];
    for (const 物 of this.出土物.values()) {
      if (物.探方id !== r.探方id) continue;
      if (!this.物是否受边界影响(物)) continue;
      const 旧 = 物.依据;
      const 新 = this.计算归属(物, 时间, `边界调整：${r.编号}边界改至v${r.版本}，归属重算`);
      if (
        旧?.遗迹id !== 新.遗迹id ||
        旧?.地层id !== 新.地层id ||
        旧?.边界版本 !== 新.边界版本
      ) {
        物.依据 = 新;
        物.遗迹id = 新.遗迹id;
        物.地层id = 新.地层id ?? 物.地层id;
        变更.push({ 出土物id: 物.id, 旧, 新 });
      }
    }
    return 变更;
  }

  录出土物(
    初始: Omit<出土物, "状态" | "待核项" | "来源"> &
      Partial<Pick<出土物, "状态" | "待核项" | "来源">>
  ): 出土物 {
    const 物: 出土物 = {
      ...初始,
      状态: 初始.状态 ?? 状态.在册,
      待核项: 初始.待核项 ?? [],
      来源: 初始.来源 ?? "平板",
    };
    if (!物.依据 && 物.状态 === 状态.在册) {
      物.依据 = this.计算归属(物, new Date().toISOString(), "现场录入，初始归属");
      物.遗迹id = 物.依据.遗迹id;
    }
    this.出土物.set(物.id, 物);
    return 物;
  }

  建暂存箱(箱: import("./types").暂存箱): import("./types").暂存箱 {
    this.暂存箱.set(箱.id, 箱);
    return 箱;
  }

  /** 装箱：未裁定、未装箱件可入箱；装箱瞬间冻结归属依据 */
  装箱(箱id: string, 出土物ids: string[], 时间: string): void {
    const 箱 = this.暂存箱.get(箱id);
    if (!箱) throw new Error(`暂存箱不存在：${箱id}`);
    if (箱.已封箱) throw new Error(`暂存箱已封箱：${箱id}`);
    for (const id of 出土物ids) {
      const 物 = this.出土物.get(id);
      if (!物) throw new Error(`出土物不存在：${id}`);
      if (物.状态 === 状态.待裁定) throw new Error(`出土物待领队裁定，不能装箱：${id}`);
      if (物.状态 === 状态.已移交) throw new Error(`出土物已移交：${id}`);
      if (物.暂存箱id && 物.暂存箱id !== 箱id) throw new Error(`出土物已在其他箱：${id}`);
      if (箱.出土物ids.length + 1 > 箱.件数上限) throw new Error(`件数超上限：${箱id}`);
      if (箱.总重量 + 物.重量 > 箱.重量上限 + 1e-9) throw new Error(`重量超上限：${箱id}`);

      // 装箱前先按当前边界重算一次，再冻结；前版依据留链可溯
      const 新依据 = this.计算归属(物, 时间, "装箱封账，归属依据冻结");
      物.依据 = { ...新依据, 冻结: true, 前版: 物.依据 };
      物.状态 = 状态.已装箱;
      物.暂存箱id = 箱id;
      箱.出土物ids.push(id);
      箱.总重量 = Math.round((箱.总重量 + 物.重量) * 1000) / 1000;
    }
    箱.装箱时间 = 时间;
    this.重排箱位();
  }

  /** 箱位排队：未封箱箱按总重量降序、件数降序；封箱箱出队（留底不占队位） */
  重排箱位(): void {
    const 在队 = [...this.暂存箱.values()]
      .filter((b) => !b.已封箱 && b.出土物ids.length > 0)
      .sort((a, b) => b.总重量 - a.总重量 || b.出土物ids.length - a.出土物ids.length || a.id.localeCompare(b.id));
    在队.forEach((箱, i) => (箱.箱位 = i + 1));
    for (const 箱 of this.暂存箱.values()) {
      if (箱.已封箱 || 箱.出土物ids.length === 0) 箱.箱位 = undefined;
    }
  }

  /** 封箱签字：生成确定性移交记录（opId 重放不新增），逐件保留原依据 */
  封箱移交(
    箱id: string,
    移交人: string,
    接收人: string,
    签字时间: string,
    记录id: string
  ): import("./types").移交记录 {
    const 箱 = this.暂存箱.get(箱id);
    if (!箱) throw new Error(`暂存箱不存在：${箱id}`);
    if (箱.已封箱) return this.移交记录.get(记录id)!;
    const 依据快照: Record<string, 依据> = {};
    for (const id of 箱.出土物ids) {
      const 物 = this.出土物.get(id)!;
      物.状态 = 状态.已移交;
      if (物.依据) 依据快照[id] = { ...物.依据 }; // 已签字移交的保留原依据
    }
    箱.已封箱 = true;
    箱.箱位 = undefined;
    const 记录: import("./types").移交记录 = {
      id: 记录id,
      暂存箱id: 箱id,
      出土物ids: [...箱.出土物ids],
      总重量: 箱.总重量,
      移交人,
      接收人,
      签字时间,
      依据快照,
    };
    this.移交记录.set(记录id, 记录);
    this.重排箱位();
    return 记录;
  }

  /** 领队裁定：采用其中一份读法；冻结账（已装箱/已移交）只结冲突、账不动 */
  裁定(冲突id: string, 采用序号: number, 裁定人: string, 时间: string): 出土物 {
    const c = this.冲突.get(冲突id);
    if (!c) throw new Error(`冲突不存在：${冲突id}`);
    if (c.状态 === "已裁定") return this.出土物.get(c.出土物id)!;
    const 读法 = c.两份[采用序号];
    if (!读法) throw new Error("裁定序号越界");
    const 物 = this.出土物.get(c.出土物id)!;
    if (c.账已冻结) {
      // 已签字移交/已装箱冻结：原依据保留，裁定结论只落到冲突上备查
      c.状态 = "已裁定";
      c.采用序号 = 采用序号;
      c.裁定人 = 裁定人;
      c.裁定时间 = 时间;
      return 物;
    }
    物.坐标 = 读法.坐标;
    物.地层id = 读法.地层id;
    物.状态 = 状态.在册;
    物.依据 = this.计算归属(物, 时间, `领队${裁定人}裁定采用第${采用序号 + 1}份读法`);
    物.遗迹id = 物.依据.遗迹id;
    c.状态 = "已裁定";
    c.采用序号 = 采用序号;
    c.裁定人 = 裁定人;
    c.裁定时间 = 时间;
    return 物;
  }
}
