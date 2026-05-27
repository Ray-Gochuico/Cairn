//! Yahoo Finance `quoteSummary` auth + fetch, owned by the Rust shell.
//!
//! Why this lives here instead of JS: Yahoo's `quoteSummary` endpoint requires
//! a CSRF "crumb" tied to session cookies set by `fc.yahoo.com`. The JS-side
//! `@tauri-apps/plugin-http` `fetch` doesn't reliably surface `Set-Cookie`
//! headers in the Tauri WebView, so the JS implementation either failed to
//! pick up the cookies or re-authenticated per ticker and tripped Yahoo's
//! rate limiter (HTTP 429).
//!
//! `reqwest` with `cookie_store(true)` keeps a single persistent session
//! across calls. The crumb is cached for 24h in a `Mutex<Option<(String, Instant)>>`
//! that's `.manage()`d on the Tauri builder as a singleton.
//!
//! Auth flow on a cold cache:
//!   1. `GET https://fc.yahoo.com` (404 body, cookies set in jar — ignore status).
//!   2. `GET https://query1.finance.yahoo.com/v1/test/getcrumb` (cookies auto-
//!      attached; body is the raw crumb string).
//!   3. `GET https://query2.finance.yahoo.com/v10/finance/quoteSummary/<ticker>`
//!      with `?modules=<csv>&crumb=<crumb>` (cookies auto-attached).
//!
//! On 401/403 mid-session, the crumb cache is invalidated and the whole flow
//! retried once before surfacing an error to JS.

use reqwest::Client;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const CRUMB_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const COOKIE_URL: &str = "https://fc.yahoo.com";
const CRUMB_URL: &str = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const QUOTE_SUMMARY_BASE: &str = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";

/// Honest identifier carrying the cargo package name + version.
///
/// History: previously this masqueraded as `Mozilla/5.0 ... Chrome/120.0.0.0
/// ... Safari/537.36` because Yahoo's getcrumb endpoint was observed gating
/// on a non-default UA. Per Legal review (docs/reviews/2026-05-26-legal-review.md
/// finding #1), the spoofed UA was the single most visible ToS-violation
/// surface in the codebase — it reads as documented intent to bypass Yahoo's
/// automated-access restriction (Yahoo ToS § 2(d)(ix)).
///
/// The new UA identifies the app honestly. Yahoo may rate-limit non-browser
/// UAs more aggressively or refuse service entirely; the existing market-
/// refresh code (`src/market/run-market-data-refresh.ts`) swallows errors in
/// every IIFE and falls back to whatever is already in `price_cache`, so the
/// worst case is "no fresh prices today," not "the app crashes." Monitor
/// refresh success after rollout and consider staging this behind a
/// Settings → Advanced opt-in toggle (off by default) if Yahoo starts
/// refusing requests.
const USER_AGENT: &str = concat!(
    "Cairn (https://github.com/raymondgochuico/cairn; finance-app/",
    env!("CARGO_PKG_VERSION"),
    ")"
);

/// Singleton state managed on the Tauri builder. Holds a `reqwest::Client`
/// with cookie jar enabled and the cached crumb. `.manage(YahooState::new())`
/// is called once in `lib.rs::run()`; commands receive it via
/// `tauri::State<'_, YahooState>`.
pub struct YahooState {
    client: Client,
    /// `Arc<Mutex<...>>` so the lock can be awaited across an `.await` point
    /// in `ensure_crumb` (where we re-issue the cookie + crumb requests while
    /// holding the guard, to prevent thundering-herd re-auth).
    crumb: Arc<Mutex<Option<(String, Instant)>>>,
}

impl YahooState {
    pub fn new() -> Self {
        let client = Client::builder()
            .cookie_store(true)
            .user_agent(USER_AGENT)
            .build()
            .expect("reqwest client should build");
        Self {
            client,
            crumb: Arc::new(Mutex::new(None)),
        }
    }

