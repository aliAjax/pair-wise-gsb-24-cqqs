import { useMemo, useState } from "react";
import "./styles.css";
import { 运行推演 } from "./domain/scenario";
import { 状态, type 出土物, type 遗迹单位, type 暂存箱 } from "./domain/types";

function 遗迹名(r?: 遗迹单位): string {
  return r ? `${r.编号}${r.类型}@v${r.版本}` : "探方层位（遗迹外）";
}

function 物状态徽标(物: 出土物): string {
  return 物.状态;
}

function MetricCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p className="metric-hint">{hint}</p>
      <i className={tone} />
    </article>
  );
}

function App() {
  // 重放即重建一份档案：所有断网批次、边界调整、同步失败重试从头走一遍
  const [轮次, set轮次] = useState(1);
  const { 步骤, 本地, 远端 } = useMemo(() => 运行推演(), [轮次]);

  const 出土物 = [...本地.出土物.values()].sort((a, b) => a.id.localeCompare(b.id));
  const 遗迹 = [...本地.遗迹.values()];
  const 箱 = [...本地.暂存箱.values()].sort((a, b) => (a.箱位 ?? 99) - (b.箱位 ?? 99));
  const 移交 = [...本地.移交记录.values()];
  const 冲突列 = [...本地.冲突.values()];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 现场档案 · port 5110</p>
          <h1>考古现场档案</h1>
          <p className="subtitle">
            遗址 → 探方 → 地层 / 遗迹单位 → 出土物 → 暂存箱。夜里断网按探方批次记账，
            回驻地合并；迟到边界调整即时重算未装箱件归属，已签字移交保留原依据。
          </p>
        </div>
        <div className="stack-card">
          <span>档案一致性</span>
          <strong>待裁定 {冲突列.filter((c) => c.状态 === "待裁定").length} 件 ｜ 待核 {出土物.filter((w) => w.状态 === 状态.待核).length} 件</strong>
          <span>远端移交记录 {远端.库.移交记录.size} 条（重放不新增）</span>
          <button className="primary-action" onClick={() => set轮次((n) => n + 1)}>从头重放断网→同步</button>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="出土物" value={出土物.length} hint={`在册/装箱/移交/待核/待裁定各态可溯`} tone="status-ok" />
        <MetricCard label="暂存箱" value={箱.length} hint="未封箱按总重量、件数排队" tone="status-watch" />
        <MetricCard label="遗迹单位" value={遗迹.length} hint="边界带版本号，改动留痕" tone="status-ok" />
        <MetricCard label="读法冲突" value={冲突列.length} hint="坐标或层位两边不同，留两份" tone="status-danger" />
      </section>

      <section className="panel timeline-panel">
        <div className="section-heading">
          <div>
            <p>全流程推演（第 {轮次} 次重放）</p>
            <h2>断网批次合并 → 边界重算 → 裁定装箱 → 失败重试 → 旧档案回填</h2>
          </div>
        </div>
        <ol className="timeline">
          {步骤.map((s, i) => (
            <li key={i}>
              <details open={i < 2}>
                <summary>
                  <span className="step-no">{String(i + 1).padStart(2, "0")}</span>
                  <span className="step-stage">{s.阶段}</span>
                  <span className="step-title">{s.标题}</span>
                </summary>
                <ul className="step-detail">
                  {s.明细.map((m, j) => <li key={j}>{m}</li>)}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>遗迹单位（边界版本）</h2>
          <div className="side-list">
            {遗迹.map((r) => (
              <article key={r.id} className="side-item">
                <h3>{r.编号} · {r.类型}</h3>
                <p>开口 {本地.地层.get(r.地层id ?? "")?.编号 ?? "层位待核"}</p>
                <p>边界 v{r.版本}，{r.边界.length} 点，当前 {r.边界[1].x - r.边界[0].x}m × {r.边界[2].y - r.边界[1].y}m</p>
              </article>
            ))}
          </div>
          <h2>暂存箱队列</h2>
          <div className="side-list">
            {箱.map((b) => <箱行 key={b.id} 箱={b} />)}
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>出土物台账</p>
              <h2>归属依据实时账（冻结件保留原依据）</h2>
            </div>
          </div>
          <div className="ledger">
            <table>
              <thead>
                <tr>
                  <th>编号</th><th>名称</th><th>坐标</th><th>层位</th><th>归属依据</th><th>重量</th><th>箱</th><th>状态</th><th>说明</th>
                </tr>
              </thead>
              <tbody>
                {出土物.map((物) => (
                  <tr key={物.id} className={物.状态 === 状态.待裁定 ? "row-danger" : 物.状态 === 状态.待核 ? "row-watch" : ""}>
                    <td>{物.id}</td>
                    <td>{物.名称}</td>
                    <td>{物.坐标 ? `${物.坐标.x},${物.坐标.y}` : "—"}</td>
                    <td>{本地.地层.get(物.地层id ?? "")?.编号 ?? "—"}</td>
                    <td>
                      {物.依据
                        ? `${遗迹名(本地.遗迹.get(物.依据.遗迹id ?? ""))}${物.依据.冻结 ? "（已冻结）" : ""}`
                        : "无（待核/待裁定）"}
                    </td>
                    <td>{物.重量}kg</td>
                    <td>{物.暂存箱id ?? "—"}</td>
                    <td><span className={`badge badge-${物.状态}`}>{物状态徽标(物)}</span></td>
                    <td className="note">{物.待核项.length ? "待核：" + 物.待核项.join("、") : 物.依据?.说明 ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="panel records-panel">
        <div className="section-heading">
          <div>
            <p>签字移交与读法冲突</p>
            <h2>移交记录逐件带原依据快照；冲突两份并列待领队裁定</h2>
          </div>
        </div>
        <div className="two-col">
          <div className="card-col">
            <h3>移交记录（{移交.length}）</h3>
            {移交.map((y) => (
              <article key={y.id} className="record-card">
                <div className="record-index">{y.id.replace("YJ-", "").toUpperCase()}</div>
                <div>
                  <h3>{y.id} · 箱 {y.暂存箱id} · {y.出土物ids.length}件 / {y.总重量}kg</h3>
                  <p>{y.移交人} → {y.接收人}，签字 {y.签字时间.replace("+08:00", "")}</p>
                  <p className="note">依据快照：{Object.entries(y.依据快照).map(([id, d]) =>
                    `${id}=${本地.遗迹.get(d.遗迹id ?? "")?.编号 ?? "探方"}@v${d.边界版本}`).join("，")}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="card-col">
            <h3>归属冲突（{冲突列.length}）</h3>
            {冲突列.map((c) => (
              <article key={c.id} className="record-card conflict-card">
                <div className="record-index">裁</div>
                <div>
                  <h3>{c.出土物id} · {c.差异} · {c.状态 === "已裁定" ? `已采用第${(c.采用序号 ?? 0) + 1}份` : "待领队裁定"}</h3>
                  {c.两份.map((d, i) => (
                    <p key={i} className={c.采用序号 === i ? "picked" : ""}>
                      第{i + 1}份（{d.来源}）：坐标 {d.坐标 ? `${d.坐标.x},${d.坐标.y}` : "缺"}；
                      层位 {本地.地层.get(d.地层id ?? "")?.编号 ?? "缺"}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function 箱行({ 箱 }: { 箱: 暂存箱 }) {
  return (
    <article className="side-item">
      <h3>箱 {箱.id} {箱.已封箱 && <span className="seal">已封箱</span>}</h3>
      <p>{箱.出土物ids.length} 件 · {箱.总重量}kg · 上限 {箱.件数上限}件/{箱.重量上限}kg</p>
      <p>{箱.已封箱 ? "已出队（留底）" : 箱.箱位 ? `箱位 #${箱.箱位}` : "空箱不排队"}</p>
    </article>
  );
}

export default App;
