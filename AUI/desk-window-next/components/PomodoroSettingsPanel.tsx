import { IconTile } from "@/components/IconTile";

type PomodoroSettingsPanelProps = {
  className?: string;
};

function StatusSwitch() {
  return (
    <div className="flex items-center gap-2 rounded-full bg-[#EEF2FF] px-[10px] py-[4px]">
      <span className="font-[family:var(--font-dm-sans)] text-[11px] font-bold leading-none text-[#4F46E5]">
        已启用
      </span>
      <div className="flex h-[18px] w-8 items-center justify-end rounded-full bg-[#6366F1] p-[2px]">
        <div className="h-[14px] w-[14px] rounded-full bg-white" />
      </div>
    </div>
  );
}

function MetricCard({
  tone,
  label,
  value,
  suffix
}: {
  tone: "neutral" | "warm";
  label: string;
  value: string;
  suffix: string;
}) {
  const isWarm = tone === "warm";

  return (
    <div
      className={[
        "flex w-full flex-col gap-[10px] rounded-2xl p-4",
        isWarm ? "bg-[#FFF7D9]" : "bg-[#F6F7F8]"
      ].join(" ")}
    >
      <span
        className="font-[family:var(--font-dm-sans)] text-[12px] font-semibold leading-none"
        style={{ color: isWarm ? "#D97706" : "#9CA3AF" }}
      >
        {label}
      </span>
      <div
        className="flex items-center justify-between rounded-xl border bg-white px-[14px] py-3"
        style={{
          borderColor: isWarm ? "#F3D28B" : "#E5E7EB",
          backgroundColor: isWarm ? "#FFFFFFB8" : "#FFFFFFCC"
        }}
      >
        <span className="font-[family:var(--font-bricolage)] text-[24px] font-extrabold leading-none text-[#1A1A1A]">
          {value}
        </span>
        <span
          className="font-[family:var(--font-dm-sans)] text-[13px] font-semibold leading-none"
          style={{ color: isWarm ? "#A16207" : "#6B7280" }}
        >
          {suffix}
        </span>
      </div>
    </div>
  );
}

function SettingRow({
  icon,
  iconAlt,
  label,
  right
}: {
  icon: string;
  iconAlt: string;
  label: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-[#F6F7F8] px-4 py-[14px]">
      <div className="flex items-center gap-[10px]">
        <IconTile src={icon} alt={iconAlt} size={18} />
        <span className="font-[family:var(--font-dm-sans)] text-[14px] font-medium leading-none text-[#1A1A1A]">
          {label}
        </span>
      </div>
      {right}
    </div>
  );
}

export function PomodoroSettingsPanel({ className }: PomodoroSettingsPanelProps) {
  return (
    <section
      className={[
        "flex w-[484px] flex-col gap-4 rounded-[20px] border border-[#F1E5D8] bg-white p-5 shadow-[0_20px_36px_rgba(224,208,193,0.24)]",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#FFF1EE]">
            <IconTile
              src="/icons/icon-panel-pomodoro-badge.png"
              alt="番茄钟设置图标"
              size={18}
            />
          </div>
          <div className="flex flex-col gap-[2px]">
            <h3 className="font-[family:var(--font-bricolage)] text-[18px] font-bold leading-none text-[#1A1A1A]">
              番茄钟设置
            </h3>
            <p className="font-[family:var(--font-dm-sans)] text-[13px] font-medium leading-none text-[#6B7280]">
              专注周期、休息时长与提醒方式。
            </p>
          </div>
        </div>

        <StatusSwitch />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard tone="neutral" label="专注时长" value="25" suffix="分钟" />
        <MetricCard tone="warm" label="休息时长" value="5" suffix="分钟" />
      </div>

      <div className="flex flex-col gap-[10px]">
        <SettingRow
          icon="/icons/icon-panel-monitor.png"
          iconAlt="阶段切换窗口提示图标"
          label="阶段切换时自动指定窗口提示"
          right={
            <div className="flex h-[26px] w-11 items-center justify-end rounded-2xl bg-[#6366F1] p-1">
              <div className="h-[18px] w-[18px] rounded-full bg-white" />
            </div>
          }
        />
        <SettingRow
          icon="/icons/icon-panel-bell.png"
          iconAlt="提示音图标"
          label="结束提示音"
          right={
            <span className="font-[family:var(--font-dm-sans)] text-[12px] font-bold leading-none text-[#6366F1]">
              柔和铃声
            </span>
          }
        />
      </div>
    </section>
  );
}
