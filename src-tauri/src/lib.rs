use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Files the OS asked us to open (file association double-click, CLI args)
/// before the frontend registered its listener. Drained once by
/// `take_pending_open_files`; after that, opens are emitted live.
struct OpenState {
    frontend_ready: bool,
    pending: Vec<String>,
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<'_, Mutex<OpenState>>) -> Vec<String> {
    let mut s = state.lock().unwrap();
    s.frontend_ready = true;
    std::mem::take(&mut s.pending)
}

/// SPEC18 §2: native print of the calling webview (the printview window).
/// `window.print()` is a silent no-op in WKWebView — this is the real one,
/// opening the OS print dialog (macOS: PDF ▾ / Save as PDF).
#[tauri::command]
fn print_view(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    webview_window.print().map_err(|e| e.to_string())
}

/// SPEC35 §1: move a file or directory (recursively) to the OS Trash /
/// Recycle Bin. The `trash` crate is the only dependency — no network, no
/// capability beyond this command.
#[tauri::command]
fn trash_entry(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// PRD 011 Req 12: the LLM request as plain data — exactly the `LlmHttpRequest`
/// the seam (`src/lib/llmSeam.ts`) builds. No provider vocabulary reaches the
/// Rust side: this is a method, a URL, headers and a body, and nothing else.
#[derive(serde::Deserialize)]
struct LlmHttpRequest {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
}

/// PRD 011 Req 12: the HTTP exchange that happened. A non-2xx status is one of
/// these, not an error — `readResponse` in `src/lib/llmProviders.ts` is what
/// classifies 401/403 (bad key), 404 (unknown model) and 429 (rate limited),
/// so only a failure where no exchange happened at all takes the error arm.
#[derive(serde::Serialize)]
struct LlmHttpResponse {
    status: u16,
    body: String,
    /// PRD 011 Req 10: lower-cased names, so `llmProviders.ts`'s `retry-after`
    /// lookup keeps working and the rate-limit hint survives the round trip.
    headers: HashMap<String, String>,
}

/// PRD 011 Req 12: a finite deadline, so a hung provider becomes an
/// unreachable host rather than a permanently pending IPC call.
const LLM_TIMEOUT: Duration = Duration::from_secs(120);

/// PRD 011 Req 12: what makes this a provider transport rather than a general
/// web proxy — checked before anything is sent, so a rejected input is a
/// failure value and not a request. `http` stays allowed alongside `https`
/// because Req 5's custom OpenAI-compatible endpoint may be a locally-run
/// server; `file:`, `data:` and scheme-less inputs are refused.
///
/// The window check scopes the command instead of a capability (app-defined
/// commands are not capability-gated): the settings/about windows are the
/// `aux` capability's dumb views, and PRD 011 Req 10's test-connection
/// round-trips through the main window.
///
/// PRD 011 Req 7: every reason names at most the method, the scheme or the
/// window label — never a header and never the body.
fn check_llm_request(window_label: &str, method: &str, url: &str) -> Result<(), String> {
    if window_label != "main" {
        return Err(format!(
            "llm_request answers only the main window, not '{window_label}'"
        ));
    }
    if method != "POST" {
        return Err(format!("llm_request sends only POST, not '{method}'"));
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| "llm_request needs an absolute http(s) URL".to_string())?;
    match parsed.scheme() {
        "https" | "http" => {}
        other => return Err(format!("llm_request refuses the '{other}' scheme")),
    }
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("llm_request needs a URL with a host".to_string());
    }
    Ok(())
}

