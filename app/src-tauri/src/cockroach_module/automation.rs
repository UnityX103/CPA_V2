use super::*;

pub const RULES_CHANGED_EVENT: &str = "cockroach-automation-rules-changed";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CockroachAction {
    KillAll,
    SpawnOne,
    StartSimulation,
    StopSimulation,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct CockroachRule {
    pub event: String,
    pub action: CockroachAction,
}

pub fn validate_rules(rules: &[CockroachRule]) -> Result<(), String> {
    if rules.len() > 32 {
        return Err("最多可以添加 32 条事件规则".into());
    }
    for rule in rules {
        if !matches!(
            rule.event.as_str(),
            "focus.started"
                | "focus.ended"
                | "break.started"
                | "break.ended"
                | "focus.present"
                | "break.present"
        ) {
            return Err(format!("不支持的番茄钟事件：{}", rule.event));
        }
    }
    Ok(())
}

fn rules_path(root: &Path) -> PathBuf {
    module_data_dir(root).join("cpa-automation.json")
}

fn default_rules() -> Vec<CockroachRule> {
    vec![
        CockroachRule {
            event: "break.started".into(),
            action: CockroachAction::StartSimulation,
        },
        CockroachRule {
            event: "break.present".into(),
            action: CockroachAction::SpawnOne,
        },
        CockroachRule {
            event: "focus.started".into(),
            action: CockroachAction::StopSimulation,
        },
    ]
}

fn read_rules(root: &Path) -> Result<Vec<CockroachRule>, String> {
    let path = rules_path(root);
    if !path.exists() {
        return Ok(default_rules());
    }
    let rules: Vec<CockroachRule> =
        serde_json::from_slice(&fs::read(path).map_err(|e| format!("无法读取事件规则：{e}"))?)
            .map_err(|e| format!("事件规则格式无效：{e}"))?;
    validate_rules(&rules)?;
    Ok(rules)
}

fn write_rules(root: &Path, rules: &[CockroachRule]) -> Result<(), String> {
    validate_rules(rules)?;
    fs::create_dir_all(module_data_dir(root)).map_err(|e| e.to_string())?;
    let path = rules_path(root);
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(rules).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    replace_file_atomically(&temporary, &path, "保存事件规则")
}

#[tauri::command]
pub fn read_cockroach_automation_rules(
    app: tauri::AppHandle,
) -> Result<Vec<CockroachRule>, String> {
    read_rules(&module_root(&app)?)
}

#[tauri::command]
pub fn save_cockroach_automation_rules(
    app: tauri::AppHandle,
    rules: Vec<CockroachRule>,
) -> Result<Vec<CockroachRule>, String> {
    write_rules(&module_root(&app)?, &rules)?;
    app.emit(RULES_CHANGED_EVENT, &rules)
        .map_err(|e| e.to_string())?;
    Ok(rules)
}

pub(crate) fn execute_action(
    app: &tauri::AppHandle,
    state: &CockroachModuleState,
    action: CockroachAction,
) -> Result<(), String> {
    let _operation = state
        .action_lock
        .lock()
        .map_err(|_| "蟑螂操作状态不可用".to_string())?;
    if state.terminating.load(Ordering::SeqCst) {
        return Err("应用正在退出".into());
    }
    // All rule actions use native enablement, even when invoked without the settings UI.
    if !pack_is_enabled(app, COCKROACH_ID)? {
        return Err("蟑螂入侵功能包已禁用".into());
    }
    let root = module_root(app)?;
    match action {
        CockroachAction::StopSimulation => stop_feature_unlocked(app, state),
        CockroachAction::KillAll => {
            if child_is_running(state) {
                send_control_command(&root, state, "kill-all")?;
            }
            Ok(())
        }
        CockroachAction::StartSimulation | CockroachAction::SpawnOne => {
            if child_is_running(state) {
                // An already-running simulation adds one without resetting the existing population.
                send_control_command(&root, state, "spawn-one")
            } else {
                let resolved = resolve_installed_module(&root)?.ok_or("请先下载蟑螂模块")?;
                write_upstream_config(&root, &read_settings(&root), true)?;
                // The upstream overlay creates exactly one initial cockroach.
                start_child(&root, &resolved, state)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rules_round_trip_preserves_order_and_empty_means_no_automation() {
        let root = std::env::temp_dir().join(format!(
            "cpa-rules-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let rules = vec![
            CockroachRule {
                event: "break.present".into(),
                action: CockroachAction::SpawnOne,
            },
            CockroachRule {
                event: "break.present".into(),
                action: CockroachAction::KillAll,
            },
        ];
        assert_eq!(
            serde_json::to_value(read_rules(&root).unwrap()).unwrap(),
            serde_json::json!([
                { "event": "break.started", "action": "start-simulation" },
                { "event": "break.present", "action": "spawn-one" },
                { "event": "focus.started", "action": "stop-simulation" },
            ])
        );
        write_rules(&root, &rules).unwrap();
        assert_eq!(read_rules(&root).unwrap(), rules);
        write_rules(&root, &[]).unwrap();
        assert!(read_rules(&root).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_unknown_events_actions_and_unbounded_lists() {
        let rule = CockroachRule {
            event: "break.present".into(),
            action: CockroachAction::SpawnOne,
        };
        assert!(validate_rules(&vec![rule; 33]).is_err());
        assert!(validate_rules(&[CockroachRule {
            event: "shell".into(),
            action: CockroachAction::KillAll
        }])
        .is_err());
        assert!(serde_json::from_str::<CockroachRule>(
            r#"{"event":"break.present","action":"shell"}"#
        )
        .is_err());
    }
}
