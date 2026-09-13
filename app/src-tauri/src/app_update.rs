//! Select the freshest usable release while preferring the CNB download mirror.
use serde::Serialize;
use std::time::Duration;
use tauri::{Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

const CNB: &str = "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json";
const GITHUB: &str = "https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json";
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);

fn select_update<T>(
    cnb: Result<Option<T>, String>,
    github: Result<Option<T>, String>,
    version: impl Fn(&T) -> &str,
) -> Result<Option<T>, String> {
    match (cnb, github) {
        (Ok(Some(cnb)), Ok(Some(github))) => {
            let cnb_version = semver::Version::parse(version(&cnb)).map_err(|e| e.to_string())?;
            let github_version =
                semver::Version::parse(version(&github)).map_err(|e| e.to_string())?;
            Ok(Some(if github_version > cnb_version {
                github
            } else {
                cnb
            }))
        }
        (Ok(Some(cnb)), _) => Ok(Some(cnb)),
        (_, Ok(github)) => Ok(github),
        (_, Err(error)) => Err(error),
    }
}

async fn check_source(webview: &Webview, endpoint: &str) -> Result<Option<Update>, String> {
    webview
        .updater_builder()
        .endpoints(vec![endpoint
            .parse()
            .map_err(|e| format!("Invalid update endpoint: {e}"))?])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_app_update(webview: Webview) -> Result<Option<UpdateMetadata>, String> {
    if webview.label() != "main" {
        return Err("Updates can only be checked from the main window".into());
    }
    // Check both small manifests concurrently. Package downloads still use the
    // selected provider and the updater plugin's existing signature verification.
    let (cnb, github) =
        futures_util::future::join(check_source(&webview, CNB), check_source(&webview, GITHUB))
            .await;
    let selected = select_update(cnb, github, |update| &update.version)?;
    Ok(selected.map(|update| UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Debug, PartialEq)]
    struct Release(&'static str, &'static str);
    fn choose(
        cnb: Result<Option<Release>, String>,
        github: Result<Option<Release>, String>,
    ) -> Result<Option<Release>, String> {
        select_update(cnb, github, |r| r.0)
    }
    #[test]
    fn equal_versions_prefer_cnb() {
        assert_eq!(
            choose(
                Ok(Some(Release("0.1.33", "cnb"))),
                Ok(Some(Release("0.1.33", "github")))
            )
            .unwrap(),
            Some(Release("0.1.33", "cnb"))
        );
    }
    #[test]
    fn stale_cnb_uses_newer_github_even_when_both_have_updates() {
        assert_eq!(
            choose(
                Ok(Some(Release("0.1.9", "cnb"))),
                Ok(Some(Release("0.1.10", "github")))
            )
            .unwrap(),
            Some(Release("0.1.10", "github"))
        );
    }
    #[test]
    fn cnb_current_does_not_hide_github_update() {
        assert_eq!(
            choose(Ok(None), Ok(Some(Release("0.1.33", "github")))).unwrap(),
            Some(Release("0.1.33", "github"))
        );
    }
    #[test]
    fn unavailable_cnb_uses_github() {
        assert_eq!(
            choose(Err("timeout".into()), Ok(Some(Release("0.1.33", "github")))).unwrap(),
            Some(Release("0.1.33", "github"))
        );
    }
    #[test]
    fn unavailable_github_keeps_usable_cnb_update() {
        assert_eq!(
            choose(Ok(Some(Release("0.1.33", "cnb"))), Err("timeout".into())).unwrap(),
            Some(Release("0.1.33", "cnb"))
        );
    }
    #[test]
    fn failed_freshness_check_is_not_reported_as_up_to_date() {
        assert!(choose(Ok(None), Err("timeout".into())).is_err());
        assert!(choose(Err("timeout".into()), Err("timeout".into())).is_err());
        assert_eq!(choose(Ok(None), Ok(None)).unwrap(), None);
    }
}