/// PRD 011 Req 12: the client that talks to the provider — one per call, so no
/// key and no connection outlives the request that needed it.
///
/// The reqwest in the graph is the updater's: `rustls-no-provider`, which means
/// rustls' process-level `CryptoProvider` must already be installed or
/// `build()` *panics* rather than erroring. The updater installs ring the same
/// way, but only when the user checks for updates, so an LLM request in a
/// session that never checked would find none. Installing it here first is what
/// makes this path independent of that ordering.
///
/// PRD 011 Req 12: redirects are NOT followed. The API key travels in
/// `x-api-key` / `x-goog-api-key` as well as `Authorization`, and a followed
/// cross-host redirect would carry the non-`Authorization` ones to a host the
/// user never configured. A 3xx comes back as a status instead, which the seam
/// classifies as `unexpected`. The timeout is what turns a hung provider into
/// an unreachable host rather than a permanently pending IPC call.
fn llm_client() -> Result<reqwest::Client, String> {
    // Fails only if another thread won the race and installed one first, which
    // is exactly the outcome this wants either way.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(LLM_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// PRD 011 Req 12: the desktop LLM path in one place — webview → IPC → Rust →
/// provider, exactly as the updater plugin already reaches its endpoint from
/// the host side. This command is the only place any provider host is
/// contacted, so the webview never opens an outbound connection and the
/// webview CSP keeps allowing only `ipc: http://ipc.localhost`.
///
/// PRD 011 Req 7: nothing here logs, prints or panics with the request headers
/// or the request body, and the key is never written to disk or to any
/// Rust-side state — the client is built per call and dropped with it. The
/// error arm carries the transport error's own description, which names at
/// most the URL.
#[tauri::command]
async fn llm_request(
    webview_window: tauri::WebviewWindow,
    request: LlmHttpRequest,
) -> Result<LlmHttpResponse, String> {
    check_llm_request(webview_window.label(), &request.method, &request.url)?;

    let client = llm_client()?;

    let mut send = client.post(request.url).body(request.body);
    for (name, value) in request.headers {
        send = send.header(name, value);
    }

    // A failure here is one where no HTTP exchange happened (DNS, connection
    // refused, TLS, timeout); the TypeScript side turns it into
    // `{ kind: 'no-response' }` — Req 10's unreachable host.
    let response = send.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|v| (name.as_str().to_ascii_lowercase(), v.to_string()))
        })
        .collect();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(LlmHttpResponse {
        status,
        body,
        headers,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows/Linux file associations arrive as plain CLI arguments.
    let cli_files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // SPEC43 §4.6: clipboard read for the Smart Edit Paste item (local, no network).
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Mutex::new(OpenState {
            frontend_ready: false,
            pending: cli_files,
        }))
        .invoke_handler(tauri::generate_handler![
            take_pending_open_files,
            print_view,
            trash_entry,
            // PRD 011 Req 12: the desktop LLM transport.
            llm_request
        ])
        .build(tauri::generate_context!())
        .expect("error while building Marky Mark")
        .run(|app, event| {
            // macOS delivers file-association opens as RunEvent::Opened.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if paths.is_empty() {
                    return;
                }
                let state = app.state::<Mutex<OpenState>>();
                let mut s = state.lock().unwrap();
                if s.frontend_ready {
                    let _ = app.emit("mm://open-file", paths);
                } else {
                    s.pending.extend(paths);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

/// PRD 011 Req 12: the command is a provider transport, not a general web
/// proxy — the pure validation that says so, tested without a live server.
#[cfg(test)]
mod tests {
    use super::{check_llm_request, llm_client};

    /// The reqwest in this graph is `rustls-no-provider`: building a client
    /// with no crypto provider installed panics rather than erroring, and the
    /// updater only installs one when it checks for updates. Building one here
    /// — no network, no request — is what keeps that panic from coming back.
    #[test]
    fn builds_a_client_without_waiting_for_the_updater_to_install_a_provider() {
        assert!(llm_client().is_ok());
    }

    #[test]
    fn accepts_a_post_from_the_main_window_to_an_absolute_http_or_https_url() {
        assert!(check_llm_request("main", "POST", "https://api.openai.com/v1/responses").is_ok());
        // Req 5's custom endpoint may be a locally-run OpenAI-compatible server.
        assert!(check_llm_request("main", "POST", "http://127.0.0.1:11434/v1/chat").is_ok());
    }

    #[test]
    fn refuses_any_method_but_post() {
        for method in ["GET", "PUT", "DELETE", "post", ""] {
            assert!(check_llm_request("main", method, "https://api.openai.com/v1").is_err());
        }
    }

    #[test]
    fn refuses_schemes_that_are_not_http_or_https_and_urls_that_are_not_absolute() {
        for url in [
            "file:///etc/passwd",
            "data:text/plain,hi",
            "ws://example.com/socket",
            "/v1/responses",
            "api.openai.com/v1",
            "",
        ] {
            assert!(check_llm_request("main", "POST", url).is_err(), "{url}");
        }
    }

    #[test]
    fn answers_only_the_main_window() {
        for label in ["settings", "about", "printview", ""] {
            assert!(check_llm_request(label, "POST", "https://api.openai.com/v1").is_err());
        }
    }
}
