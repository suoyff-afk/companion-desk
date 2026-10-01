use serde::Serialize;
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, mpsc, Arc, Weak},
    thread,
    time::{Duration, Instant},
};

const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const PIPE_CLEANUP_TIMEOUT: Duration = Duration::from_millis(50);
static QUERY_ACTIVE: AtomicBool = AtomicBool::new(false);
const FRAMING_ERROR: &str = "Invalid HPC query response framing.";

// Fixed commands only; validated numeric IDs are positional Bash arguments.
// Stderr has separate source framing and never becomes job data.
const QUERY_SCRIPT: &str = r#"export LC_ALL=C
queue_args=(--array --noheader --user="$(id -un)" --format='%i|%j|%T|%M|%R|%Z')
history_args=(--allocations --array --noheader --parsable2 --user="$(id -un)" --format='JobID%64,JobName%256,State%128,Elapsed,ExitCode,WorkDir%4096')
if [ "$#" -gt 0 ]; then
  ids=$(IFS=,; printf '%s' "$*")
  queue_args+=(--jobs="$ids")
  history_args+=(--jobs="$ids" --starttime=1970-01-01)
else
  history_args+=(--starttime=now-7days --endtime=now)
fi
printf '__CD_HPC_V1_BEGIN__queue\n'
printf '__CD_HPC_V1_BEGIN__queue\n' >&2
squeue "${queue_args[@]}"
queue_status=$?
printf '\n__CD_HPC_V1_END__queue|%s\n' "$queue_status"
printf '__CD_HPC_V1_END__queue\n' >&2
printf '__CD_HPC_V1_BEGIN__history\n'
printf '__CD_HPC_V1_BEGIN__history\n' >&2
sacct "${history_args[@]}"
history_status=$?
printf '\n__CD_HPC_V1_END__history|%s\n' "$history_status"
printf '__CD_HPC_V1_END__history\n' >&2
exit 0
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HpcSnapshot {
    pub host_alias: String,
    pub queried_at: String,
    pub history_days: Option<u8>,
    pub queue: Option<Vec<HpcJob>>,
    pub history: Option<Vec<HpcJob>>,
    pub issues: Vec<HpcIssue>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HpcJob {
    pub job_id: String,
    pub name: String,
    pub state: String,
    pub elapsed: String,
    pub reason: String,
    pub work_dir: String,
    pub exit_code: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HpcIssue { pub source: String, pub message: String }

struct QueryGuard;
impl QueryGuard {
    fn acquire() -> Result<Self, String> {
        QUERY_ACTIVE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self).map_err(|_| "An HPC query is already running.".into())
    }
}
impl Drop for QueryGuard {
    fn drop(&mut self) { QUERY_ACTIVE.store(false, Ordering::Release); }
}

#[tauri::command]
pub async fn query_hpc_jobs(host_alias: String, job_ids: Vec<String>) -> Result<HpcSnapshot, String> {
    let args = ssh_arguments(&host_alias, &job_ids)?;
    let guard = QueryGuard::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        query_with_arguments(&host_alias, &job_ids, args)
    }).await.map_err(|_| "HPC query worker failed.".to_string())?
}

/// CLI and desktop share the same validation, lock and transport.
pub fn query_hpc_jobs_blocking(host_alias: String, job_ids: Vec<String>) -> Result<HpcSnapshot, String> {
    let args = ssh_arguments(&host_alias, &job_ids)?;
    let _guard = QueryGuard::acquire()?;
    query_with_arguments(&host_alias, &job_ids, args)
}

fn valid_job_id(value: &str) -> bool {
    if value.len() > 32 { return false; }
    let mut parts = value.split('_');
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    matches!(parts.next(), Some(part) if digits(part))
        && parts.next().map(digits).unwrap_or(true)
        && parts.next().is_none()
}

