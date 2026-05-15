"use client";

import { useState } from "react";
import { IconTile } from "@/components/IconTile";
import { OnlineSettingsPanel } from "@/components/OnlineSettingsPanel";
import { PetSettingsPanel } from "@/components/PetSettingsPanel";
import { PomodoroPanel } from "@/components/PomodoroPanel";
import { PomodoroSettingsPanel } from "@/components/PomodoroSettingsPanel";

type PanelKey = "pomodoro" | "online" | "pet";

const MENU_ITEMS = [
  {
    id: "pomodoro",
    icon: "/icons/icon-timer.png",
    iconAlt: "番茄钟设置图标",
    label: "番茄钟设置"
  },
  {
    id: "online",
    icon: "/icons/icon-wifi.png",
    iconAlt: "联机设置图标",
    label: "联机设置"
  },
  {
    id: "pet",
    icon: "/icons/icon-pets.png",
    iconAlt: "宠物设置图标",
    label: "宠物设置"
  }
] as const satisfies ReadonlyArray<{
  id: PanelKey;
  icon: string;
  iconAlt: string;
  label: string;
}>;

function HoverHint() {
  return (
    <div className="absolute left-[303px] top-[30px] flex h-12 w-[174px] items-center gap-2 rounded-full border border-[#F2DEC3] bg-[#FFFDF2] px-[14px] py-[10px] shadow-[0_8px_18px_rgba(237,217,193,0.18)]">
      <IconTile src="/icons/icon-mouse.png" alt="右键提示图标" size={18} />
      <span className="font-[family:var(--font-dm-sans)] text-[13px] font-bold leading-none text-[#7B6657]">
        悬停后右键
      </span>
    </div>
  );
}

function MenuButton({
  icon,
  iconAlt,
  label,
  onClick
}: {
  icon: string;
  iconAlt: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-[108px] items-center gap-[6px] rounded-[20px] border border-[#F0DDD0] bg-[#FFFFFFE8] px-2 text-left shadow-[0_6px_14px_rgba(240,221,208,0.28)] backdrop-blur-[8px] transition-transform duration-200 hover:-translate-y-px"
    >
      <IconTile src={icon} alt={iconAlt} size={14} />
      <span className="font-[family:var(--font-dm-sans)] text-[11px] font-semibold leading-none text-[#5B4636]">
        {label}
      </span>
    </button>
  );
}

function PanelOverlay({
  activePanel,
  onClose
}: {
  activePanel: PanelKey;
  onClose: () => void;
}) {
  const panel = {
    pomodoro: <PomodoroSettingsPanel />,
    online: <OnlineSettingsPanel />,
    pet: <PetSettingsPanel />
  }[activePanel];

  return (
    <div className="absolute inset-0 z-20">
      <button
        type="button"
        aria-label="关闭面板"
        className="absolute inset-0 bg-[#FCFAFAE6] backdrop-blur-[4px]"
        onClick={onClose}
      />
      <div className="absolute inset-0 flex items-center justify-center px-3 py-[11px]">
        <div className="relative z-10">{panel}</div>
      </div>
    </div>
  );
}

export function DeskWindow() {
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);

  return (
    <div className="desk-window-stage">
      <div className="desk-window-wrap relative overflow-hidden rounded-[28px] border border-[#F1E5D8] bg-[#FCFAFA] shadow-[0_30px_80px_rgba(197,156,127,0.18)]">
        <HoverHint />
        <PomodoroPanel className="absolute left-[13px] top-[107px]" />

        <div className="absolute right-3 top-[114px] z-30 flex w-[124px] flex-col gap-2 rounded-[14px] border border-[#F0DDD0] bg-[#FFFFFFE8] p-2 shadow-[0_14px_26px_rgba(240,221,208,0.28)] backdrop-blur-[8px]">
          {MENU_ITEMS.map((item) => (
            <MenuButton
              key={item.id}
              icon={item.icon}
              iconAlt={item.iconAlt}
              label={item.label}
              onClick={() => setActivePanel(item.id)}
            />
          ))}
        </div>

        {activePanel ? <PanelOverlay activePanel={activePanel} onClose={() => setActivePanel(null)} /> : null}
      </div>
    </div>
  );
}
