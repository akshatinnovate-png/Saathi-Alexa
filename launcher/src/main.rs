#![cfg_attr(windows, windows_subsystem = "windows")]

use std::env;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

const LOG_LIMIT: u64 = 5 * 1024 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(90);

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Layout {
    node: PathBuf,
    app: PathBuf,
    broker: PathBuf,
    home: PathBuf,
}

impl Layout {
    fn find() -> Result<Self, String> {
        let exe = env::current_exe().map_err(|e| format!("cannot find where Saathi is installed: {e}"))?;
        let root = exe.parent().ok_or("cannot find where Saathi is installed")?.to_path_buf();
        let node = env::var_os("SAATHI_NODE").map(PathBuf::from).unwrap_or_else(|| root.join("runtime").join(format!("node{}", env::consts::EXE_SUFFIX)));
        let app = env::var_os("SAATHI_APP").map(PathBuf::from).unwrap_or_else(|| root.join("app"));
        let broker = app.join("bin").join(format!("saathi-broker{}", env::consts::EXE_SUFFIX));
        let home = env::var_os("SAATHI_HOME").map(PathBuf::from).or_else(default_home).ok_or("cannot find a folder for Saathi's data")?;
        Ok(Self { node, app, broker, home })
    }

    fn data_dir(&self) -> PathBuf {
        self.home.join("data")
    }

    fn env_file(&self) -> PathBuf {
        self.home.join("saathi.env")
    }

    fn log_file(&self) -> PathBuf {
        self.home.join("logs").join("saathi.log")
    }

    fn pid_file(&self) -> PathBuf {
        self.home.join("saathi.pid")
    }

    fn offered_file(&self) -> PathBuf {
        self.home.join("key-protection-offered")
    }

    fn settings(&self) -> Vec<(String, String)> {
        fs::read_to_string(self.env_file()).map(|t| parse_env(&t)).unwrap_or_default()
    }

    fn setting(&self, key: &str) -> Option<String> {
        self.settings().into_iter().rev().find(|(k, _)| k == key).map(|(_, v)| v).or_else(|| env::var(key).ok()).filter(|v| !v.is_empty())
    }

    fn port(&self) -> u16 {
        self.setting("PORT").and_then(|p| p.parse().ok()).unwrap_or(8787)
    }

    fn address(&self) -> String {
        self.setting("SAATHI_PUBLIC_URL").map(|u| u.trim_end_matches('/').to_string()).unwrap_or_else(|| format!("http://localhost:{}", self.port()))
    }

    fn node(&self, script: &str) -> Command {
        let mut cmd = Command::new(&self.node);
        cmd.arg(self.app.join(script))
            .current_dir(&self.app)
            .env("SAATHI_DATA_FILE", self.data_dir().join("saathi.json"))
            .env("SAATHI_ENV_FILE", self.env_file())
            .env("NODE_ENV", "production")
            .env_remove("SAATHI_OPEN_BROWSER");
        if self.broker.exists() {
            cmd.env("SAATHI_BROKER", &self.broker);
        }
        cmd
    }
}

fn default_home() -> Option<PathBuf> {
    if cfg!(windows) {
        env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("Saathi"))
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
            .map(|d| d.join("saathi"))
    }
}

fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| {
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')).or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\''))).unwrap_or(v);
            (k.trim().to_string(), v.to_string())
        })
        .collect()
}