fn ssh_arguments(host_alias: &str, job_ids: &[String]) -> Result<Vec<String>, String> {
    if !crate::ssh::valid_host_alias(host_alias) { return Err("Invalid SSH host alias.".into()); }
    if job_ids.len() > 512 || job_ids.iter().any(|id| !valid_job_id(id)) {
        return Err("Provide at most 512 numeric Slurm job IDs or array task IDs.".into());
    }
    let mut args: Vec<String> = [
        "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1",
        host_alias, "bash", "-s", "--",
    ].into_iter().map(String::from).collect();
    args.extend_from_slice(job_ids);
    Ok(args)
}

fn sanitized_failure(diagnostic: &str, scheduler: bool) -> String {
    let text = diagnostic.to_ascii_lowercase();
    if text.contains("host key verification failed") || text.contains("remote host identification")
        || text.contains("no host key is known") {
        "SSH host key needs verification in the terminal.".into()
    } else if text.contains("permission denied") || text.contains("authentication failed")
        || text.contains("sign_and_send_pubkey") {
        "SSH authentication is required in the terminal.".into()
    } else if text.contains("command not found") || text.contains("slurm_load")
        || text.contains("unable to contact slurm") || text.contains("slurmdbd")
        || text.contains("connection refused") && scheduler {
        "Slurm scheduler or accounting is unavailable.".into()
    } else if scheduler {
        "Slurm query failed. Check the scheduler in the terminal.".into()
    } else {
        "SSH query failed. Check the connection in the terminal.".into()
    }
}

fn diagnostic_for<'a>(stderr: &'a str, source: &str) -> &'a str {
    let begin = format!("__CD_HPC_V1_BEGIN__{source}\n");
    let end = format!("__CD_HPC_V1_END__{source}");
    stderr.split_once(&begin).and_then(|(_, tail)| tail.split_once(&end))
        .map(|(body, _)| body).unwrap_or("")
}

fn parse_rows(source: &str, lines: &[&str]) -> Result<Vec<HpcJob>, String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for line in lines {
        if line.trim().is_empty() { continue; }
        let fields: Vec<_> = line.split('|').map(str::trim).collect();
        if fields.len() != 6 { return Err("Invalid Slurm output fields.".into()); }
        let id = fields[0];
        if source == "history" {
            if let Some((allocation, step)) = id.split_once('.') {
                if valid_job_id(allocation) && (step == "batch" || step == "extern"
                    || step.bytes().all(|b| b.is_ascii_digit()) && !step.is_empty()) {
                    continue;
                }
            }
        }
        if !valid_job_id(id) || fields[2].is_empty() { return Err("Invalid Slurm job record.".into()); }
        if !seen.insert(id.to_string()) { continue; }
        result.push(HpcJob {
            job_id: id.into(), name: fields[1].into(), state: fields[2].into(), elapsed: fields[3].into(),
            reason: if source == "queue" { fields[4].into() } else { String::new() },
            work_dir: fields[5].into(), exit_code: (source == "history").then(|| fields[4].to_string()),
        });
    }
    Ok(result)
}

fn parse_snapshot(host_alias: &str, job_ids: &[String], stdout: &str, stderr: &str) -> Result<HpcSnapshot, String> {
    let mut sections: Vec<(&str, Vec<&str>, u8)> = Vec::new();
    let mut current: Option<(&str, Vec<&str>)> = None;
    for line in stdout.lines() {
        if let Some(source) = line.strip_prefix("__CD_HPC_V1_BEGIN__") {
            let expected = if sections.is_empty() { "queue" } else { "history" };
            if current.is_some() || sections.len() >= 2 || source != expected { return Err(FRAMING_ERROR.into()); }
            current = Some((expected, Vec::new()));
        } else if let Some(end) = line.strip_prefix("__CD_HPC_V1_END__") {
            let (source, status) = end.split_once('|').ok_or(FRAMING_ERROR)?;
            if status.is_empty() || !status.bytes().all(|b| b.is_ascii_digit()) { return Err(FRAMING_ERROR.into()); }
            let status = status.parse::<u8>().map_err(|_| FRAMING_ERROR)?;
            let (active, lines) = current.take().ok_or(FRAMING_ERROR)?;
            if source != active { return Err(FRAMING_ERROR.into()); }
            sections.push((active, lines, status));
        } else if let Some((_, lines)) = &mut current { lines.push(line); }
        // Login banners outside framed source data are intentionally ignored.
    }
    if current.is_some() || sections.len() != 2 { return Err(FRAMING_ERROR.into()); }
    let mut issues = Vec::new();
    let mut data = Vec::new();
    for (source, lines, status) in sections {
        let rows = if status != 0 { Err(sanitized_failure(diagnostic_for(stderr, source), true)) }
            else { parse_rows(source, &lines) };
        match rows {
            Ok(rows) => data.push(Some(rows)),
            Err(message) => {
                issues.push(HpcIssue { source: source.into(), message });
                data.push(None);
            }
        }
    }
    let history = data.pop().unwrap();
    let queue = data.pop().unwrap();
    Ok(HpcSnapshot {
        host_alias: host_alias.into(),
        queried_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        history_days: job_ids.is_empty().then_some(7), queue, history, issues,
    })
}
trait ProcessLifecycle {
    fn poll(&mut self) -> Result<Option<bool>, String>;
    fn kill_and_wait(&mut self);
}
#[derive(Debug)]
enum OutputEvent { Chunk(bool, Vec<u8>), Finished, Failed, Overflow, InputClosed }

