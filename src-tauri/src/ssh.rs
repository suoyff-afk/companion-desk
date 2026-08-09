use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, State};

const HOST_ALIAS_MAX_LENGTH: usize = 128;
const MIN_TERMINAL_SIZE: u32 = 2;
const MAX_TERMINAL_SIZE: u32 = 500;
const MAX_INPUT_CHUNK_BYTES: usize = 64 * 1024;
const SSH_START_ERROR_MESSAGE: &str = "Failed to start Windows OpenSSH.";
const READER_ERROR_MESSAGE: &str = "Failed while reading SSH terminal output.";
const WAIT_ERROR_MESSAGE: &str = "Failed while waiting for the SSH process.";

fn valid_host_alias(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.len() <= HOST_ALIAS_MAX_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[derive(Debug, PartialEq, Eq)]
enum ReaderErrorClass {
    NormalEof,
    Fatal,
}

fn classify_reader_error(kind: ErrorKind) -> ReaderErrorClass {
    match kind {
        ErrorKind::BrokenPipe | ErrorKind::UnexpectedEof => ReaderErrorClass::NormalEof,
        _ => ReaderErrorClass::Fatal,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum WaitOutcome {
    Exit(u32),
    Error,
}

fn terminal_event_for(wait: WaitOutcome, reader_failed: bool) -> TerminalEvent {
    match wait {
        WaitOutcome::Error => TerminalEvent::Error {
            message: WAIT_ERROR_MESSAGE.into(),
        },
        WaitOutcome::Exit(_) if reader_failed => TerminalEvent::Error {
            message: READER_ERROR_MESSAGE.into(),
        },
        WaitOutcome::Exit(code) => TerminalEvent::Exit { code },
    }
}

fn remove_session<T>(
    sessions: &Mutex<HashMap<String, T>>,
    session_id: &str,
) -> Result<Option<T>, String> {
    sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())
        .map(|mut sessions| sessions.remove(session_id))
}

fn clamp_terminal_size(cols: u32, rows: u32) -> (u16, u16) {
    (
        cols.clamp(MIN_TERMINAL_SIZE, MAX_TERMINAL_SIZE) as u16,
        rows.clamp(MIN_TERMINAL_SIZE, MAX_TERMINAL_SIZE) as u16,
    )
}

fn openssh_path(system_directory: &Path) -> PathBuf {
    system_directory.join("OpenSSH").join("ssh.exe")
}

#[cfg(target_os = "windows")]
fn system_directory() -> Result<PathBuf, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

    let mut buffer = vec![0_u16; 260];
    loop {
        let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if length == 0 {
            return Err("Windows system directory is unavailable.".into());
        }
        let length = length as usize;
        if length < buffer.len() {
            return Ok(PathBuf::from(OsString::from_wide(&buffer[..length])));
        }
        buffer.resize(length.saturating_add(1), 0);
    }
}

#[cfg(not(target_os = "windows"))]
fn system_directory() -> Result<PathBuf, String> {
    Err("Embedded SSH is available only in the Windows desktop build.".into())
}

fn ssh_program() -> Result<PathBuf, String> {
    system_directory().map(|directory| openssh_path(&directory))
}

fn validate_input_chunk(data: &[u8]) -> Result<(), String> {
    if data.len() > MAX_INPUT_CHUNK_BYTES {
        Err("Terminal input chunk exceeds the 64 KiB limit.".into())
    } else {
        Ok(())
    }
}

fn pty_size(cols: u32, rows: u32) -> PtySize {
    let (cols, rows) = clamp_terminal_size(cols, rows);
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { code: u32 },
    Error { message: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SshNativeStatus {
    Idle,
    Starting,
    ProcessRunning {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Exited { code: Option<i32> },
    Error { message: String },
}

struct SshProcessSlot {
    status: SshNativeStatus,
}

impl Default for SshProcessSlot {
    fn default() -> Self {
        Self {
            status: SshNativeStatus::Idle,
        }
    }
}

impl SshProcessSlot {
    fn reserve_start(&mut self) -> Result<(), String> {
        if matches!(self.status, SshNativeStatus::Starting | SshNativeStatus::ProcessRunning { .. }) {
            return Err("An SSH terminal process is already active.".into());
        }
        self.status = SshNativeStatus::Starting;
        Ok(())
    }

    fn rollback_failed_start(&mut self, message: &str) {
        self.status = SshNativeStatus::Error {
            message: message.into(),
        };
    }

    fn mark_running(&mut self, session_id: String) {
        self.status = SshNativeStatus::ProcessRunning { session_id };
    }

    fn finish(&mut self, session_id: &str, event: &TerminalEvent) {
        if !matches!(&self.status, SshNativeStatus::ProcessRunning { session_id: active } if active == session_id) {
            return;
        }
        self.status = match event {
            TerminalEvent::Exit { code } => SshNativeStatus::Exited {
                code: i32::try_from(*code).ok(),
            },
            TerminalEvent::Error { message } => SshNativeStatus::Error {
                message: message.clone(),
            },
            TerminalEvent::Output { .. } => return,
        };
    }

    fn close(&mut self, session_id: &str) {
        if matches!(&self.status, SshNativeStatus::ProcessRunning { session_id: active } if active == session_id) {
            self.status = SshNativeStatus::Idle;
        }
    }

    fn close_all(&mut self) -> Option<String> {
        let session_id = match &self.status {
            SshNativeStatus::ProcessRunning { session_id } => Some(session_id.clone()),
            _ => None,
        };
        self.status = SshNativeStatus::Idle;
        session_id
    }

    fn status(&self) -> SshNativeStatus {
        self.status.clone()
    }
}

struct StartReservation {
    slot: Arc<Mutex<SshProcessSlot>>,
    active: bool,
}

impl StartReservation {
    fn mark_running(&mut self, session_id: String) {
        let mut slot = self
            .slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.mark_running(session_id);
        self.active = false;
    }
}

impl Drop for StartReservation {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        let mut slot = self
            .slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.rollback_failed_start("Unable to start Windows OpenSSH.");
    }
}

struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl TerminalSession {
    fn close(&self) {
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if let Ok(killer) = self.killer.get_mut() {
            let _ = killer.kill();
        }
    }
}

pub struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    slot: Arc<Mutex<SshProcessSlot>>,
    next_id: AtomicU64,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            slot: Arc::new(Mutex::new(SshProcessSlot::default())),
            next_id: AtomicU64::new(1),
        }
    }
}