fn healthy(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(b"GET /healthz HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut head = [0u8; 16];
    let mut got = 0;
    while got < head.len() {
        match stream.read(&mut head[got..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => got += n,
        }
    }
    let line = String::from_utf8_lossy(&head[..got]);
    line.starts_with("HTTP/1.") && line.get(9..12) == Some("200")
}

fn open_browser(url: &str) {
    let opened = if cfg!(windows) {
        Command::new("explorer.exe").arg(url).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    if opened.is_err() {
        eprintln!("Open {url} in your browser.");
    }
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn own_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd
}

fn rotate(log: &Path) {
    if fs::metadata(log).map(|m| m.len() > LOG_LIMIT).unwrap_or(false) {
        let mut old = OsString::from(log.as_os_str());
        old.push(".1");
        let _ = fs::rename(log, PathBuf::from(old));
    }
}

fn tell(layout: &Layout, message: &str) {
    let log = layout.log_file();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log) {
        let _ = writeln!(f, "\n{message}\n");
    }
    eprintln!("{message}");
    if cfg!(windows) {
        let _ = Command::new("notepad.exe").arg(&log).spawn();
    }
}

fn key_protection(layout: &Layout) -> Option<(String, bool)> {
    let out = hidden(Command::new(&layout.broker).args(["status", "--dir"]).arg(layout.data_dir())).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let at = text.find("\"protection\":\"")? + 14;
    Some((text[at..].split('"').next()?.to_string(), text.contains("\"tpmAvailable\":true")))
}

fn key_tool(layout: &Layout, action: &str) -> ExitCode {
    console_tool(layout, "scripts/key.js", action)
}

fn console_tool(layout: &Layout, script: &str, action: &str) -> ExitCode {
    let mut cmd = layout.node(script);
    if !action.is_empty() {
        cmd.arg(action);
    }
    cmd.env("SAATHI_PAUSE", "1");
    match own_window(&mut cmd).status() {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(e) => {
            tell(layout, &format!("Saathi could not open {script}: {e}"));
            ExitCode::FAILURE
        }
    }
}

fn offer_key_protection(layout: &Layout) {
    if layout.offered_file().exists() || !layout.broker.exists() {
        return;
    }
    if let Some((protection, tpm)) = key_protection(layout) {
        if protection == "file" && (tpm || cfg!(windows)) {
            key_tool(layout, "protect");
        }
    }
    let _ = fs::write(layout.offered_file(), b"1\n");
}

fn stop(layout: &Layout) -> ExitCode {
    let Ok(pid) = fs::read_to_string(layout.pid_file()) else { return ExitCode::SUCCESS };
    let pid = pid.trim();
    if pid.is_empty() || !pid.bytes().all(|b| b.is_ascii_digit()) {
        let _ = fs::remove_file(layout.pid_file());
        return ExitCode::SUCCESS;
    }
    let result = if cfg!(windows) {
        hidden(Command::new("taskkill").args(["/PID", pid, "/T", "/F"])).status()
    } else {
        Command::new("kill").arg(pid).status()
    };
    let _ = fs::remove_file(layout.pid_file());
    if result.map(|s| s.success()).unwrap_or(false) { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

fn run(layout: &Layout, show: bool) -> ExitCode {
    let port = layout.port();
    if healthy(port) {
        if show {
            open_browser(&format!("{}/", layout.address()));
        }
        return ExitCode::SUCCESS;
    }
    if !layout.node.exists() {
        tell(layout, &format!("Saathi is not installed correctly: {} is missing. Please run the Saathi installer again.", layout.node.display()));
        return ExitCode::FAILURE;
    }
    for dir in [layout.data_dir(), layout.home.join("logs")] {
        if let Err(e) = fs::create_dir_all(&dir) {
            eprintln!("Saathi could not create {}: {e}", dir.display());
            return ExitCode::FAILURE;
        }
    }
    let log_path = layout.log_file();
    rotate(&log_path);
    let log = match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Saathi could not open its log {}: {e}", log_path.display());
            return ExitCode::FAILURE;
        }
    };
    let Ok(err_log) = log.try_clone() else { return ExitCode::FAILURE };
    let mut cmd = layout.node("src/index.js");
    cmd.stdin(Stdio::null()).stdout(log).stderr(err_log);
    let mut child = match hidden(&mut cmd).spawn() {
        Ok(c) => c,
        Err(e) => {
            tell(layout, &format!("Saathi could not start: {e}"));
            return ExitCode::FAILURE;
        }
    };
    let _ = fs::write(layout.pid_file(), format!("{}\n", child.id()));
    let started = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let _ = fs::remove_file(layout.pid_file());
            tell(layout, &format!("Saathi stopped while starting ({status}). The reason is just above, in this log."));
            return ExitCode::FAILURE;
        }
        if healthy(port) {
            break;
        }
        if started.elapsed() > START_TIMEOUT {
            let _ = child.kill();
            let _ = fs::remove_file(layout.pid_file());
            tell(layout, "Saathi took too long to start. The log above may say why.");
            return ExitCode::FAILURE;
        }
        sleep(Duration::from_millis(400));
    }
    if show {
        offer_key_protection(layout);
        open_browser(&format!("{}/", layout.address()));
    }
    let status = child.wait();
    let _ = fs::remove_file(layout.pid_file());
    match status {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        _ => ExitCode::FAILURE,
    }
}

fn main() -> ExitCode {
    let layout = match Layout::find() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    match env::args().nth(1).as_deref() {
        None | Some("open") => run(&layout, true),
        Some("--background") => run(&layout, false),
        Some("--stop") => stop(&layout),
        Some("--protect-key") => key_tool(&layout, "protect"),
        Some("--restore-key") => key_tool(&layout, "restore"),
        Some("--key-status") => key_tool(&layout, "status"),
        Some("--reach") => console_tool(&layout, "scripts/reach.js", ""),
        Some("--version") => {
            println!("saathi {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("unknown option {other}; use --background, --stop, --protect-key, --restore-key, --key-status, --reach or --version");
            ExitCode::from(64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_env_files_like_node_does() {
        let parsed = parse_env("# note\nPORT=9000\n\nSAATHI_PUBLIC_URL=\"https://aaji.example.ts.net\"\nNAME='Riya'\nBROKEN\n");
        assert_eq!(parsed, vec![
            ("PORT".into(), "9000".into()),
            ("SAATHI_PUBLIC_URL".into(), "https://aaji.example.ts.net".into()),
            ("NAME".into(), "Riya".into()),
        ]);
    }

    #[test]
    fn nothing_listening_is_not_healthy() {
        let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(!healthy(free));
    }

    #[test]
    fn a_200_from_healthz_is_healthy_and_a_404_is_not() {
        for (reply, expected) in [("HTTP/1.1 200 OK\r\n\r\nok", true), ("HTTP/1.1 404 Not Found\r\n\r\n", false)] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = std::thread::spawn(move || {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = [0u8; 256];
                let _ = s.read(&mut buf);
                s.write_all(reply.as_bytes()).unwrap();
            });
            assert_eq!(healthy(port), expected);
            server.join().unwrap();
        }
    }
}
