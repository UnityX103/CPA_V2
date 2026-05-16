"use client";

import type { ReactNode } from "react";

/**
 * OnlineSettingsPanel — pixel-exact port of Pencil `8Le5R` (Online Settings Panel content).
 *
 * Pencil structure (transparent frame, vertical, gap 16, width fill_container(572)):
 *
 *   FUrip onlAutoRow         align center, radius 16, fill #F6F7F8, justify space_between,
 *                            padding [14,16], width fill
 *     vjNdN onlAutoLabel     "自动联网" 14px 500 #1A1A1A
 *     Gk34w onlAutoToggle    NGo9f Toggle Switch (44×24, on #22C55E, knob 20×20 right)
 *
 *   ArRDI onlJoinCard        vertical, gap 12, radius 16, fill #F6F7F8, padding 16, width fill
 *     RBtPW onlJoinTitle     "加入房间" 14px 700 #1A1A1A
 *     wAczS onlNameRow       vertical, gap 6
 *       adXUR "用户名"        12px 600 #6B7280
 *       xsdHs onlNameInput   (Input/Text brmHc) radius 12, fill #FFFFFFCC, padding [12,14], stroke 1 #E5E7EB
 *     cwauk onlRoomRow       same shape with "房间号" + "ROOM-001"
 *     3srno onlJoinBtn       Za5wE Primary, "加入房间", width fill_container
 *
 *   EK2CF onlRoomCard        vertical, gap 12, radius 16, fill #F0FDF4, stroke 1 #BBF7D0, padding 16
 *     rjTse onlReconnectBanner (justify center, radius 6, fill #FFF4CC, padding [6,10])
 *       "正在重新连接..." 12px 500 #8A6D00
 *     LSMa7 onlRoomHead      horizontal, align center, justify space_between, width fill
 *       ZjLcu onlRoomInfo    vertical, gap 2
 *         wRsZd onlRoomNameRow  horizontal, gap 8, align center
 *           p2Em5 "ROOM-001"   16px 700 #166534
 *           XQm6i onlCopyBtn   Button/Copy j9CVE — padding [6,12], radius 999, fill #F0E0D0,
 *                              width 56, "复制" 12px 700 #A28B79
 *         E0T4Z              "已连接 · 3 位成员" 12px 500 #4ADE80
 *       sJ7o1 onlExitBtn     secondary chip — padding [7,12], radius 999, fill #FFFFFF, stroke 1 #E8C4A8,
 *                            "退出房间" 12px 700 #A28B79
 *     RadUG onlMemberList    vertical, gap 8
 *       member items (ixVy7) — padding [10,12], radius 10, fill #FFFFFFCC, stroke 1 #E5E7EB,
 *                              gap 10, align center
 *         dot 8×8 (#4ADE80 online / #D1D5DB idle)
 *         name 13px 500 #1A1A1A (self: 700)
 *         spacer (height 1, width fill)
 *         status 12px 600 (focus #6366F1 / rest #D97706 / idle #9CA3AF)
 *
 *   E3S4e onlHistCard        vertical, gap 10, radius 16, fill #F6F7F8, padding 16
 *     BCEXS                  "历史房间" 14px 700 #1A1A1A
 *     bSMet items            RoomHistoryItem — padding [10,12], radius 10, fill #FFFFFFCC, stroke 1 #E5E7EB,
 *                            gap 10, align center
 *       CZdYW name 13px 600 #1A1A1A | spacer | Pk7mU time 12px 500 #9CA3AF | Gh67v log-in 14×14 #6366F1
 *
 *   3aoUs onlBusyOverlay     enabled:false in design → opt-in via `connecting` prop
 *                            absolute, fill #FFFFFFD9, radius 16, justify center
 *                            "正在加入房间…" 14px 700 #1A1A1A
 */

export type OnlinePhase = "focus" | "rest" | "idle";

export type RoomMember = {
  name: string;
  phase: OnlinePhase;
  /** Self marker: bold name */
  isSelf?: boolean;
};

export type RoomHistory = {
  name: string;
  time: string;
};

export type OnlineSettingsPanelProps = {
  autoConnect?: boolean;
  joinedRoom?: {
    name: string;
    members: RoomMember[];
    reconnecting?: boolean;
  } | null;
  history?: RoomHistory[];
  connecting?: boolean;
  width?: number | string;
  className?: string;
};