impl TerminalState {
    fn session_id(&self) -> String {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("ssh-{epoch}-{sequence}")
    }

    fn reserve_start(&self) -> Result<StartReservation, String> {
        let mut slot = self
            .slot
            .lock()
            .map_err(|_| "SSH process state is unavailable.".to_string())?;
        slot.reserve_start()?;
        Ok(StartReservation {
            slot: Arc::clone(&self.slot),
            active: true,
        })
    }

    fn status(&self) -> Result<SshNativeStatus, String> {
        self.slot
            .lock()
            .map_err(|_| "SSH process state is unavailable.".to_string())
            .map(|slot| slot.status())
    }

    fn close_all(&self) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable.".to_string())?
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>();
        for session in sessions {
            session.close();
        }
        let mut slot = self
            .slot
            .lock()
            .map_err(|_| "SSH process state is unavailable.".to_string())?;
        slot.close_all();
        Ok(())
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                session.close();
            }
        }
    }
}

#[tauri::command(async)]
pub fn start_ssh_terminal(
    host_alias: String,
    cols: u32,
    rows: u32,
    on_event: Channel<TerminalEvent>,
    state: State<'_, TerminalState>,
) -> Result<String, String> {
    if !valid_host_alias(&host_alias) {
        return Err("Invalid SSH host alias.".into());
    }
    if !cfg!(target_os = "windows") {
        return Err("Embedded SSH is available only in the Windows desktop build.".into());
    }
    let mut reservation = state.reserve_start()?;

    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|error| format!("Failed to create terminal: {error}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to open terminal output: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to open terminal input: {error}"))?;

    let mut command = CommandBuilder::new(ssh_program()?);
    command.arg(&host_alias);
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|_| SSH_START_ERROR_MESSAGE.to_string())?;
    drop(pair.slave);

    let session_id = state.session_id();
    let session = Arc::new(TerminalSession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
    });
    state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?
        .insert(session_id.clone(), session);
    reservation.mark_running(session_id.clone());

    let reader_failed = Arc::new(AtomicBool::new(false));
    let process_finished = Arc::new(AtomicBool::new(false));
    let output_channel = on_event.clone();
    let reader_sessions = Arc::clone(&state.sessions);
    let reader_session_id = session_id.clone();
    let reader_failed_flag = Arc::clone(&reader_failed);
    let reader_process_finished = Arc::clone(&process_finished);
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if output_channel
                        .send(TerminalEvent::Output {
                            data: BASE64.encode(&buffer[..count]),
                        })
                        .is_err()
                    {
                        let _ = remove_session(&reader_sessions, &reader_session_id);
                        break;
                    }
                }
                Err(error) => {
                    if classify_reader_error(error.kind()) == ReaderErrorClass::Fatal
                        && !reader_process_finished.load(Ordering::Acquire)
                    {
                        reader_failed_flag.store(true, Ordering::Release);
                        let _ = remove_session(&reader_sessions, &reader_session_id);
                    }
                    break;
                }
            }
        }
    });

    let wait_channel = on_event;
    let sessions = Arc::clone(&state.sessions);
    let wait_session_id = session_id.clone();
    let wait_reader_failed = reader_failed;
    let wait_process_finished = process_finished;
    let wait_slot = Arc::clone(&state.slot);
    thread::spawn(move || {
        let wait_outcome = match child.wait() {
            Ok(status) => WaitOutcome::Exit(status.exit_code()),
            Err(_) => WaitOutcome::Error,
        };
        wait_process_finished.store(true, Ordering::Release);
        let _ = remove_session(&sessions, &wait_session_id);
        // Dropping the PTY master closes ConPTY's output side so the reader can
        // finish; joining then guarantees all output events precede Exit/Error.
        let _ = reader_thread.join();
        let event = terminal_event_for(wait_outcome, wait_reader_failed.load(Ordering::Acquire));
        let mut slot = wait_slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.finish(&wait_session_id, &event);
        let _ = wait_channel.send(event);
    });

    Ok(session_id)
}

