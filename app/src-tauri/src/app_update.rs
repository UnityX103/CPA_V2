//! GitHub determines the release; CNB is preferred for that exact package.
use serde::{Deserialize, Serialize};
use std::{future::Future, time::Duration};
use tauri::{ipc::Channel, Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

const CNB: &str = "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json";
const GITHUB: &str = "https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json";
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);

async fn with_fallback<T, A, B>(primary: A, fallback: impl FnOnce() -> B) -> Result<T, String>
where
    A: Future<Output = Result<T, String>>,
    B: Future<Output = Result<T, String>>,
{
    match primary.await {
        Ok(value) => Ok(value),
        Err(first) => fallback()
            .await
            .map_err(|second| format!("Primary source: {first}; fallback source: {second}")),
    }
}

fn package_urls(version: &str, source: &str) -> Result<(String, String), String> {
    semver::Version::parse(version).map_err(|e| e.to_string())?;
    let name = source.rsplit('/').next().unwrap_or_default();
    if name.is_empty()
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._+-".contains(&c))
    {
        return Err("Invalid update package name".into());
    }
    let cnb =
        format!("https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v{version}/{name}");
    let github = format!("https://github.com/UnityX103/CPA_V2/releases/download/v{version}/{name}");
    if source != cnb && source != github {
        return Err("Update package must belong to the selected release and repository".into());
    }
    Ok((cnb, github))
}

