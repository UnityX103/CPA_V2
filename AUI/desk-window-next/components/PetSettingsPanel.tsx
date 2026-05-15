import { IconTile } from "@/components/IconTile";

type PetSettingsPanelProps = {
  className?: string;
};

export function PetSettingsPanel({ className }: PetSettingsPanelProps) {
  return (
    <section
      className={[
        "flex w-[484px] flex-col gap-4 rounded-[20px] border border-[#F1E5D8] bg-white p-5 shadow-[0_20px_36px_rgba(224,208,193,0.24)]",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#FFF7D9]">
          <IconTile src="/icons/icon-panel-pet.png" alt="宠物设置图标" size={18} />
        </div>
        <div className="flex flex-col gap-[2px]">
          <h3 className="font-[family:var(--font-bricolage)] text-[18px] font-bold leading-none text-[#1A1A1A]">
            宠物设置
          </h3>
          <p className="font-[family:var(--font-dm-sans)] text-[13px] font-medium leading-none text-[#6B7280]">
            开发中。。。
          </p>
        </div>
      </div>
    </section>
  );
}