const DEFAULT_HISTORY: RoomHistory[] = [
  { name: "ROOM-001", time: "昨天" },
  { name: "STUDY-42", time: "3 天前" }
];

const DEFAULT_ROOM = {
  name: "ROOM-001",
  members: [
    { name: "小明", phase: "focus" as const },
    { name: "小红", phase: "rest" as const },
    { name: "我", phase: "idle" as const, isSelf: true }
  ],
  reconnecting: true
};

const PHASE_LABEL: Record<OnlinePhase, { label: string; color: string }> = {
  focus: { label: "专注中", color: "#6366F1" },
  rest:  { label: "休息中", color: "#D97706" },
  idle:  { label: "未开始", color: "#9CA3AF" }
};

export function OnlineSettingsPanel({
  autoConnect = true,
  joinedRoom = DEFAULT_ROOM,
  history = DEFAULT_HISTORY,
  connecting = false,
  width = "100%",
  className
}: OnlineSettingsPanelProps) {
  return (
    <div
      className={["preview-frame", className].filter(Boolean).join(" ")}
      data-node-id="8Le5R"
      style={{
        position: "relative",
        width,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "transparent",
        fontFamily: "var(--font-maoken)"
      }}
    >
      {/* FUrip — onlAutoRow */}
      <AutoConnectRow checked={autoConnect} />

      {/* ArRDI — onlJoinCard (always rendered in this preview; in app it hides when joined) */}
      <JoinCard />

      {/* EK2CF — onlRoomCard (joined state) */}
      {joinedRoom && (
        <RoomCard
          roomName={joinedRoom.name}
          members={joinedRoom.members}
          reconnecting={joinedRoom.reconnecting}
        />
      )}

      {/* E3S4e — onlHistCard */}
      <HistoryCard items={history} />

      {/* 3aoUs — onlBusyOverlay (opt-in) */}
      {connecting && <BusyOverlay />}
    </div>
  );
}

/* ---------- FUrip — onlAutoRow ---------- */
function AutoConnectRow({ checked }: { checked: boolean }) {
  return (
    <RowCard data-node-id="FUrip">
      <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", lineHeight: 1 }}>自动联网</span>
      <Toggle checked={checked} />
    </RowCard>
  );
}

/* ---------- ArRDI — onlJoinCard ---------- */
function JoinCard() {
  return (
    <Card data-node-id="ArRDI">
      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>加入房间</span>
      <LabeledInput label="用户名" value="我的昵称" />
      <LabeledInput label="房间号" value="ROOM-001" />
      <PrimaryButton label="加入房间" />
    </Card>
  );
}

function LabeledInput({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", lineHeight: 1 }}>{label}</span>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 12,
          background: "#FFFFFFCC",
          border: "1px solid #E5E7EB",
          fontSize: 14,
          fontWeight: 500,
          color: "#1A1A1A",
          lineHeight: 1,
          boxSizing: "border-box",
          width: "100%"
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ---------- EK2CF — onlRoomCard ---------- */
function RoomCard({
  roomName,
  members,
  reconnecting
}: {
  roomName: string;
  members: RoomMember[];
  reconnecting?: boolean;
}) {
  return (
    <div
      data-node-id="EK2CF"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 16,
        background: "#F0FDF4",
        border: "1px solid #BBF7D0",
        width: "100%",
        boxSizing: "border-box"
      }}
    >
      {reconnecting && (
        <div
          data-node-id="rjTse"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "6px 10px",
            borderRadius: 6,
            background: "#FFF4CC",
            width: "100%",
            boxSizing: "border-box"
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: "#8A6D00", lineHeight: 1 }}>
            正在重新连接...
          </span>
        </div>
      )}

      {/* LSMa7 — onlRoomHead */}
      <div
        data-node-id="LSMa7"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          gap: 12
        }}
      >
        {/* ZjLcu — onlRoomInfo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {/* wRsZd — onlRoomNameRow */}
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#166534", lineHeight: 1 }}>{roomName}</span>
            {/* XQm6i — onlCopyBtn (Button/Copy j9CVE) */}
            <button
              type="button"
              style={{
                width: 56,
                padding: "6px 12px",
                borderRadius: 999,
                background: "#F0E0D0",
                border: "none",
                color: "#A28B79",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--font-maoken)",
                lineHeight: 1,
                cursor: "pointer",
                boxSizing: "border-box",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              复制
            </button>
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#4ADE80", lineHeight: 1 }}>
            已连接 · {members.length} 位成员
          </span>
        </div>

        {/* sJ7o1 — onlExitBtn */}
        <button
          type="button"
          style={{
            padding: "7px 12px",
            borderRadius: 999,
            background: "#FFFFFF",
            border: "1px solid #E8C4A8",
            color: "#A28B79",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "var(--font-maoken)",
            lineHeight: 1,
            cursor: "pointer",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}
        >
          退出房间
        </button>
      </div>

      {/* RadUG — onlMemberList */}
      <div data-node-id="RadUG" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {members.map((m, i) => (
          <MemberItem key={i} {...m} />
        ))}
      </div>
    </div>
  );
}

