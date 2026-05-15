import { IconTile } from "@/components/IconTile";

type OnlineSettingsPanelProps = {
  className?: string;
};

export function OnlineSettingsPanel({ className }: OnlineSettingsPanelProps) {
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
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#EEF2FF]">
            <IconTile src="/icons/icon-panel-online.png" alt="联机模式图标" size={18} />
          </div>
          <div className="flex flex-col gap-[2px]">
            <h3 className="font-[family:var(--font-bricolage)] text-[18px] font-bold leading-none text-[#1A1A1A]">
              联机模式
            </h3>
            <p className="font-[family:var(--font-dm-sans)] text-[13px] font-medium leading-none text-[#6B7280]">
              连接、同步与隐私选项。
            </p>
          </div>
        </div>

        <div className="flex h-6 w-11 items-center justify-end rounded-xl bg-[#22C55E] p-[2px]">
          <div className="h-5 w-5 rounded-full bg-white" />
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-[#F6F7F8] p-4">
        <span className="font-[family:var(--font-dm-sans)] text-[12px] font-semibold leading-none text-[#9CA3AF]">
          联机模式
        </span>
        <h4 className="font-[family:var(--font-bricolage)] text-[24px] font-extrabold leading-none text-[#1A1A1A]">
          还在开发中
        </h4>
        <p className="font-[family:var(--font-dm-sans)] text-[13px] font-medium leading-[1.4] text-[#6B7280]">
          该面板当前仅展示开发状态，联机相关设置将在后续版本开放。
        </p>
      </div>
    </section>
  );
}
