//! The native-messaging host Chrome spawns, and a pure byte pump.
//!
//! Native messaging inverts the lifecycle: the browser starts its host, but Vautix is
//! already running. So this relays between the browser's stdio and the app's local socket.
//! Both sides use the same framing (4-byte little-endian length, then JSON), so this never
//! parses a message, which is the point: it holds no key and cannot read or alter the Noise
//! session running through it. Replacing this binary gains an attacker nothing.
//!
//! Deliberately does not link the app library. The browser spawns this on every launch, so it
//! stays small and starts fast; pulling in Tauri to learn one path would be absurd.
//!
//! Chrome passes the calling extension's origin as argv[1]. It is not forwarded, because a
//! local process can run this binary directly with any argv it likes, so it would be no more
//! trustworthy than the label the extension already sends. It is left available for a future
//! parent-process check, which is the version of this that would carry weight. See
//! docs/desktop-port.md.
//!
//! Unix-only, because the app's end of the link is a unix domain socket. Where there is none this
//! binary still exists — it is a sidecar, so the build produces it either way — and says
//! `unavailable` through the one channel the extension understands, which is the same answer it
//! gets when the app is not running. See docs/desktop-port.md.

use std::{
    io::{self, Write},
    process::ExitCode,
};
#[cfg(unix)]
use std::{io::Read, os::unix::net::UnixStream, thread};

// The whole module is only reachable from the unix-only `pump` below, but the bin still has to
// compile (and be tested) on Windows, where `-D warnings` would turn every unused item into an
// error. One module-level allowance instead of sprinkling cfg_attrs on each item.
#[allow(dead_code)]
#[path = "../socket_addr.rs"]
mod socket_addr;

/// Matches the app's cap. A frame larger than this is a bug or an attempt to exhaust memory,
/// and refusing it here keeps it off the socket entirely.
// Read only by `pump`, which is unix-only; the bin still compiles (and is tested) on Windows.
#[cfg_attr(not(unix), allow(dead_code))]
const MAX_FRAME: u32 = 1024 * 1024;

/// Reported to the extension when there is no app to reach, so it can say "open Vautix"
/// rather than showing a connection that hangs. Native messaging gives the extension a
/// disconnect with no detail otherwise.
fn report_unavailable() {
    let body = br#"{"ok":false,"error":"unavailable"}"#;
    let mut out = io::stdout().lock();
    let _ = out.write_all(&(body.len() as u32).to_le_bytes());
    let _ = out.write_all(body);
    let _ = out.flush();
}

/// Copy framed messages from `src` to `dst` until either end closes.
///
/// Frame-aware rather than a raw byte copy purely to enforce the size cap; the body is passed
/// through untouched. Returns on EOF, which is the normal way both a closed browser and a
/// stopped app look.
#[cfg(unix)]
fn pump(mut src: impl Read, mut dst: impl Write) -> io::Result<()> {
    loop {
        let mut len = [0u8; 4];
        match src.read_exact(&mut len) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e),
        }
        let size = u32::from_le_bytes(len);
        if size > MAX_FRAME {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("frame of {size} bytes exceeds the cap"),
            ));
        }
        let mut body = vec![0u8; size as usize];
        src.read_exact(&mut body)?;
        dst.write_all(&len)?;
        dst.write_all(&body)?;
        dst.flush()?;
    }
}

fn main() -> ExitCode {
    // Nothing to relay to where there is no unix socket. Answering `unavailable` is what the
    // extension needs to say "open Vautix" rather than showing a connection that hangs, and it
    // is also the truth about a Windows build: the link has no transport there yet.
    #[cfg(not(unix))]
    {
        eprintln!("vautix-proxy: the browser link has no transport on this platform");
        report_unavailable();
        return ExitCode::FAILURE;
    }

    #[cfg(unix)]
    {
        let Some(path) = socket_addr::default_socket_path() else {
            eprintln!("vautix-proxy: unsupported platform");
            report_unavailable();
            return ExitCode::FAILURE;
        };

        let Ok(socket) = UnixStream::connect(&path) else {
            // The ordinary case when Vautix is not running, not an error worth shouting about.
            eprintln!("vautix-proxy: no app listening at {}", path.display());
            report_unavailable();
            return ExitCode::FAILURE;
        };
        let Ok(socket_out) = socket.try_clone() else {
            eprintln!("vautix-proxy: could not split the socket");
            return ExitCode::FAILURE;
        };

        // One direction per thread. Whichever ends first takes the process with it: a browser
        // that has gone away leaves nothing worth relaying, and neither does a stopped app.
        let up = thread::spawn(move || pump(io::stdin().lock(), socket_out));
        let down = pump(socket, io::stdout().lock());

        if let Err(e) = down {
            eprintln!("vautix-proxy: socket to browser: {e}");
            return ExitCode::FAILURE;
        }
        // The browser-to-socket side is not joined on purpose. It is blocked reading a stdin that
        // may never produce another byte, and the session is already over.
        drop(up);
        ExitCode::SUCCESS
    }
}
