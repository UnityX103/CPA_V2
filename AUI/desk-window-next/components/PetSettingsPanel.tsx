"use client";

/**
 * PetSettingsPanel — pixel-exact port of Pencil `v2ZgA` (Pet Settings Panel).
 *
 * The design defines this as an empty 572-wide × fit_content(70) frame with no children
 * (transparent fill, layout vertical, gap 16, no stroke). It is intentionally a placeholder —
 * the existing app/src/ui SettingsPanel renders a "尚未实现" note for usability, but the design
 * itself shows nothing. This component honors the design literally; consumers can render their
 * own placeholder children if needed.
 */

import type { ReactNode } from "react";

export type PetSettingsPanelProps = {
  width?: number;
  className?: string;
  children?: ReactNode;
};

export function PetSettingsPanel({ width = 572, className, children }: PetSettingsPanelProps) {
  return (
    <div
      className={["preview-frame", className].filter(Boolean).join(" ")}
      data-node-id="v2ZgA"
      style={{
        width,
        minHeight: 70,
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "var(--font-maoken)"
      }}
    >
      {children}
    </div>
  );
}
