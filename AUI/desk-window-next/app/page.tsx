import { PomodoroPanel } from "@/components/PomodoroPanel";
import { PlayerCard } from "@/components/PlayerCard";
import { InputCounterPanel } from "@/components/InputCounterPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PetSettingsPanel } from "@/components/PetSettingsPanel";
import { PomodoroSettingsPanel } from "@/components/PomodoroSettingsPanel";
import { OnlineSettingsPanel } from "@/components/OnlineSettingsPanel";
import { GlobalSettingsPanel } from "@/components/GlobalSettingsPanel";
import { CheckinPlanEditorPanel } from "@/components/CheckinPlanEditorPanel";

/**
 * Preview index — renders each ported component at exact design pixel size on a neutral canvas
 * so the rendered DOM can be screenshot-compared against /baseline/<nodeId>.png from Pencil.
 *
 * Per-component progress in this loop:
 *   YRqeB pomodoroPanel       — ✓
 *   drqFB PlayerCard          — ✓
 *   ZmuFh InputCounterPanel   — ✓
 *   vnYnS Unified Settings Panel — ✓
 *   v2ZgA Pet Settings Panel  — ✓
 *   gs1Tv Pomodoro Settings Panel — ✓
 *   8Le5R Online Settings Panel — ✓
 *   Pdj9C Global Settings Panel  — ✓
 *   s6g1w Check-in Plan Editor Panel — HTML sync
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 12, opacity: 0.5 }}>{title}</h3>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{children}</div>
    </section>
  );
}

export default function Page() {
  return (
    <main className="preview-stage" style={{ flexDirection: "column", alignItems: "flex-start" }}>
      <Section title="YRqeB · pomodoroPanel · 233×155">
        <div data-node-id="YRqeB"><PomodoroPanel /></div>
      </Section>

      <Section title="YRqeB clock states · focus / rest / paused / off">
        <PomodoroPanel clockState="focus" />
        <PomodoroPanel clockState="rest" time="05:00" primaryActionLabel="暂停" />
        <PomodoroPanel clockState="paused" time="12:34" clockProgress={0.5} primaryActionLabel="继续" />
        <PomodoroPanel clockState="off" time="25:00" clockProgress={0} primaryActionLabel="开始" />
      </Section>

      <Section title="drqFB · PlayerCard · 153×94">
        <div data-node-id="drqFB"><PlayerCard /></div>
      </Section>

      <Section title="drqFB phase states">
        <PlayerCard phase="focus" />
        <PlayerCard phase="rest" />
        <PlayerCard phase="paused" />
        <PlayerCard phase="completed" />
        <PlayerCard phase="waiting" name="待加入玩家" keyLabel="—" keyCount={0} appName="—" />
      </Section>

      <Section title="ZmuFh · InputCounterPanel · 128 × auto">
        <div data-node-id="ZmuFh"><InputCounterPanel /></div>
      </Section>

      <Section title="ZmuFh · multi-pill / alt app variants">
        <InputCounterPanel
          pills={[
            { keyLabel: "Space", keyCount: 47 },
            { keyLabel: "↩", keyCount: 12 }
          ]}
        />
        <InputCounterPanel appName="Figma" pills={[{ keyLabel: "⌘", keyCount: 318 }]} />
      </Section>

      <Section title="vnYnS · Unified Settings Panel (shell only) · 460×394">
        <div data-node-id="vnYnS">
          <SettingsPanel showApply>
            <div style={{ opacity: 0.4, fontSize: 12, padding: 32, textAlign: "center" }}>
              contentArea — gs1Tv / 8Le5R / v2ZgA / Pdj9C 将在后续迭代填入
            </div>
          </SettingsPanel>
        </div>
      </Section>

      <Section title="vnYnS tab states (pet active → v2ZgA empty placeholder)">
        <SettingsPanel activeTab="online">
          <div style={{ opacity: 0.4, fontSize: 12, padding: 32, textAlign: "center" }}>8Le5R 联机面板</div>
        </SettingsPanel>
        <SettingsPanel activeTab="pet">
          <PetSettingsPanel />
        </SettingsPanel>
        <SettingsPanel activeTab="global" showApply>
          <div style={{ opacity: 0.4, fontSize: 12, padding: 32, textAlign: "center" }}>Pdj9C 全局面板</div>
        </SettingsPanel>
      </Section>

      <Section title="v2ZgA · Pet Settings Panel · 572 × ≥70 (empty by design)">
        <div data-node-id="v2ZgA">
          <PetSettingsPanel>
            <div style={{ fontSize: 11, color: "#9CA3AF", padding: 4 }}>
              （设计稿空占位，渲染时高度跟随内容）
            </div>
          </PetSettingsPanel>
        </div>
      </Section>

      <Section title="gs1Tv · Pomodoro Settings content · standalone (572 wide)">
        <div data-node-id="gs1Tv" style={{ width: 572 }}>
          <PomodoroSettingsPanel />
        </div>
      </Section>

      <Section title="gs1Tv mounted inside vnYnS shell">
        <SettingsPanel activeTab="pomodoro" showApply>
          <PomodoroSettingsPanel />
        </SettingsPanel>
      </Section>

      <Section title="8Le5R · Online Settings content · standalone (572 wide)">
        <div data-node-id="8Le5R" style={{ width: 572 }}>
          <OnlineSettingsPanel />
        </div>
      </Section>

      <Section title="8Le5R · variants (not-joined / connecting / joined w/o reconnect)">
        <div style={{ width: 360 }}>
          <OnlineSettingsPanel joinedRoom={null} />
        </div>
        <div style={{ width: 360, position: "relative" }}>
          <OnlineSettingsPanel joinedRoom={null} connecting />
        </div>
        <div style={{ width: 360 }}>
          <OnlineSettingsPanel
            joinedRoom={{
              name: "STUDY-42",
              members: [{ name: "我", phase: "focus", isSelf: true }],
              reconnecting: false
            }}
            history={[]}
          />
        </div>
      </Section>

      <Section title="8Le5R mounted inside vnYnS shell">
        <SettingsPanel activeTab="online">
          <OnlineSettingsPanel />
        </SettingsPanel>
      </Section>

      <Section title="Pdj9C · Global Settings content · standalone (572 wide)">
        <div data-node-id="Pdj9C" style={{ width: 572 }}>
          <GlobalSettingsPanel />
        </div>
      </Section>

      <Section title="Pdj9C · scale / display / bindings variants">
        <div style={{ width: 360 }}>
          <GlobalSettingsPanel scaleProgress={0.1} scaleLabel="0.5×" display="显示器 2" />
        </div>
        <div style={{ width: 360 }}>
          <GlobalSettingsPanel scaleProgress={1} scaleLabel="1.5×" bindings={[]} />
        </div>
        <div style={{ width: 360 }}>
          <GlobalSettingsPanel
            bindingsEnabled={false}
            bindings={[{ label: "F2" }, { label: "Ctrl+Z", synced: true }, { label: "PageDown" }]}
          />
        </div>
      </Section>

      <Section title="Pdj9C mounted inside vnYnS shell">
        <SettingsPanel activeTab="global" showApply>
          <GlobalSettingsPanel />
        </SettingsPanel>
      </Section>

      <Section title="s6g1w · Check-in Plan Editor Panel · 460×898">
        <CheckinPlanEditorPanel />
      </Section>
    </main>
  );
}
