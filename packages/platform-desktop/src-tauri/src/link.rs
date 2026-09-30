//! The browser link: what the webview asks for, and the state that answers it.
//!
//! Split from `socket` because the two have different portability and different lifetimes.
//! Everything here is the surface `@vault/core` calls — a handful of `#[tauri::command]`s and the
//! state they read — and the webview talks to it on every platform. The transport those commands
//! ultimately feed lives in `socket`, which is `#[cfg(unix)]`: a unix domain socket has no Windows
//! equivalent, and adding one is a port, not a build flag.
//!
//! So on Windows this module still compiles and still answers, and it answers as though no browser
//! were ever connected — which is not a stub pretending to work but the truth: nothing can connect.
//! No `if cfg!` appears in any command body below, because none of them need one. `outboxes()`
//! starts empty, so `link_sync_peers` is `[]`, `link_sync_send` is "no such peer", and a panel fill
//! is "no browser connected", which is what every one of them already said when the browser was
//! merely closed. The absence of a transport and the absence of a browser are the same answer, so
//! the code does not have to tell them apart.
//!
//! What does NOT survive is `claim_invite`, `emit` and `attach`: those exist only for the
//! transport to call, so they are gated rather than left as unreachable code.

use std::{
    collections::HashMap,
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, Instant},
};
// Split rather than merged because these four are read only by the transport, and CI builds with
// `-D warnings`: a merged import would be an unused-import error on every platform but unix.
#[cfg(unix)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(unix)]
use tauri::{AppHandle, Emitter};

use serde::Serialize;

use crate::index_store;

/// The page the browser last reported, for the panel to show as a fill target.
static ACTIVE_TAB: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub(crate) fn active_tab() -> &'static Mutex<Option<String>> {
    ACTIVE_TAB.get_or_init(|| Mutex::new(None))
}

/// Where a fill from the panel would land, as the browser last reported it. Empty when no
/// browser is connected or it is not on a page worth naming.
#[tauri::command]
pub fn spotlight_active_tab() -> Option<String> {
    active_tab().lock().ok().and_then(|t| t.clone())
}

/// Fill an entry on the page in front of the user, through a browser that need not be unlocked.
///
/// This hands over ONE credential, which is the whole point of the link: the user should not have
/// to unlock twice, so a locked browser cannot fill from a vault it cannot read and the app has
/// to do it for them. The VEK never crosses, only the entry they just chose.
///
/// The user's selection in the panel IS the authorization, made while this app was unlocked. On
/// top of that the entry is checked against the page the browser last reported, so a wrong tab in
/// front of the user is caught rather than filled. That report comes from the browser and a
/// compromised one could lie about it, which is why it is a second line and not the only one: the
/// panel names the page before the user commits.
#[tauri::command]
pub fn spotlight_request_fill(id: String) -> Result<(), String> {
    if vault_crypto::is_locked() {
        return Err("locked".into());
    }
    let entry = index_store::secret_for(&id).ok_or("unknown entry")?;
    // Only where the entry belongs. A login with no hostnames at all is not pinned to anywhere,
    // so it is left to the user's choice rather than refused.
    if let Some(page) = active_tab().lock().ok().and_then(|t| t.clone()) {
        if !entry.hostnames.is_empty()
            && !entry
                .hostnames
                .iter()
                .any(|h| h.eq_ignore_ascii_case(&page) || page.ends_with(&format!(".{h}")))
        {
            return Err(format!("that entry is not for {page}"));
        }
    }
    let frame = serde_json::json!({
        "fill": {
            "username": entry.username,
            "password": entry.password,
            "totp": entry.totp,
        }
    })
    .to_string();
    let sent = {
        let boxes = outboxes().lock().map_err(|_| "outbox lock poisoned")?;
        // Every connected browser is asked. Only the one whose page has a matching field and
        // hostname will act, and that decision is deliberately not made here.
        boxes
            .values()
            .filter(|(_, tx)| tx.send(frame.clone()).is_ok())
            .count()
    };
    log::info!("panel fill: asked {sent} browser(s)");
    if sent > 0 {
        Ok(())
    } else {
        Err("no browser connected".into())
    }
}

/// This device's sync public key, published by the webview at startup.
///
/// Held here rather than read on demand because the private half lives in the OS credential
/// store, and touching that from a socket thread would put a Keychain prompt in front of the
/// user at a moment they did not ask for anything.
///
/// Written on every platform, read only by the transport: on Windows the slot fills and is never
/// consulted, which is the same as there being no browser to ask.
static SYNC_IDENTITY: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub(crate) fn sync_identity() -> &'static Mutex<Option<String>> {
    SYNC_IDENTITY.get_or_init(|| Mutex::new(None))
}

/// Publish this device's sync public key for browsers to ask about.
#[tauri::command]
pub fn link_set_sync_identity(public_key: String) {
    if let Ok(mut slot) = sync_identity().lock() {
        *slot = Some(public_key);
    }
}

/// The sync invite a browser may claim, and when it stops being claimable.
///
/// Deliberately narrow: one invite, single-use, and short-lived. It carries the enrollment PSK,
/// which is a bearer secret worth the vault, so the window it exists in is the window the user is
/// looking at a code on screen.
static ARMED_INVITE: OnceLock<Mutex<Option<ArmedInvite>>> = OnceLock::new();

