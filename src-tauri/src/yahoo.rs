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
//! across calls. The crumb is cached for 24h in a `Mutex<CrumbState>` that's
//! `.manage()`d on the Tauri builder as a singleton.
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
//!
//! On a getcrumb failure (HTTP 429 in particular, but any non-success status
//! or network error), the state transitions to a `Cooldown` variant that
//! short-circuits subsequent `ensure_crumb` calls for `CRUMB_FAILURE_COOLDOWN`
//! (10 minutes). This stops the app from hammering Yahoo while we're already
//! rate-limited — e.g. a "Force refresh sectors" click over N funds previously
//! fired N separate getcrumb requests in parallel, each compounding the abuse.

use reqwest::Client;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const CRUMB_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long to back off from `getcrumb` after a failed fetch (HTTP 429,
/// other non-success status, or network error). During this window
/// `ensure_crumb` short-circuits and returns the cached error message
/// without touching the network, so a single rate-limit response doesn't
/// snowball into N parallel retries from N concurrent callers.
const CRUMB_FAILURE_COOLDOWN: Duration = Duration::from_secs(10 * 60);
const COOKIE_URL: &str = "https://fc.yahoo.com";
const CRUMB_URL: &str = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const QUOTE_SUMMARY_BASE: &str = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";

/// State of the cached crumb.
///
/// `Empty` is the cold-start variant: the next `ensure_crumb` call will
/// run the full cookie + getcrumb pre-flight.
///
/// `Cached` holds the crumb string and the `Instant` it was fetched at,
/// so we can age it out after `CRUMB_TTL`.
///
/// `Cooldown` is entered after a getcrumb failure (e.g. Yahoo returning
/// HTTP 429 at the user's IP). It carries the originating error message
/// for surfacing to callers, and the `Instant` at which the cooldown
/// expires. While `Instant::now() < until`, `ensure_crumb` returns the
/// cached error immediately without re-issuing the network requests.
/// Note that this is distinct from a 401/403 on `quoteSummary` — those
/// invalidate the crumb via `invalidate_crumb` but do NOT enter cooldown,
/// since the issue there is a stale session, not server-side rate limiting.
enum CrumbState {
    Empty,
    Cached { crumb: String, fetched_at: Instant },
    Cooldown { error: String, until: Instant },
}

/// Browser-style User-Agent. Yahoo's `getcrumb` endpoint gates on the UA:
/// requests from a non-browser UA are refused (HTTP 429 even when the IP is
/// not rate-limited), which silently breaks the `quoteSummary` path the fund
/// composition feature depends on (topHoldings + sectorWeightings — Yahoo's
/// Morningstar data). The chart endpoint (prices) is unauthenticated and does
/// NOT gate on UA, which is why prices kept working while composition didn't.
///
/// History: an "honest" `Cairn (...)` UA was tried (commit 65034b5, per Legal
/// review 2026-05-26 finding #1, which flagged a spoofed UA as the most
/// visible ToS-violation optic — Yahoo ToS § 2(d)(ix)). That honest UA made
/// getcrumb refuse the app entirely, so fund holdings/sectors never populated.
///
/// TRADEOFF (deliberate): this reverts to a browser UA to restore composition
/// data. That reintroduces the ToS optic the Legal review raised. For this
/// personal/friends-only build it's an accepted call — the same review rated
/// real-world exposure "very low" and listed "keep Yahoo" as an option. The
/// proper mitigation, when there's time, is the Settings → Advanced opt-in
/// toggle the review recommended (default off, with a one-time ToS modal), so
/// each user owns the choice to make these requests rather than the app
/// doing it unconditionally.
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/// Singleton state managed on the Tauri builder. Holds a `reqwest::Client`
/// with cookie jar enabled and the cached crumb. `.manage(YahooState::new())`
/// is called once in `lib.rs::run()`; commands receive it via
/// `tauri::State<'_, YahooState>`.
pub struct YahooState {
    client: Client,
    /// `Arc<Mutex<...>>` so the lock can be awaited across an `.await` point
    /// in `ensure_crumb` (where we re-issue the cookie + crumb requests while
    /// holding the guard, to prevent thundering-herd re-auth). The guard is
    /// also held across the cooldown check so concurrent callers all observe
    /// the same `Cooldown` state and short-circuit together, rather than
    /// each independently retrying getcrumb while Yahoo is rate-limiting us.
    crumb: Arc<Mutex<CrumbState>>,
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
            crumb: Arc::new(Mutex::new(CrumbState::Empty)),
        }
    }

    /// Returns a fresh crumb, fetching it (and seeding cookies) if the cache
    /// is empty or older than `CRUMB_TTL`. The guard is held across the
    /// network calls so concurrent callers wait for the in-flight re-auth
    /// instead of all racing to refetch.
    ///
    /// If the state is `Cooldown` and the cooldown hasn't yet elapsed, this
    /// returns the cached error message without touching the network. This
    /// keeps a Yahoo 429 from snowballing into a flood of retries — see
    /// `CRUMB_FAILURE_COOLDOWN`. On any non-success getcrumb response (or a
    /// network error reaching it), the state transitions into `Cooldown`
    /// before the error is returned. On a successful fetch, the state moves
    /// to `Cached`, clearing any prior cooldown.
    async fn ensure_crumb(&self) -> Result<String, String> {
        let mut guard = self.crumb.lock().await;
        match &*guard {
            CrumbState::Cached { crumb, fetched_at } if fetched_at.elapsed() < CRUMB_TTL => {
                return Ok(crumb.clone());
            }
            CrumbState::Cooldown { error, until } => {
                let now = Instant::now();
                if now < *until {
                    let remaining = *until - now;
                    return Err(format!(
                        "yahoo getcrumb rate-limited (last error: {}); retry available in {}s",
                        error,
                        remaining.as_secs()
                    ));
                }
                // Cooldown elapsed — fall through to retry below.
            }
            _ => {}
        }

        // Step 1: seed cookies. fc.yahoo.com returns 404 in body but the
        // response sets the session cookies in the jar. We deliberately
        // ignore the status and any network error here — if cookies didn't
        // make it through, getcrumb will fail in step 2 with a clearer
        // message.
        let _ = self.client.get(COOKIE_URL).send().await;

        // Step 2: fetch the crumb tied to those cookies. Any failure here
        // (network error, non-success status, empty body) trips the
        // cooldown via `enter_cooldown` so the next caller short-circuits
        // instead of dogpiling Yahoo while we're already being rate-limited.
        let res = match self.client.get(CRUMB_URL).send().await {
            Ok(res) => res,
            Err(e) => {
                let msg = format!("yahoo getcrumb network error: {}", e);
                Self::enter_cooldown(&mut guard, msg.clone());
                return Err(msg);
            }
        };
        let status = res.status();
        if !status.is_success() {
            let msg = format!("yahoo getcrumb failed: {}", status);
            Self::enter_cooldown(&mut guard, msg.clone());
            return Err(msg);
        }
        let crumb = match res.text().await {
            Ok(body) => body.trim().to_string(),
            Err(e) => {
                let msg = format!("yahoo getcrumb body error: {}", e);
                Self::enter_cooldown(&mut guard, msg.clone());
                return Err(msg);
            }
        };
        if crumb.is_empty() {
            let msg = "yahoo getcrumb returned empty body".to_string();
            Self::enter_cooldown(&mut guard, msg.clone());
            return Err(msg);
        }
        *guard = CrumbState::Cached {
            crumb: crumb.clone(),
            fetched_at: Instant::now(),
        };
        Ok(crumb)
    }

    /// Transition the locked state into `Cooldown` with the given error
    /// message. Factored out so every getcrumb failure path stays in sync
    /// on cooldown duration and structure. Callers must already hold the
    /// `crumb` mutex guard.
    fn enter_cooldown(guard: &mut CrumbState, error: String) {
        *guard = CrumbState::Cooldown {
            error,
            until: Instant::now() + CRUMB_FAILURE_COOLDOWN,
        };
    }

    /// Invalidates the cached crumb so the next `ensure_crumb` re-runs the
    /// full pre-flight. Used on 401/403 responses where the session has
    /// gone stale mid-life.
    ///
    /// Deliberately a no-op when the state is `Cooldown`: a quoteSummary
    /// 401/403 means our crumb is stale, but it tells us nothing about
    /// whether Yahoo is willing to issue a new one. Clearing the cooldown
    /// here would let the very next call dogpile getcrumb again, which is
    /// exactly the scenario the cooldown was added to prevent.
    async fn invalidate_crumb(&self) {
        let mut guard = self.crumb.lock().await;
        if let CrumbState::Cached { .. } = *guard {
            *guard = CrumbState::Empty;
        }
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