#[tauri::command(async)]
pub fn write_ssh_terminal(
    session_id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    validate_input_chunk(data.as_bytes())?;
    let session = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "SSH terminal session is not active.".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Terminal input is unavailable.".to_string())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Failed to write terminal input: {error}"))
}

#[tauri::command(async)]
pub fn resize_ssh_terminal(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "SSH terminal session is not active.".to_string())?;
    let master = session
        .master
        .lock()
        .map_err(|_| "Terminal resize is unavailable.".to_string())?;
    master
        .resize(pty_size(cols, rows))
        .map_err(|error| format!("Failed to resize terminal: {error}"))
}

#[tauri::command(async)]
pub fn close_ssh_terminal(
    session_id: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let session = remove_session(&state.sessions, &session_id)?;
    if let Some(session) = session {
        session.close();
    }
    let mut slot = state
        .slot
        .lock()
        .map_err(|_| "SSH process state is unavailable.".to_string())?;
    slot.close(&session_id);
    Ok(())
}

#[tauri::command(async)]
pub fn get_ssh_status(state: State<'_, TerminalState>) -> Result<SshNativeStatus, String> {
    state.status()
}

#[tauri::command(async)]
pub fn close_all_ssh(state: State<'_, TerminalState>) -> Result<(), String> {
    state.close_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn running_status_serializes_the_session_id_as_camel_case() {
        let value = serde_json::to_value(SshNativeStatus::ProcessRunning {
            session_id: "ssh-42".to_string(),
        })
        .unwrap();

        assert_eq!(value, serde_json::json!({
            "state": "processRunning",
            "sessionId": "ssh-42"
        }));
    }

    #[test]
    fn reserves_one_slot_and_releases_it_after_failed_start() {
        let mut slot = SshProcessSlot::default();

        assert!(slot.reserve_start().is_ok());
        assert!(slot.reserve_start().is_err());
        slot.rollback_failed_start("OpenSSH missing");
        assert!(slot.reserve_start().is_ok());
    }

    #[test]
    fn closes_the_single_slot_idempotently() {
        let mut slot = SshProcessSlot::default();
        slot.reserve_start().unwrap();
        slot.mark_running("ssh-42".into());

        assert_eq!(slot.close_all(), Some("ssh-42".into()));
        assert_eq!(slot.close_all(), None);
        assert_eq!(slot.status(), SshNativeStatus::Idle);
    }

    #[test]
    fn closing_the_active_session_releases_the_slot() {
        let mut slot = SshProcessSlot::default();
        slot.reserve_start().unwrap();
        slot.mark_running("ssh-42".into());

        slot.close("ssh-42");

        assert_eq!(slot.status(), SshNativeStatus::Idle);
    }

    #[test]
    fn validates_host_alias_without_shell_syntax() {
        assert!(valid_host_alias("tud-hpc"));
        assert!(valid_host_alias("cluster.login_1"));
        assert!(!valid_host_alias("host; whoami"));
        assert!(!valid_host_alias(""));
        assert!(!valid_host_alias("-oProxyCommand"));
        assert!(!valid_host_alias(&"a".repeat(HOST_ALIAS_MAX_LENGTH + 1)));
    }

    #[test]
    fn classifies_conpty_pipe_closure_as_normal_eof() {
        assert_eq!(
            classify_reader_error(std::io::ErrorKind::BrokenPipe),
            ReaderErrorClass::NormalEof
        );
        assert_eq!(
            classify_reader_error(std::io::ErrorKind::UnexpectedEof),
            ReaderErrorClass::NormalEof
        );
        assert_eq!(
            classify_reader_error(std::io::ErrorKind::Other),
            ReaderErrorClass::Fatal
        );
    }

    #[test]
    fn wait_error_and_reader_failure_have_deterministic_priority() {
        assert_eq!(
            terminal_event_for(WaitOutcome::Exit(0), false),
            TerminalEvent::Exit { code: 0 }
        );
        assert_eq!(
            terminal_event_for(WaitOutcome::Exit(0), true),
            TerminalEvent::Error {
                message: READER_ERROR_MESSAGE.into()
            }
        );
        assert_eq!(
            terminal_event_for(WaitOutcome::Error, true),
            TerminalEvent::Error {
                message: WAIT_ERROR_MESSAGE.into()
            }
        );
    }

    #[test]
    fn removing_a_session_is_idempotent() {
        let sessions = Mutex::new(HashMap::from([("session-1".to_string(), 7_u8)]));
        assert_eq!(remove_session(&sessions, "session-1").unwrap(), Some(7));
        assert_eq!(remove_session(&sessions, "session-1").unwrap(), None);
    }

    #[test]
    fn clamps_terminal_size_to_safe_pty_bounds() {
        assert_eq!(clamp_terminal_size(1, 0), (2, 2));
        assert_eq!(clamp_terminal_size(120, 40), (120, 40));
        assert_eq!(clamp_terminal_size(900, 501), (500, 500));
    }

    #[test]
    fn openssh_path_uses_the_provided_system_directory() {
        for system_directory in [Path::new(r"D:\Windows"), Path::new(r"E:\系统目录")] {
            assert_eq!(
                openssh_path(system_directory),
                system_directory.join("OpenSSH").join("ssh.exe")
            );
        }
    }

    #[test]
    fn openssh_start_failure_message_does_not_disclose_the_program_path() {
        assert_eq!(SSH_START_ERROR_MESSAGE, "Failed to start Windows OpenSSH.");
        assert!(!SSH_START_ERROR_MESSAGE.contains("OpenSSH\\ssh.exe"));
    }

    #[test]
    fn rejects_oversized_terminal_input_chunks() {
        assert!(validate_input_chunk(&vec![0; MAX_INPUT_CHUNK_BYTES]).is_ok());
        assert!(validate_input_chunk(&vec![0; MAX_INPUT_CHUNK_BYTES + 1]).is_err());
    }
}
