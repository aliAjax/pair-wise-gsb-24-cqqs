import { useRef, useState } from "react";
import "./styles.css";
import { createDemo, flakyTransport, runBackfill, type DemoState } from "./demo/scenario";

const project = {
  id: "hxwl-10",
  port: 5110,
  title: "考古探方现场档案",
  subtitle: "遗址 · 探方 · 地层 · 遗迹单位 · 出土物 · 暂存箱：断网记录、边界调整与同步冲突的一体化档案",
};

interface Step {
  title: string;
  desc: string;
  run: (demo: DemoState) => void;
}

const steps: Step[] = [
  {
    title: "① 出土物装箱",
    desc: "A1 陶片、A2 兽骨、A3 石斧按箱位队列装入暂存箱（单箱 5000g / 20 件）",
    run: (d) => {
      d.archive.packArtifact("A1");
      d.archive.packArtifact("A2");
      d.archive.packArtifact("A3");
    },
  },
  {
    title: "② 签字移交 A1",
    desc: "领队签字移交 A1，移交记录快照当时归属依据（幂等键 TR-KEY-A1）",
    run: (d) =>
      void d.archive.signTransfer({
        artifactIds: ["A1"],
        signedBy: "领队",
        signedAt: "2026-10-06T18:30:00Z",
        idempotencyKey: "TR-KEY-A1",
      }),
  },
  {
    title: "③ 调整 H12 边界",
    desc: "灰坑边界外扩到 (0,0)-(20,10)：未装箱的 A4 归属立即失效重算；已装箱、已移交的保留原依据",
    run: (d) =>
      d.archive.adjustFeatureBoundary("H12", [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ]),
  },
  {
    title: "④ 同步断网批次",
    desc: "平板-07 的探方批次回驻地合并：A5 新增；A2 坐标/层位两边不同留两份待裁定；TR-KEY-A1 重放不新增；TR-KEY-A3 遇上网络中断",
    run: (d) => void d.engine.syncBatch(d.batch, flakyTransport),
  },
  {
    title: "⑤ 按未完成明细重试",
    desc: "只重发失败的移交明细，网络恢复后 TR-KEY-A3 补登，已完成明细不再触碰",
    run: (d) => void d.engine.retryIncomplete(d.batch),
  },
  {
    title: "⑥ 旧档案回填",
    desc: "没有探方批次的旧记录按遗址+发掘日归并成批次；缺发掘日的先挂待核",
    run: (d) => runBackfill(d),
  },
];

const locationLabel: Record<string, string> = {
  field: "现场",
  boxed: "已装箱",
  transferred: "已移交",
};