async fn check_source(webview: &Webview, endpoint: &str) -> Result<Option<Update>, String> {
    webview
        .updater_builder()
        .endpoints(vec![endpoint
            .parse()
            .map_err(|e| format!("Invalid update endpoint: {e}"))?])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .configure_client(|client| {
            client
                .connect_timeout(CHECK_TIMEOUT)
                .read_timeout(Duration::from_secs(30))
        })
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct ReleaseNotes {
    tag_name: String,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
}

fn format_release_notes(releases: Vec<ReleaseNotes>, current: &semver::Version, latest: &semver::Version) -> String {
    let mut entries: Vec<_> = releases.into_iter().filter_map(|release| {
        let version = semver::Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
        (!release.draft && !release.prerelease && version > *current && version <= *latest)
            .then_some((version, release.body.unwrap_or_else(|| "此版本未提供更新说明。".into())))
    }).collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    entries.dedup_by(|a, b| a.0 == b.0);
    entries.into_iter().map(|(version, body)| format!("## {version}\n{body}"))
        .collect::<Vec<_>>().join("\n\n")
}

async fn cumulative_release_notes(current: &str, latest: &str) -> Result<String, String> {
    let current = semver::Version::parse(current).map_err(|e| e.to_string())?;
    let latest = semver::Version::parse(latest).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().user_agent("CPA-V2-updater")
        .timeout(CHECK_TIMEOUT).build().map_err(|e| e.to_string())?;
    let mut releases = Vec::new();
    for page in 1..=10 {
        let batch: Vec<ReleaseNotes> = client.get(format!(
            "https://api.github.com/repos/UnityX103/CPA_V2/releases?per_page=100&page={page}"))
            .send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        let done = batch.len() < 100;
        releases.extend(batch);
        if done {
            let notes = format_release_notes(releases, &current, &latest);
            return if notes.is_empty() { Err("No release notes found".into()) } else { Ok(notes) };
        }
    }
    Err("Release history exceeded page limit".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

#[tauri::command]
pub async fn check_app_update(webview: Webview) -> Result<Option<UpdateMetadata>, String> {
    if webview.label() != "main" {
        return Err("Updates require the main window".into());
    }
    // A successful GitHub response, including no update, is authoritative.
    let selected = with_fallback(check_source(&webview, GITHUB), || {
        check_source(&webview, CNB)
    })
    .await?;
    if let Some(update) = selected {
        package_urls(&update.version, update.download_url.as_str())?;
        Ok(Some(UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            body: Some(match tokio::time::timeout(Duration::from_secs(20),
                cumulative_release_notes(&update.current_version, &update.version)).await {
                Ok(Ok(notes)) => notes,
                _ => format!("历史版本说明暂时不可用；以下仅显示最新版本内容。\n\n## {}\n{}",
                    update.version, update.body.as_deref().unwrap_or("此版本未提供更新说明。")),
            }),
            rid: webview.resources_table().add(update),
        }))
    } else {
        Ok(None)
    }
}

async fn download_from(
    mut update: Update,
    url: String,
    events: &Channel<DownloadEvent>,
) -> Result<Vec<u8>, String> {
    update.download_url = url
        .parse()
        .map_err(|e| format!("Invalid package URL: {e}"))?;
    update.timeout = Some(Duration::from_secs(30 * 60));
    // Reset progress even when the first attempt failed before receiving bytes.
    let _ = events.send(DownloadEvent::Started {
        content_length: None,
    });
    let mut first_chunk = true;
    update
        .download(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = events.send(DownloadEvent::Started { content_length });
                }
                let _ = events.send(DownloadEvent::Progress { chunk_length });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())
    // Update::download verifies the original manifest signature before returning.
}

#[tauri::command]
pub async fn install_app_update(
    webview: Webview,
    rid: tauri::ResourceId,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Updates require the main window".into());
    }
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    let _ = webview.resources_table().close(rid);
    let (cnb, github) = package_urls(&update.version, update.download_url.as_str())?;
    let bytes = with_fallback(download_from((*update).clone(), cnb, &on_event), || {
        download_from((*update).clone(), github, &on_event)
    })
    .await?;
    let _ = on_event.send(DownloadEvent::Finished);
    // Installation happens once, only after a full, signature-verified download.
    // An installation failure must never trigger a second installation attempt.
    update.install(bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    #[test]
    fn github_success_never_queries_cnb_even_when_up_to_date() {
        tauri::async_runtime::block_on(async {
            let called = Cell::new(false);
            let result = with_fallback(async { Ok::<Option<&str>, String>(None) }, || {
                called.set(true);
                async { Ok(Some("0.1.99")) }
            })
            .await
            .unwrap();
            assert_eq!(result, None);
            assert!(!called.get());
        });
    }
    #[test]
    fn github_failure_queries_cnb() {
        tauri::async_runtime::block_on(async {
            assert_eq!(
                with_fallback(
                    async { Err::<Option<&str>, _>("timeout".into()) },
                    || async { Ok(Some("0.1.33")) }
                )
                .await
                .unwrap(),
                Some("0.1.33")
            );
        });
    }
    #[test]
    fn cnb_package_success_skips_github_download() {
        tauri::async_runtime::block_on(async {
            let bytes = with_fallback(async { Ok::<_, String>(vec![1, 2]) }, || async {
                panic!("GitHub must not download")
            })
            .await
            .unwrap();
            assert_eq!(bytes, vec![1, 2]);
        });
    }
    #[test]
    fn failed_or_invalid_mirror_download_uses_verified_github_bytes() {
        tauri::async_runtime::block_on(async {
            for error in ["404", "timeout", "signature verification failed"] {
                assert_eq!(
                    with_fallback(async { Err::<Vec<u8>, _>(error.into()) }, || async {
                        Ok(vec![3])
                    })
                    .await
                    .unwrap(),
                    vec![3]
                );
            }
            assert!(
                with_fallback(async { Err::<Vec<u8>, _>("CNB down".into()) }, || async {
                    Err("GitHub down".into())
                })
                .await
                .is_err()
            );
        });
    }
    #[test]
    fn downloads_use_exact_selected_version_in_both_directions() {
        let gh = "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.33/app.tar.gz";
        let (cnb, github) = package_urls("0.1.33", gh).unwrap();
        assert_eq!(github, gh);
        assert_eq!(
            cnb,
            "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/download/v0.1.33/app.tar.gz"
        );
        assert_eq!(package_urls("0.1.33", &cnb).unwrap(), (cnb, github));
    }
    #[test]
    fn rejects_other_versions_repositories_and_latest_package_links() {
        for source in [
            "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.32/app.tar.gz",
            "https://github.com/other/repo/releases/download/v0.1.33/app.tar.gz",
            "https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/app.tar.gz",
        ] {
            assert!(package_urls("0.1.33", source).is_err());
        }
    }
}

#[cfg(test)]
mod release_notes_tests {
    use super::*;
    #[test]
    fn notes_cover_only_stable_versions_between_installed_and_latest() {
        let make = |tag: &str, draft, prerelease| ReleaseNotes { tag_name: tag.into(), body: Some(tag.into()), draft, prerelease };
        let notes = format_release_notes(vec![make("v0.2.0", false, false), make("v0.2.1", false, false),
            make("v0.2.2", false, false), make("v0.3.0", false, false), make("v0.2.2-beta.1", false, true),
            make("v0.2.3", true, false)], &"0.2.0".parse().unwrap(), &"0.2.2".parse().unwrap());
        assert_eq!(notes, "## 0.2.2\nv0.2.2\n\n## 0.2.1\nv0.2.1");
    }
}
