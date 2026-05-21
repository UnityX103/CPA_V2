"use client";

const WEEK_ROWS = [
  [["一", ""], ["二", ""], ["三", ""], ["四", ""]],
  [["五", ""], ["六", "✓"], ["日", "✓"]]
] as const;

const ITEMS = [
  { title: "阅读", icon: "/checkin-icons/icon-book-open.svg", color: "#E08C10", amount: "30", unit: "分钟", target: "2" },
  { title: "喝水", icon: "/checkin-icons/icon-droplet.svg", color: "#7C3AED", amount: "2", unit: "杯", target: "10" },
  { title: "专注番茄", icon: "/checkin-icons/icon-clock.svg", color: "#D15F3D", amount: "25", unit: "分钟", target: "4" }
] as const;

export function CheckinPlanEditorPanel() {
  return (
    <section data-node-id="s6g1w-html" style={panel}>
      <header style={between}>
        <Title title="本周计划" subtitle="点击上方星期切换当天计划；空白日期自动继承前一天内容" heading />
        <span style={status}><i style={dot} />按日编辑</span>
      </header>

      <section style={card}>
        <SectionHead title="选择日期" subtitle="点击星期切换到当天计划；绿色表示已完成或休息" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {WEEK_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} style={{ display: "flex", gap: 8 }}>
              {row.map(([day, mark], index) => (
                <button key={day} type="button" style={dayPill(rowIndex === 1 && index > 0)}>
                  <span>{day}</span>
                  {mark ? <small>{mark}</small> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...card, background: "#FFFFFFCC", gap: 10 }}>
        <div style={between}>
          <Title title="周二计划 · 普通打卡日" subtitle="当前示例不是休息日；未填写时会继承前一天内容" />
          <button type="button" style={restToggle}><span>休息日：关</span><i style={switchTrack} /></button>
        </div>
        <Hint color="#D15F3D" text="普通日会显示当天打卡项目；需要跳过当天时再打开休息日开关。" />
      </section>

      <section style={card}>
        <div style={between}>
          <Title title="周二内容" subtitle="非休息日可编辑当天打卡项目；无单独内容时继承前一天" />
          <span style={pill("#FFF1EE", "#D15F3D")}>计划日</span>
        </div>
        <div style={between}>
          <Title title="打卡项目" subtitle="新增时先选择番茄钟或通用；通用标题可编辑" />
          <button type="button" style={primary}>+ 新增栏目</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={typeCard}>
            <div style={between}>
              <Title title="选择新栏目类型" subtitle="先选择类型，再填写每次数量与每日目标" />
              <span style={{ color: "#D15F3D", fontSize: 20 }}>✣</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <TypeOption hot title="番茄钟" subtitle="使用专注时长" mark="↺" />
              <TypeOption title="通用" subtitle="自定义名称与单位" mark="✎" />
            </div>
          </div>

          {ITEMS.map((item) => <ItemRow key={item.title} item={item} />)}
        </div>

        <Hint color="#2D8F4E" green text="开启休息日后，本列表会被“当天休息”状态替换。" />
      </section>

      <button type="button" style={carry}>
        <span><strong>下周沿用当前计划</strong><small>保存后作为当前激活计划的下周默认配置</small></span>
        <i style={{ ...switchTrack, background: "#D15F3D" }} />
      </button>

      <footer style={{ ...between, justifyContent: "flex-end", padding: "4px 0" }}>
        <button type="button" style={secondary}>取消</button>
        <button type="button" style={{ ...primary, width: 128 }}>保存计划</button>
      </footer>
    </section>
  );
}

function ItemRow({ item }: { item: (typeof ITEMS)[number] }) {
  return (
    <div style={{ ...itemRow, borderColor: `${item.color}40` }}>
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon src={item.icon} color={item.color} size={18} />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: item.color, fontSize: 13, fontWeight: 800 }}>{item.title}</div>
          <p style={rowSub}>每次 {item.amount} {item.unit}，目标 {item.target} 次</p>
        </div>
      </div>
      <Metric label="每次" value={item.amount} unit={item.unit} color={item.color} />
      <Metric label="目标" value={item.target} unit="次" color={item.color} />
      <span style={{ color: "#C0A996", fontSize: 18, fontWeight: 800 }}>⋮⋮</span>
    </div>
  );
}

function Metric({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={metric}>
      <span style={{ color: "#A28B79", fontSize: 10, fontWeight: 800 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
        <strong style={{ color, fontSize: 17, lineHeight: 1 }}>{value}</strong>
        <small style={{ color: "#6B7280", fontSize: 10, fontWeight: 800 }}>{unit}</small>
      </span>
    </div>
  );
}

function Icon({ src, color, size = 16 }: { src: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: "inline-block",
        flex: "0 0 auto",
        background: color,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain"
      }}
    />
  );
}

