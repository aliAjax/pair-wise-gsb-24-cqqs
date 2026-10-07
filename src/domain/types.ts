// 现场档案核心类型：遗址 → 探方 → 地层 / 遗迹单位 → 出土物 → 暂存箱 / 移交记录

export const 状态 = {
  待核: "待核",
  在册: "在册",
  待裁定: "待领队裁定",
  已装箱: "已装箱",
  已移交: "已移交",
} as const;

export type 状态值 = (typeof 状态)[keyof typeof 状态];

export interface 点位 {
  x: number; // 东向坐标（米）
  y: number; // 北向坐标（米）
}

export interface 遗址 {
  id: string;
  名称: string;
}

export interface 探方 {
  id: string;
  遗址id: string;
  编号: string; // T0203
  批次id?: string;
}

export interface 地层 {
  id: string;
  探方id: string;
  编号: string; // 第3层
  层序: number; // 自上而下
}

export interface 遗迹单位 {
  id: string;
  探方id: string;
  编号: string; // H12
  类型: string; // 灰坑 / 墓葬 / 房址 / 沟状遗迹
  地层id?: string; // 遗迹开口层位：出土物层位不一致时不归属该遗迹
  边界: 点位[]; // 闭合多边形，边界线上算界内
  版本: number; // 每次边界调整 +1
}

/** 归属依据：未装箱件随边界实时重算；装箱/移交件冻结保留 */
export interface 依据 {
  探方id: string;
  遗迹id?: string;
  地层id?: string;
  边界版本: number;
  时间: string;
  说明: string;
  冻结?: boolean;
  前版?: 依据;
}

export interface 出土物 {
  id: string;
  遗址id: string;
  探方id: string;
  批次id?: string;
  坐标?: 点位;
  地层id?: string;
  遗迹id?: string;
  重量: number; // 千克
  名称: string;
  发掘日?: string; // YYYY-MM-DD
  状态: 状态值;
  依据?: 依据;
  待核项: string[];
  暂存箱id?: string;
  来源: string; // 录入端：平板编号 / 档案
}

export interface 出土物读法 {
  坐标?: 点位;
  地层id?: string;
  来源: string;
  时间: string;
}

export interface 归属冲突 {
  id: string;
  出土物id: string;
  批次id: string;
  差异: "坐标" | "层位" | "坐标与层位";
  两份: 出土物读法[];
  状态: "待裁定" | "已裁定";
  采用序号?: number;
  裁定人?: string;
  裁定时间?: string;
  /** 触发冲突时原件已装箱冻结或已签字移交：账保留原依据，冲突只登记两份读法 */
  账已冻结?: boolean;
}

export interface 暂存箱 {
  id: string;
  遗址id: string;
  探方id?: string;
  件数上限: number;
  重量上限: number;
  出土物ids: string[];
  总重量: number;
  已封箱: boolean;
  箱位?: number; // 未封箱队列：总重量降序、件数降序
  装箱时间?: string;
}

export interface 移交记录 {
  id: string; // 确定性编号，重放同一封箱只产生同一条
  暂存箱id: string;
  出土物ids: string[];
  总重量: number;
  移交人: string;
  接收人: string;
  签字时间: string;
  依据快照: Record<string, 依据>; // 签字时逐件保留的原依据
}

export interface 批次信息 {
  id: string;
  遗址id: string;
  探方id?: string;
  发掘日: string;
  来源: "断网平板" | "旧档案回填";
}

// ---- 断网操作（带幂等键，合并与同步都按 opId 去重）----

export interface 出土物录入载荷 {
  id: string;
  遗址id: string;
  探方id: string;
  坐标?: 点位;
  地层id?: string;
  重量: number;
  名称: string;
  发掘日?: string;
}

export interface 封箱载荷 {
  暂存箱id: string;
  移交人: string;
  接收人: string;
  签字时间: string;
}

export type 断网操作类型 =
  | "录入出土物"
  | "调整遗迹边界"
  | "装箱"
  | "封箱移交"
  | "领队裁定";

export interface 断网操作<载荷 = unknown> {
  opId: string; // 幂等键
  批次id: string;
  平板id: string;
  时间: string;
  类型: 断网操作类型;
  载荷: 载荷;
}

export interface 断网批次 {
  id: string;
  遗址id: string;
  探方id: string;
  发掘日: string;
  平板id: string;
  操作: 断网操作[];
  建批时间: string;
}

export interface 失败明细 {
  opId: string;
  类型: 断网操作类型;
  批次id: string;
  错误: string;
  最后尝试: string;
  远端已生效?: boolean; // 响应丢失：实际已应用，重放走幂等
}