function App() {
  const demoRef = useRef<DemoState | null>(null);
  if (!demoRef.current) demoRef.current = createDemo();
  const demo = demoRef.current;
  const { archive } = demo;

  const [step, setStep] = useState(0);
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const runStep = (index: number) => {
    steps[index].run(demo);
    setStep(index + 1);
    refresh();
  };

  const artifacts = [...archive.artifacts.values()];
  const pendingConflicts = archive.pendingConflicts();
  const session = archive ? demo.engine.sessionOf(demo.batch.id) : undefined;
  const transferredCount = archive.transfers.reduce((n, t) => n + t.items.length, 0);

  const metrics = [
    { label: "探方 / 地层 / 遗迹", value: `${archive.grids.size} / ${archive.stratums.size} / ${archive.features.size}` },
    { label: "出土物", value: String(artifacts.length) },
    { label: "待裁定冲突", value: String(pendingConflicts.length), warn: pendingConflicts.length > 0 },
    { label: "移交记录 / 件数", value: `${archive.transfers.length} / ${transferredCount}` },
    { label: "旧档待核", value: String(demo.backfill?.pending.length ?? 0), warn: (demo.backfill?.pending.length ?? 0) > 0 },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>当前场景</span>
          <strong>浒湾遗址 T0203：H12 灰坑边界调整 + 平板断网批次回驻地同步</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.warn ? "status-danger" : i % 2 === 0 ? "status-ok" : "status-watch"} />
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>现场流程</p>
            <h2>按顺序执行</h2>
          </div>
        </div>
        <div className="step-list">
          {steps.map((s, i) => (
            <div key={s.title} className={`step ${i < step ? "done" : ""}`}>
              <div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
              <button
                className="primary-action"
                disabled={i !== step}
                onClick={() => runStep(i)}
              >
                {i < step ? "已完成" : i === step ? "执行" : "待前置步骤"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="section-heading">
            <div>
              <p>出土物归属</p>
              <h2>出土物清单</h2>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>名称</th>
                <th>坐标</th>
                <th>层位</th>
                <th>归属依据</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.label}</td>
                  <td>({a.coords.x}, {a.coords.y})</td>
                  <td>{archive.stratums.get(a.stratumId)?.label ?? a.stratumId}</td>
                  <td>{a.attribution.basis}</td>
                  <td>
                    <span className={`tag ${a.attribution.status === "有效" ? "ok" : "warn"}`}>
                      {locationLabel[a.location]} · {a.attribution.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="panel narrow">
          <h2>箱位队列（按剩余承重/件数排队）</h2>
          <div className="box-list">
            {archive.boxQueue().map((b) => (
              <div key={b.id} className="box-card">
                <strong>{b.label}</strong>
                <p>
                  {b.usedWeightGrams}/{b.maxWeightGrams} g · {b.usedPieces}/{b.maxPieces} 件
                </p>
                <p>{b.artifactIds.join("、") || "（空箱）"}</p>
              </div>
            ))}
            {archive.boxQueue().length === 0 && <p className="muted-text">尚未装箱</p>}
          </div>
        </aside>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="section-heading">
            <div>
              <p>同步会话 {session ? `· 批次 ${session.batchId}` : ""}</p>
              <h2>断网批次明细</h2>
            </div>
          </div>
          {!session && <p className="muted-text">执行步骤④后显示每条明细的同步状态</p>}
          {session && (
            <table>
              <thead>
                <tr>
                  <th>明细</th>
                  <th>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {session.items.map((item) => (
                  <tr key={item.recordId}>
                    <td>{item.recordId}</td>
                    <td>
                      <span className={`tag ${item.status === "done" ? "ok" : item.status === "failed" ? "bad" : "warn"}`}>
                        {item.status === "done" ? (item.replayed ? "完成（幂等重放）" : "完成") : item.status === "failed" ? "失败" : "待同步"}
                      </span>
                    </td>
                    <td>{item.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="sub-heading">移交记录（签字后保留原依据）</h2>
          {archive.transfers.length === 0 && <p className="muted-text">暂无移交记录</p>}
          {archive.transfers.map((t) => (
            <div key={t.id} className="transfer-card">
              <strong>{t.id}</strong> · 幂等键 {t.idempotencyKey} · {t.signedBy} 签于 {t.signedAt}
              <ul>
                {t.items.map((item) => (
                  <li key={item.artifactId}>
                    {item.artifactId}：{item.basis}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <aside className="panel narrow">
          <h2>冲突待领队裁定</h2>
          {pendingConflicts.length === 0 && <p className="muted-text">无待裁定冲突</p>}
          {pendingConflicts.map((c) => (
            <div key={c.artifactId} className="conflict-card">
              <strong>{c.artifactId}</strong>
              {c.versions.map((v, i) => (
                <p key={i}>
                  版本{i + 1}（{v.source}）：坐标 ({v.coords.x}, {v.coords.y}) ·{" "}
                  {archive.stratums.get(v.stratumId)?.label ?? v.stratumId}
                </p>
              ))}
              <div className="conflict-actions">
                {c.versions.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      archive.resolveConflict(c.artifactId, i, "领队");
                      refresh();
                    }}
                  >
                    采用版本{i + 1}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <h2>旧档回填</h2>
          {!demo.backfill && <p className="muted-text">执行步骤⑥后显示回填批次与待核清单</p>}
          {demo.backfill && (
            <>
              {demo.backfill.batches.map((b) => (
                <p key={b.id} className="muted-text">
                  批次 {b.id}：{b.records.length} 条
                </p>
              ))}
              {demo.backfill.pending.map((p) => (
                <p key={p.entryId} className="pending-text">
                  {p.entryId} 待核：缺{p.missing.join("、")}
                </p>
              ))}
            </>
          )}
        </aside>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>审计</p>
            <h2>档案日志</h2>
          </div>
        </div>
        <div className="audit-list">
          {archive.auditLog.length === 0 && <p className="muted-text">暂无日志</p>}
          {[...archive.auditLog].reverse().map((entry) => (
            <p key={entry.seq}>
              <span className="tag ok">{entry.kind}</span> {entry.message}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