impl ProcessLifecycle for Child {
    fn poll(&mut self) -> Result<Option<bool>, String> {
        self.try_wait().map(|status| status.map(|status| status.success()))
            .map_err(|_| "Failed while waiting for SSH query.".into())
    }
    fn kill_and_wait(&mut self) {
        let _ = self.kill();
        let _ = self.wait();
    }
}

fn monitor_process<P: ProcessLifecycle>(
    process: &mut P, receiver: &mpsc::Receiver<OutputEvent>, timeout: Duration, limit: usize,
) -> Result<(String, String, bool), String> {
    let start = Instant::now();
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut finished = 0;
    let mut input_closed = false;
    let outcome = (|| {
        loop {
            if start.elapsed() >= timeout { return Err("HPC query timed out after 30 seconds.".into()); }
            while let Ok(event) = receiver.try_recv() {
                match event {
                    OutputEvent::Chunk(out, bytes) => {
                        if stdout.len() + stderr.len() + bytes.len() > limit {
                            return Err("HPC query exceeded the 2 MiB output limit.".into());
                        }
                        if out { stdout.extend(bytes); } else { stderr.extend(bytes); }
                    }
                    OutputEvent::Finished => finished += 1,
                    OutputEvent::Failed => return Err("Failed reading SSH query data.".into()),
                    OutputEvent::InputClosed => input_closed = true,
                    OutputEvent::Overflow => return Err("HPC query exceeded the 2 MiB output limit.".into()),
                }
            }
            if let Some(success) = process.poll()? {
                if finished == 2 {
                    if success && input_closed { return Err("Failed writing SSH query script.".into()); }
                    return Ok((
                        String::from_utf8(stdout).map_err(|_| "Invalid UTF-8 HPC output.".to_string())?,
                        String::from_utf8(stderr).map_err(|_| "Invalid UTF-8 SSH diagnostics.".to_string())?,
                        success,
                    ));
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
    })();
    if outcome.is_err() { process.kill_and_wait(); }
    outcome
}

fn stream_reader<R: Read + Send + 'static>(
    mut stream: R, stdout: bool, sender: mpsc::Sender<OutputEvent>, total: Arc<AtomicUsize>, cancelled: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while !cancelled.load(Ordering::Acquire) {
            match stream.read(&mut buffer) {
                Ok(0) => { let _ = sender.send(OutputEvent::Finished); break; }
                Ok(count) => {
                    let previous = total.fetch_add(count, Ordering::Relaxed);
                    if previous + count > MAX_OUTPUT_BYTES {
                        let _ = sender.send(OutputEvent::Overflow); break;
                    }
                    if sender.send(OutputEvent::Chunk(stdout, buffer[..count].to_vec())).is_err() { break; }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => { let _ = sender.send(OutputEvent::Failed); break; }
            }
        }
    })
}

struct SharedPipe(Arc<File>);
impl Read for SharedPipe {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> { (&*self.0).read(buffer) }
}
impl Write for SharedPipe {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> { (&*self.0).write(buffer) }
    fn flush(&mut self) -> std::io::Result<()> { (&*self.0).flush() }
}
#[cfg(windows)]
fn share_pipe<T: std::os::windows::io::IntoRawHandle>(pipe: T) -> Arc<File> {
    use std::os::windows::io::FromRawHandle;
    // Transfer ownership once; Arc keeps the same handle alive while I/O is canceled.
    Arc::new(unsafe { File::from_raw_handle(pipe.into_raw_handle()) })
}
#[cfg(unix)]
fn share_pipe<T: std::os::fd::IntoRawFd>(pipe: T) -> Arc<File> {
    use std::os::fd::FromRawFd;
    Arc::new(unsafe { File::from_raw_fd(pipe.into_raw_fd()) })
}

fn finish_pipe_workers(workers: Vec<thread::JoinHandle<()>>, cancelled: &AtomicBool, pipes: &[Weak<File>]) -> usize {
    cancelled.store(true, Ordering::Release);
    let start = Instant::now();
    while workers.iter().any(|worker| !worker.is_finished()) && start.elapsed() < PIPE_CLEANUP_TIMEOUT {
        #[cfg(windows)] {
            use std::os::windows::io::AsRawHandle;
            #[link(name = "kernel32")]
            extern "system" {
                fn CancelSynchronousIo(thread: *mut std::ffi::c_void) -> i32;
                fn CancelIoEx(file: *mut std::ffi::c_void, overlapped: *mut std::ffi::c_void) -> i32;
            }
            for pipe in pipes {
                // Upgrading weak ownership protects the original handle during
                // cancellation without holding stdin open after its writer exits.
                if let Some(pipe) = pipe.upgrade() {
                    unsafe { CancelIoEx(pipe.as_raw_handle(), std::ptr::null_mut()); }
                }
            }
            for worker in &workers {
                if !worker.is_finished() {
                    // JoinHandle owns a live thread handle. Cancellation is best
                    // effort and nonblocking; it may race with I/O completion.
                    unsafe { CancelSynchronousIo(worker.as_raw_handle()); }
                }
            }
        }
        thread::sleep(Duration::from_millis(1));
    }
    let mut detached = 0;
    for worker in workers {
        // Descendants of a ProxyCommand can retain pipe handles after SSH exits.
        // Never wait indefinitely: unfinished workers detach on handle drop.
        if worker.is_finished() { let _ = worker.join(); } else { detached += 1; }
    }
    detached
}