function TypeOption({ hot = false, title, subtitle, mark }: { hot?: boolean; title: string; subtitle: string; mark: string }) {
  return (
    <button type="button" style={{ ...typeOption, ...(hot ? { borderColor: "#E8C4A8", color: "#D15F3D" } : {}) }}>
      <span style={{ gridRow: "span 2", fontSize: 20 }}>{mark}</span>
      <strong style={{ color: "currentColor", fontSize: 12 }}>{title}</strong>
      <small style={{ color: "#6B7280", fontSize: 10, fontWeight: 700 }}>{subtitle}</small>
    </button>
  );
}

function Title({ title, subtitle, heading = false }: { title: string; subtitle: string; heading?: boolean }) {
  const Tag = heading ? "h2" : "strong";
  return (
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: heading ? 3 : 2 }}>
      <Tag style={{ margin: 0, color: "#5B4636", fontSize: heading ? 20 : 13, fontWeight: heading ? 700 : 800, lineHeight: 1.12 }}>
        {title}
      </Tag>
      <p style={{ margin: 0, color: "#6B7280", fontSize: heading ? 13 : 11, fontWeight: 700, lineHeight: 1.25 }}>{subtitle}</p>
    </div>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={between}>
      <strong style={{ color: "#5B4636", fontSize: 14, fontWeight: 800 }}>{title}</strong>
      <span style={{ color: "#6B7280", fontSize: 13, fontWeight: 700 }}>{subtitle}</span>
    </div>
  );
}

function Hint({ text, color, green = false }: { text: string; color: string; green?: boolean }) {
  return (
    <div style={{ ...hint, borderColor: green ? "#BBF7D0" : "#F0D3BC", background: green ? "#F0FDF4" : "#FFF7F0" }}>
      <span style={{ color, fontSize: 16 }}>☷</span>
      <p style={{ margin: 0, color: green ? "#5E8B68" : "#8B6F5C", fontSize: 12, fontWeight: 800 }}>{text}</p>
    </div>
  );
}

const panel = {
  width: 460,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: 16,
  overflow: "hidden",
  border: "1px solid #EFDCCD",
  borderRadius: 24,
  background: "#FFFDFBEE",
  color: "#5B4636",
  fontFamily: "var(--font-maoken)"
} as const;

const between = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } as const;
const card = { display: "flex", flexDirection: "column", gap: 12, padding: 12, border: "1px solid #EFDCCD", borderRadius: 18, background: "#FFFFFFB8" } as const;
const status = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "#FFF1EE", color: "#D15F3D", fontSize: 12, fontWeight: 800 } as const;
const dot = { width: 8, height: 8, borderRadius: 999, background: "currentColor" } as const;
const primary = { border: "1px solid #D15F3D", borderRadius: 999, background: "#D15F3D", color: "#FFFFFF", padding: "7px 10px", fontSize: 12, fontWeight: 800, fontFamily: "inherit" } as const;
const secondary = { width: 104, border: "1px solid #EFDCCD", borderRadius: 999, background: "#FFFFFFCC", color: "#A28B79", padding: "9px 10px", fontSize: 12, fontWeight: 800, fontFamily: "inherit" } as const;
const restToggle = { display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: 999, background: "#F8FAFC", color: "#64748B", fontSize: 12, fontWeight: 800, fontFamily: "inherit" } as const;
const switchTrack = { width: 48, height: 28, borderRadius: 999, background: "#CBD5E1" } as const;
const hint = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid #F0D3BC", borderRadius: 14, background: "#FFF7F0" } as const;
const typeCard = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid #E8C4A8", borderRadius: 16, background: "#FFF7F0" } as const;
const typeOption = { minWidth: 0, flex: 1, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 8, alignItems: "center", padding: "9px 10px", border: "1px solid #E5E7EB", borderRadius: 14, background: "#FFFFFFCC", color: "#5B4636", textAlign: "left", fontFamily: "inherit" } as const;
const itemRow = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 86px 86px 18px", alignItems: "center", gap: 8, padding: 10, border: "1px solid #F0E0D0", borderRadius: 14, background: "#FFFDFBE6" } as const;
const rowSub = { margin: 0, color: "#6B7280", fontSize: 11, fontWeight: 700, lineHeight: 1.2 } as const;
const metric = { width: 86, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 1, padding: "6px 8px", border: "1px solid #E5E7EB", borderRadius: 12, background: "#FFFFFFCC" } as const;
const carry = { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", border: "1px solid #EFDCCD", borderRadius: 18, background: "#FFF7F0", color: "#5B4636", fontFamily: "inherit" } as const;

function dayPill(done: boolean) {
  return {
    flex: 1,
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: `1px solid ${done ? "#86EFAC" : "#E5E7EB"}`,
    borderRadius: 999,
    background: done ? "#DCFCE7" : "#FFFFFFCC",
    color: done ? "#2D8F4E" : "#A28B79",
    fontSize: 12,
    fontWeight: 800,
    fontFamily: "inherit"
  } as const;
}

function pill(bg: string, color: string) {
  return { padding: "5px 8px", borderRadius: 999, background: bg, color, fontSize: 12, fontWeight: 800 } as const;
}