function MemberItem({ name, phase, isSelf }: RoomMember) {
  const status = PHASE_LABEL[phase];
  const dotColor = phase === "idle" ? "#D1D5DB" : "#4ADE80";

  return (
    <div
      data-node-id="ixVy7"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: "#FFFFFFCC",
        border: "1px solid #E5E7EB",
        width: "100%",
        boxSizing: "border-box"
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, display: "inline-block" }} />
      <span style={{ fontSize: 13, fontWeight: isSelf ? 700 : 500, color: "#1A1A1A", lineHeight: 1 }}>
        {name}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: status.color, lineHeight: 1, flexShrink: 0 }}>
        {status.label}
      </span>
    </div>
  );
}

/* ---------- E3S4e — onlHistCard ---------- */
function HistoryCard({ items }: { items: RoomHistory[] }) {
  return (
    <Card data-node-id="E3S4e" gap={10}>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>历史房间</span>
      {items.map((it, i) => (
        <HistoryRow key={i} {...it} />
      ))}
    </Card>
  );
}

function HistoryRow({ name, time }: RoomHistory) {
  return (
    <div
      data-node-id="bSMet"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: "#FFFFFFCC",
        border: "1px solid #E5E7EB",
        width: "100%",
        boxSizing: "border-box"
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", lineHeight: 1 }}>{name}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: "#9CA3AF", lineHeight: 1 }}>{time}</span>
      <LogInIcon />
    </div>
  );
}

/* ---------- 3aoUs — onlBusyOverlay ---------- */
function BusyOverlay() {
  return (
    <div
      data-node-id="3aoUs"
      style={{
        position: "absolute",
        inset: 0,
        background: "#FFFFFFD9",
        borderRadius: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>
        正在加入房间…
      </span>
    </div>
  );
}

/* ============================================================
 * Shared primitives
 * ============================================================ */

function RowCard({ children, ...rest }: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        borderRadius: 16,
        background: "#F6F7F8",
        width: "100%",
        gap: 10,
        boxSizing: "border-box"
      }}
    >
      {children}
    </div>
  );
}

function Card({
  children,
  gap = 12,
  ...rest
}: { children: ReactNode; gap?: number } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        padding: 16,
        borderRadius: 16,
        background: "#F6F7F8",
        width: "100%",
        boxSizing: "border-box"
      }}
    >
      {children}
    </div>
  );
}

/* NGo9f — Toggle Switch: 44×24, padding 2, knob 20×20 white, on bg #22C55E / off #B5A49A */
function Toggle({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        background: checked ? "#22C55E" : "#B5A49A",
        padding: 2,
        position: "relative",
        boxSizing: "border-box",
        flexShrink: 0
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#FFFFFF",
          transform: checked ? "translateX(20px)" : "translateX(0)",
          transition: "transform 0.2s"
        }}
      />
    </div>
  );
}

/* Za5wE — Button/Primary: padding [7,12], radius 999, fill #D15F3D, "Button" 12px 700 white, width 120 */
function PrimaryButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      style={{
        width: "100%",
        padding: "7px 12px",
        borderRadius: 999,
        background: "#D15F3D",
        color: "#FFFFFF",
        fontFamily: "var(--font-maoken)",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        border: "none",
        cursor: "pointer",
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 38
      }}
    >
      {label}
    </button>
  );
}

function LogInIcon() {
  // lucide `log-in` 14×14 #6366F1 — Gh67v
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6366F1"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}