    /// Returns a fresh crumb, fetching it (and seeding cookies) if the cache
    /// is empty or older than `CRUMB_TTL`. The guard is held across the
    /// network calls so concurrent callers wait for the in-flight re-auth
    /// instead of all racing to refetch.
    async fn ensure_crumb(&self) -> Result<String, String> {
        let mut guard = self.crumb.lock().await;
        if let Some((crumb, fetched_at)) = guard.as_ref() {
            if fetched_at.elapsed() < CRUMB_TTL {
                return Ok(crumb.clone());
            }
        }

        // Step 1: seed cookies. fc.yahoo.com returns 404 in body but the
        // response sets the session cookies in the jar. We deliberately
        // ignore the status and any network error here — if cookies didn't
        // make it through, getcrumb will fail in step 2 with a clearer
        // message.
        let _ = self.client.get(COOKIE_URL).send().await;

        // Step 2: fetch the crumb tied to those cookies.
        let res = self
            .client
            .get(CRUMB_URL)
            .send()
            .await
            .map_err(|e| format!("yahoo getcrumb network error: {}", e))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("yahoo getcrumb failed: {}", status));
        }
        let crumb = res
            .text()
            .await
            .map_err(|e| format!("yahoo getcrumb body error: {}", e))?
            .trim()
            .to_string();
        if crumb.is_empty() {
            return Err("yahoo getcrumb returned empty body".into());
        }
        *guard = Some((crumb.clone(), Instant::now()));
        Ok(crumb)
    }

    /// Invalidates the cached crumb so the next `ensure_crumb` re-runs the
    /// full pre-flight. Used on 401/403 responses where the session has
    /// gone stale mid-life.
    async fn invalidate_crumb(&self) {
        let mut guard = self.crumb.lock().await;
        *guard = None;
    }

    /// Builds and sends the quoteSummary GET. Returns the raw response body
    /// text — parsing is the caller's job (JS does `JSON.parse`).
    async fn send_quote_summary(&self, ticker: &str, modules_csv: &str, crumb: &str) -> Result<reqwest::Response, String> {
        let url = format!(
            "{}/{}?modules={}&crumb={}",
            QUOTE_SUMMARY_BASE,
            urlencoding::encode(ticker),
            urlencoding::encode(modules_csv),
            urlencoding::encode(crumb)
        );
        self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("yahoo quoteSummary network error: {}", e))
    }

    /// Public entry point. Fetches `quoteSummary` for `ticker` with the
    /// requested `modules` (a slice of module names like `["topHoldings"]`
    /// or `["fundProfile", "price"]`). Returns the raw JSON body text.
    ///
    /// Retry policy: on a single 401/403 the crumb is invalidated and the
    /// whole flow runs again once. A second auth failure surfaces as an
    /// error.
    async fn fetch_quote_summary(
        &self,
        ticker: &str,
        modules: &[String],
    ) -> Result<String, String> {
        let modules_csv = modules.join(",");
        let crumb = self.ensure_crumb().await?;
        let res = self.send_quote_summary(ticker, &modules_csv, &crumb).await?;
        let status = res.status();

        if status.as_u16() == 401 || status.as_u16() == 403 {
            self.invalidate_crumb().await;
            let new_crumb = self.ensure_crumb().await?;
            let retry = self
                .send_quote_summary(ticker, &modules_csv, &new_crumb)
                .await?;
            if !retry.status().is_success() {
                return Err(format!(
                    "yahoo quoteSummary {} failed after retry: {}",
                    ticker,
                    retry.status()
                ));
            }
            return retry
                .text()
                .await
                .map_err(|e| format!("yahoo quoteSummary retry body error: {}", e));
        }

        if !status.is_success() {
            return Err(format!("yahoo quoteSummary {} failed: {}", ticker, status));
        }
        res.text()
            .await
            .map_err(|e| format!("yahoo quoteSummary body error: {}", e))
    }
}

impl Default for YahooState {
    fn default() -> Self {
        Self::new()
    }
}

/// Tauri command exposed to JS as `invoke('yahoo_quote_summary', { ticker, modules })`.
/// Returns the raw quoteSummary JSON body as a string; JS does `JSON.parse`
/// on its side rather than us paying for serde round-trips through Tauri's
/// command ABI.
#[tauri::command]
pub async fn yahoo_quote_summary(
    state: tauri::State<'_, YahooState>,
    ticker: String,
    modules: Vec<String>,
) -> Result<String, String> {
    state.fetch_quote_summary(&ticker, &modules).await
}
