import { Clock, type ClockState } from "@/components/Clock";

type PomodoroPanelProps = {
  className?: string;
  title?: string;
  streakLabel?: string;
  streakValue?: string;
  time?: string;
  clockState?: ClockState;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
};

function ActionButton({
  label,
  primary
}: {
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={[
        "flex h-8 w-24 items-center justify-center rounded-full text-[12px] font-bold leading-none transition-transform duration-200 hover:-translate-y-px",
        primary
          ? "bg-[#D15F3D] text-white shadow-[0_10px_24px_rgba(209,95,61,0.28)]"
          : "border border-[#E8C4A8] bg-white text-[#A28B79]"
      ].join(" ")}
    >
      <span className="font-[family:var(--font-dm-sans)]">{label}</span>
    </button>
  );
}

export function PomodoroPanel({
  className,
  title = "番茄钟",
  streakLabel = "连续专注",
  streakValue = "3 次",
  time = "24:18",
  clockState = "off",
  primaryActionLabel = "开始",
  secondaryActionLabel = "跳过"
}: PomodoroPanelProps) {
  return (
    <section
      className={[
        "flex w-[286px] flex-col gap-[18px] rounded-[24px] border border-[#EFDCCD] bg-[#FFFDFBEE] p-[18px] shadow-[0_16px_24px_rgba(199,133,84,0.19)] backdrop-blur-[14px]",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start justify-between">
        <h2 className="font-[family:var(--font-bricolage)] text-[20px] font-bold leading-none text-[#5B4636]">
          {title}
        </h2>
        <div className="flex flex-col items-end gap-px font-[family:var(--font-inter)]">
          <span className="text-[9px] font-medium leading-none text-[#A28B79]">{streakLabel}</span>
          <span className="text-[14px] font-bold leading-none text-[#D15F3D]">{streakValue}</span>
        </div>
      </div>

      <div className="flex items-center gap-[22px] px-4">
        <Clock state={clockState} time={time} />

        <div className="flex w-24 flex-col gap-2">
          <ActionButton label={primaryActionLabel} primary />
          <ActionButton label={secondaryActionLabel} />
        </div>
      </div>
    </section>
  );
}