fn query_with_arguments(host_alias: &str, job_ids: &[String], args: Vec<String>) -> Result<HpcSnapshot, String> {
    let mut command = Command::new(crate::ssh::ssh_program()?);
    command.args(args);
    let (stdout, stderr, success) = run_script(command, QUERY_SCRIPT, QUERY_TIMEOUT)?;
    if !success { return Err(sanitized_failure(&stderr, false)); }
    parse_snapshot(host_alias, job_ids, &stdout, &stderr)
}

fn run_script(mut command: Command, script: &'static str, timeout: Duration) -> Result<(String, String, bool), String> {
    let started = Instant::now();
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; no PTY.
    }
    let mut child = command.spawn().map_err(|_| "Failed to start Windows OpenSSH query.".to_string())?;
    let (sender, receiver) = mpsc::channel();
    let total = Arc::new(AtomicUsize::new(0));
    let cancelled = Arc::new(AtomicBool::new(false));
    let out_pipe = share_pipe(child.stdout.take().unwrap());
    let err_pipe = share_pipe(child.stderr.take().unwrap());
    let in_pipe = share_pipe(child.stdin.take().unwrap());
    let cancellation_pipes = [Arc::downgrade(&in_pipe), Arc::downgrade(&out_pipe), Arc::downgrade(&err_pipe)];
    let stdout = stream_reader(SharedPipe(out_pipe.clone()), true, sender.clone(), total.clone(), cancelled.clone());
    let stderr = stream_reader(SharedPipe(err_pipe.clone()), false, sender.clone(), total, cancelled.clone());
    let mut stdin = SharedPipe(in_pipe);
    let writer = thread::spawn(move || {
        if stdin.write_all(script.as_bytes()).is_err() { let _ = sender.send(OutputEvent::InputClosed); }
    });
    let remaining = timeout.saturating_sub(started.elapsed()).saturating_sub(PIPE_CLEANUP_TIMEOUT);
    let result = monitor_process(&mut child, &receiver, remaining, MAX_OUTPUT_BYTES);
    // Reserve cleanup time inside the query deadline; stalled inherited pipes
    // cannot retain the single-query guard after the SSH process is reaped.
    finish_pipe_workers(vec![writer, stdout, stderr], &cancelled, &cancellation_pipes);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn framed(queue: &str, history: &str, q_status: u8, h_status: u8) -> String {
        format!("Login banner\n__CD_HPC_V1_BEGIN__queue\n{queue}__CD_HPC_V1_END__queue|{q_status}\n__CD_HPC_V1_BEGIN__history\n{history}__CD_HPC_V1_END__history|{h_status}\n")
    }

    #[test]
    fn argv_is_fixed_and_rejects_shell_inputs() {
        let args = ssh_arguments("tud-hpc", &["123".into(), "123_4".into()]).unwrap();
        assert_eq!(args, ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1", "tud-hpc", "bash", "-s", "--", "123", "123_4"]);
        for alias in ["-oProxyCommand=evil", "user@host", "host;pwd", "host name", ""] { assert!(ssh_arguments(alias, &[]).is_err()); }
        for id in ["1;pwd", "1_", "_1", "1_2_3", "1.batch", "$(pwd)", ""] { assert!(ssh_arguments("tud-hpc", &[id.into()]).is_err()); }
        assert!(ssh_arguments("tud-hpc", &vec!["1".into(); 513]).is_err());
    }

    #[test]
    fn blank_success_is_distinct_from_failed_source() {
        let value = parse_snapshot("tud-hpc", &[], &framed("", "", 0, 0), "").unwrap();
        assert_eq!(value.queue.unwrap().len(), 0);
        assert_eq!(value.history.unwrap().len(), 0);
        assert_eq!(value.history_days, Some(7));
        assert!(chrono::DateTime::parse_from_rfc3339(&value.queried_at).is_ok());
        let value = parse_snapshot("tud-hpc", &["1".into()], &framed("", "", 0, 1), "secret diagnostic path").unwrap();
        assert!(value.queue.is_some());
        assert!(value.history.is_none());
        assert_eq!(value.history_days, None);
        assert_eq!(value.issues[0].source, "history");
        assert!(!value.issues[0].message.contains("secret"));
    }

    #[test]
    fn malformed_rows_fail_only_their_source_and_invalid_framing_fails_transport() {
        let value = parse_snapshot("tud-hpc", &[], &framed("1|short\n", "", 0, 0), "").unwrap();
        assert!(value.queue.is_none());
        assert!(value.history.is_some());
        for text in ["", "__CD_HPC_V1_BEGIN__queue\n", "__CD_HPC_V1_BEGIN__queue\n__CD_HPC_V1_END__queue|oops\n", "__CD_HPC_V1_END__queue|0\n"] {
            assert!(parse_snapshot("tud-hpc", &[], text, "").is_err());
        }
    }

    #[test]
    fn allocation_rows_preserve_array_ids_and_original_states() {
        let data = framed("123_4|name|RUNNING|1:02|None|/scratch/me\n", "123_4|name|CANCELLED by 42|00:01|0:15|/scratch/me\n123_4.batch|batch|CANCELLED|00:01|0:15|/scratch/me\n123_4.extern|extern|COMPLETED|00:01|0:0|/scratch/me\n123_4.0|step|COMPLETED|00:01|0:0|/scratch/me\n123_4|name|CANCELLED by 42|00:01|0:15|/scratch/me\n", 0, 0);
        let value = parse_snapshot("tud-hpc", &[], &data, "").unwrap();
        let jobs = value.history.unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].job_id, "123_4");
        assert_eq!(jobs[0].state, "CANCELLED by 42");
        assert_eq!(jobs[0].exit_code.as_deref(), Some("0:15"));
        assert_eq!(value.queue.unwrap()[0].reason, "None");
    }

    struct FakeProcess { stopped: usize, exited: bool }
    impl ProcessLifecycle for FakeProcess {
        fn poll(&mut self) -> Result<Option<bool>, String> { Ok(self.exited.then_some(true)) }
        fn kill_and_wait(&mut self) { self.stopped += 1; }
    }

    #[test]
    fn timeout_and_overflow_kill_and_reap_before_return() {
        let (tx, rx) = mpsc::channel();
        let mut process = FakeProcess { stopped: 0, exited: false };
        assert!(monitor_process(&mut process, &rx, Duration::ZERO, 16).unwrap_err().contains("timed out"));
        assert_eq!(process.stopped, 1);
        tx.send(OutputEvent::Chunk(true, vec![b'a'; 17])).unwrap();
        let mut process = FakeProcess { stopped: 0, exited: false };
        assert!(monitor_process(&mut process, &rx, Duration::from_secs(1), 16).unwrap_err().contains("limit"));
        assert_eq!(process.stopped, 1);
    }

    #[test]
    fn process_success_requires_both_streams_and_collects_them_separately() {
        let (tx, rx) = mpsc::channel();
        tx.send(OutputEvent::Chunk(true, b"rows".to_vec())).unwrap();
        tx.send(OutputEvent::Chunk(false, b"diagnostic".to_vec())).unwrap();
        tx.send(OutputEvent::Finished).unwrap();
        tx.send(OutputEvent::Finished).unwrap();
        let mut process = FakeProcess { stopped: 0, exited: true };
        assert_eq!(monitor_process(&mut process, &rx, Duration::from_secs(1), 32).unwrap(), ("rows".into(), "diagnostic".into(), true));
        assert_eq!(process.stopped, 0);
    }

    #[test]
    fn closed_stdin_does_not_hide_authentication_failure() {
        let (tx, rx) = mpsc::channel();
        tx.send(OutputEvent::InputClosed).unwrap();
        tx.send(OutputEvent::Chunk(false, b"Permission denied (publickey).".to_vec())).unwrap();
        tx.send(OutputEvent::Finished).unwrap();
        tx.send(OutputEvent::Finished).unwrap();
        struct DeniedProcess;
        impl ProcessLifecycle for DeniedProcess {
            fn poll(&mut self) -> Result<Option<bool>, String> { Ok(Some(false)) }
            fn kill_and_wait(&mut self) {}
        }
        let (_, diagnostic, success) = monitor_process(&mut DeniedProcess, &rx, Duration::from_secs(1), 128).unwrap();
        assert!(!success);
        assert_eq!(sanitized_failure(&diagnostic, false), "SSH authentication is required in the terminal.");
    }

    #[cfg(windows)]
    #[test]
    fn real_subprocess_is_reaped_on_timeout_and_overflow() {
        use std::os::windows::process::CommandExt;
        let program = std::path::PathBuf::from(std::env::var_os("WINDIR").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        for (script, timeout, limit) in [
            ("Start-Sleep -Seconds 20", Duration::from_millis(50), 512),
            ("[Console]::Out.Write(('x' * 8192)); Start-Sleep -Seconds 20", Duration::from_secs(5), 512),
        ] {
            let mut child = Command::new(&program).args(["-NoProfile", "-NonInteractive", "-Command", script])
                .creation_flags(0x08000000).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
            let (tx, rx) = mpsc::channel();
            let total = Arc::new(AtomicUsize::new(0));
            let cancelled = Arc::new(AtomicBool::new(false));
            let out = stream_reader(child.stdout.take().unwrap(), true, tx.clone(), total.clone(), cancelled.clone());
            let err = stream_reader(child.stderr.take().unwrap(), false, tx, total, cancelled);
            let error = monitor_process(&mut child, &rx, timeout, limit).unwrap_err();
            assert!(error.contains("timed out") || error.contains("limit"));
            assert!(child.try_wait().unwrap().is_some());
            out.join().unwrap();
            err.join().unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn inherited_descendant_pipes_cannot_hold_query_guard_past_deadline() {
        use std::os::windows::process::CommandExt;
        let program = std::path::PathBuf::from(std::env::var_os("WINDIR").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = format!("$desc = Start-Process -FilePath '{}' -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 5' -NoNewWindow -PassThru; [Console]::Out.WriteLine($desc.Id); Start-Sleep -Seconds 30", program.display());
        let mut child = Command::new(&program).args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x08000000).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let (tx, rx) = mpsc::channel();
        let total = Arc::new(AtomicUsize::new(0));
        let cancelled = Arc::new(AtomicBool::new(false));
        let out_pipe = share_pipe(child.stdout.take().unwrap());
        let err_pipe = share_pipe(child.stderr.take().unwrap());
        let out = stream_reader(SharedPipe(out_pipe.clone()), true, tx.clone(), total.clone(), cancelled.clone());
        let err = stream_reader(SharedPipe(err_pipe.clone()), false, tx, total, cancelled.clone());
        let descendant_pid = loop {
            if let OutputEvent::Chunk(true, bytes) = rx.recv_timeout(Duration::from_secs(5)).unwrap() {
                break String::from_utf8(bytes).unwrap().trim().parse::<u32>().unwrap();
            }
        };
        let guard = QueryGuard::acquire().unwrap();
        let start = Instant::now();
        let error = monitor_process(&mut child, &rx, Duration::from_millis(50), 512).unwrap_err();
        assert!(error.contains("timed out"));
        assert!(child.try_wait().unwrap().is_some());
        let detached = finish_pipe_workers(vec![out, err], &cancelled, &[Arc::downgrade(&out_pipe), Arc::downgrade(&err_pipe)]);
        drop(guard);
        let elapsed = start.elapsed();
        // Test fixture cleanup targets its explicit descendant only.
        let _ = Command::new(&program).args(["-NoProfile", "-NonInteractive", "-Command",
            &format!("Stop-Process -Id {descendant_pid} -Force -ErrorAction SilentlyContinue")])
            .creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status();
        assert!(elapsed < Duration::from_secs(1), "cleanup blocked for {elapsed:?}");
        assert_eq!(detached, 0, "cancelled pipe workers must close their handles");
        assert!(QueryGuard::acquire().is_ok());
    }

    #[test]
    fn cancellation_prevents_retrying_an_interrupted_read() {
        struct InterruptedReader { reads: Arc<AtomicUsize>, cancelled: Arc<AtomicBool> }
        impl Read for InterruptedReader {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                if self.reads.fetch_add(1, Ordering::Relaxed) == 0 {
                    self.cancelled.store(true, Ordering::Release);
                    Err(std::io::Error::from(std::io::ErrorKind::Interrupted))
                } else { Ok(0) }
            }
        }
        let reads = Arc::new(AtomicUsize::new(0));
        let cancelled = Arc::new(AtomicBool::new(false));
        let (tx, _rx) = mpsc::channel();
        stream_reader(InterruptedReader { reads: reads.clone(), cancelled: cancelled.clone() }, true,
            tx, Arc::new(AtomicUsize::new(0)), cancelled).join().unwrap();
        assert_eq!(reads.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn worker_cleanup_sets_the_cancellation_signal() {
        let cancelled = AtomicBool::new(false);
        assert_eq!(finish_pipe_workers(vec![], &cancelled, &[]), 0);
        assert!(cancelled.load(Ordering::Acquire));
    }

    #[cfg(windows)]
    #[test]
    fn completed_script_writer_closes_stdin_before_waiting_for_process() {
        let program = std::path::PathBuf::from(std::env::var_os("WINDIR").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(program);
        command.args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::Out.Write([Console]::In.ReadToEnd()); exit 0"]);
        // Cold PowerShell startup can exceed two seconds on parallel Windows CI.
        // A retained stdin handle still prevents ReadToEnd from finishing and
        // fails this regression test within its bounded fixture deadline.
        let (stdout, stderr, success) = run_script(command, "payload\n", Duration::from_secs(10)).unwrap();
        assert!(success);
        assert_eq!(stdout, "payload\n");
        assert_eq!(stderr, "");
    }
}
