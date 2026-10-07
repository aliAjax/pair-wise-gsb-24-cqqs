import type { 点位 } from "./types";

/** 多边形面积（鞋带公式），用于多遗迹重叠时取最小包含者 */
export function 多边形面积(边界: 点位[]): number {
  let 和 = 0;
  for (let i = 0; i < 边界.length; i++) {
    const a = 边界[i];
    const b = 边界[(i + 1) % 边界.length];
    和 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(和) / 2;
}

/**
 * 点是否在多边形内（射线法），边界线上算界内。
 * 夜里补测调整边界后，据此判定出土物落入哪个遗迹单位。
 */
export function 点在多边形内(点: 点位, 边界: 点位[]): boolean {
  let 在内 = false;
  const n = 边界.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = 边界[i];
    const vj = 边界[j];

    // 点在边线上：直接算界内
    const 叉积 = (点.y - vj.y) * (vi.x - vj.x) - (点.x - vj.x) * (vi.y - vj.y);
    const 点在围盒 =
      Math.min(vj.x, vi.x) <= 点.x &&
      点.x <= Math.max(vj.x, vi.x) &&
      Math.min(vj.y, vi.y) <= 点.y &&
      点.y <= Math.max(vj.y, vi.y);
    if (叉积 === 0 && 点在围盒) return true;

    const 跨越 =
      vi.y > 点.y !== vj.y > 点.y &&
      点.x < ((vj.x - vi.x) * (点.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (跨越) 在内 = !在内;
  }
  return 在内;
}

/** 同一坐标点（米，毫米级取整视为同点，避免平板浮点抖动） */
export function 同坐标(a?: 点位, b?: 点位): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  const 精度 = 1000;
  return (
    Math.round(a.x * 精度) === Math.round(b.x * 精度) &&
    Math.round(a.y * 精度) === Math.round(b.y * 精度)
  );
}