struct ArmedInvite {
    // Written on every platform (the webview arms an invite without asking what it can claim),
    // read only by `claim_invite`, which is the transport's. So on Windows this is a value that
    // is armed and never claimed, and CI's `-D warnings` reads that as two dead fields.
    #[cfg_attr(not(unix), allow(dead_code))]
    payload: String,
    #[cfg_attr(not(unix), allow(dead_code))]
    expires_at: Instant,
}

fn armed() -> &'static Mutex<Option<ArmedInvite>> {
    ARMED_INVITE.get_or_init(|| Mutex::new(None))
}

/// Arm the invite a browser can claim, for `ttl_ms`. Replaces any previous one: a new invite
/// supersedes, so an abandoned one cannot be claimed later.
#[tauri::command]
pub fn link_arm_sync_invite(payload: String, ttl_ms: u64) -> Result<(), String> {
    let mut slot = armed().lock().map_err(|_| "invite lock poisoned")?;
    *slot = Some(ArmedInvite {
        payload,
        expires_at: Instant::now() + Duration::from_millis(ttl_ms),
    });
    Ok(())
}

/// Disarm, for a dialog the user closed. Dismissing is a refusal.
#[tauri::command]
pub fn link_clear_sync_invite() {
    if let Ok(mut slot) = armed().lock() {
        *slot = None;
    }
}

/// Take the armed invite, if there is a live one. Single-use: claiming it disarms it, so a second
/// browser racing for the same code gets nothing.
///
/// Unix-only because claiming is something a browser does over the link, and there is no link
/// without a transport. On other platforms an armed invite simply expires unclaimed.
#[cfg(unix)]
pub(crate) fn claim_invite() -> Option<String> {
    let mut slot = armed().lock().ok()?;
    let invite = slot.take()?;
    if Instant::now() > invite.expires_at {
        return None; // expired: dropped by the take above
    }
    Some(invite.payload)
}

/// The webview, once the app has one. Absent under `cargo test`, where emitting is a no-op:
/// the socket is exercised directly there, with no window to deliver an event to.
#[cfg(unix)]
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Outbound queues, one per live link, keyed by the browser's static public key.
///
/// A single queue per link is what keeps the Noise nonce sequence honest. Answers and pushed
/// sync frames come from different threads, and Noise numbers its transport frames in order, so
/// two threads encrypting concurrently would produce frames the far side cannot decrypt in the
/// order they arrive. Everything outbound goes through here as plaintext and is sealed by the
/// one writer thread that drains it.
/// The generation distinguishes one link to a browser from its replacement: a reconnect
/// registers a new one, and the connection it displaced must not remove it on the way out.
static OUTBOXES: OnceLock<Mutex<HashMap<String, (u64, mpsc::Sender<String>)>>> = OnceLock::new();
#[cfg(unix)]
static NEXT_LINK: AtomicU64 = AtomicU64::new(1);

pub(crate) fn outboxes() -> &'static Mutex<HashMap<String, (u64, mpsc::Sender<String>)>> {
    OUTBOXES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The next link generation. Lives beside the registry it numbers rather than in the transport
/// that asks for it, so the counter and the map cannot disagree about where it starts.
#[cfg(unix)]
pub(crate) fn next_link() -> u64 {
    NEXT_LINK.fetch_add(1, Ordering::Relaxed)
}

/// Give the socket a window to notify. Separate from `listen` because the link works without
/// one: a browser can be connected and answering fills while no window is open, and the tests
/// exercise the socket with no app at all.
#[cfg(unix)]
pub fn attach(app: AppHandle) {
    let _ = APP.set(app);
}

#[cfg(unix)]
pub(crate) fn emit(event: &str, payload: serde_json::Value) {
    if let Some(app) = APP.get() {
        let _ = app.emit(event, payload);
    }
}

/// Hand a frame from the webview's sync host to one browser. Errors when that browser is not
/// connected, which is ordinary: a peer that went away is not a failure of the caller.
#[tauri::command]
pub fn link_sync_send(peer_id: String, frame: String) -> Result<(), String> {
    let queued = {
        let boxes = outboxes().lock().map_err(|_| "outbox lock poisoned")?;
        match boxes.get(&peer_id) {
            Some((_, tx)) => tx
                .send(serde_json::json!({ "sync": frame }).to_string())
                .is_ok(),
            None => false,
        }
    };
    if queued {
        Ok(())
    } else {
        Err("no such peer".into())
    }
}

/// One connected browser, as reported to a webview catching up.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedPeer {
    pub peer_id: String,
    /// The same generation the events carry, so a catch-up entry and an event about the same
    /// connection are recognisably the same connection rather than two.
    pub link: u64,
}

/// The browsers connected right now, so a webview that opened after they did can pick them up
/// rather than waiting for a reconnect that may not come until the browser restarts.
#[tauri::command]
pub fn link_sync_peers() -> Vec<ConnectedPeer> {
    outboxes()
        .lock()
        .map(|b| {
            b.iter()
                .map(|(peer_id, (link, _))| ConnectedPeer {
                    peer_id: peer_id.clone(),
                    link: *link,
                })
                .collect()
        })
        .unwrap_or_default()
}
