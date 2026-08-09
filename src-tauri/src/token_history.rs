use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

use chrono::{DateTime, Days, Local, NaiveDate, Utc};
use serde::{de::IgnoredAny, Deserialize};

use crate::models::{DailyTokenTotal, TokenHistorySnapshot, TokenSourceTotal, TokenUsageBreakdown};

#[derive(Default, Deserialize)]
struct HistoryEvent {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    event_type: Option<String>,
    #[serde(default)]
    payload: HistoryPayload,
}

#[derive(Default, Deserialize)]
struct HistoryPayload {
    #[serde(rename = "type")]
    payload_type: Option<String>,
    source: Option<SessionSourceValue>,
    info: Option<TokenUsageInfo>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SessionSourceValue {
    Name(String),
    Metadata(SessionSourceMetadata),
}

#[derive(Default, Deserialize)]
struct SessionSourceMetadata {
    subagent: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct TokenUsageInfo {
    total_token_usage: Option<TokenUsageCounters>,
}

#[derive(Default, Deserialize)]
struct TokenUsageCounters {
    total_tokens: Option<u64>,
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    reasoning_output_tokens: u64,
}

impl TokenUsageCounters {
    fn into_breakdown(self) -> Option<TokenUsageBreakdown> {
        Some(TokenUsageBreakdown {
            raw: self.total_tokens?,
            input: self.input_tokens,
            cached_input: self.cached_input_tokens,
            uncached_input: self.input_tokens.saturating_sub(self.cached_input_tokens),
            output: self.output_tokens,
            reasoning_output: self.reasoning_output_tokens,
        })
    }
}

impl TokenUsageBreakdown {
    fn delta_from(self, previous: Option<Self>) -> Self {
        let Some(previous) = previous else {
            return self;
        };
        if self.raw < previous.raw {
            return self;
        }
        Self {
            raw: self.raw.saturating_sub(previous.raw),
            input: self.input.saturating_sub(previous.input),
            cached_input: self.cached_input.saturating_sub(previous.cached_input),
            uncached_input: self.uncached_input.saturating_sub(previous.uncached_input),
            output: self.output.saturating_sub(previous.output),
            reasoning_output: self
                .reasoning_output
                .saturating_sub(previous.reasoning_output),
        }
    }

    fn add(&mut self, other: Self) {
        self.raw = self.raw.saturating_add(other.raw);
        self.input = self.input.saturating_add(other.input);
        self.cached_input = self.cached_input.saturating_add(other.cached_input);
        self.uncached_input = self.uncached_input.saturating_add(other.uncached_input);
        self.output = self.output.saturating_add(other.output);
        self.reasoning_output = self.reasoning_output.saturating_add(other.reasoning_output);
    }
}

#[derive(Clone, Copy, Default)]
struct DailyAccumulator {
    usage: TokenUsageBreakdown,
    event_count: u64,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum SessionSource {
    Vscode,
    Subagent,
    #[default]
    Other,
}

impl SessionSource {
    fn index(self) -> usize {
        match self {
            Self::Vscode => 0,
            Self::Subagent => 1,
            Self::Other => 2,
        }
    }
}

fn classify_source(source: Option<&SessionSourceValue>) -> SessionSource {
    match source {
        Some(SessionSourceValue::Name(name)) if name.eq_ignore_ascii_case("vscode") => {
            SessionSource::Vscode
        }
        Some(SessionSourceValue::Name(name)) if name.eq_ignore_ascii_case("subagent") => {
            SessionSource::Subagent
        }
        Some(SessionSourceValue::Metadata(metadata)) if metadata.subagent.is_some() => {
            SessionSource::Subagent
        }
        _ => SessionSource::Other,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HistoryRootKind {
    Active,
    Archive,
}

#[derive(Clone, Copy)]
struct HistoryRoot<'a> {
    path: &'a Path,
    kind: HistoryRootKind,
}

impl<'a> HistoryRoot<'a> {
    fn active(path: &'a Path) -> Self {
        Self {
            path,
            kind: HistoryRootKind::Active,
        }
    }

    fn archive(path: &'a Path) -> Self {
        Self {
            path,
            kind: HistoryRootKind::Archive,
        }
    }
}

#[derive(Default)]
struct SessionAggregate {
    source: SessionSource,
    daily: BTreeMap<NaiveDate, DailyAccumulator>,
}

#[derive(Clone, Copy, Default)]
struct SourceAccumulator {
    file_count: u64,
    usage: TokenUsageBreakdown,
}

struct DiscoveredFile {
    path: PathBuf,
    canonical_path: PathBuf,
    kind: HistoryRootKind,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct FileCacheKey {
    canonical_path: PathBuf,
    length: u64,
    modified: SystemTime,
}

static SESSION_CACHE: OnceLock<Mutex<HashMap<FileCacheKey, Arc<SessionAggregate>>>> =
    OnceLock::new();

fn session_cache() -> &'static Mutex<HashMap<FileCacheKey, Arc<SessionAggregate>>> {
    SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn system_local_date(timestamp: DateTime<Utc>) -> NaiveDate {
    timestamp.with_timezone(&Local).date_naive()
}

fn empty_days(today: NaiveDate) -> BTreeMap<NaiveDate, DailyAccumulator> {
    (0..7)
        .filter_map(|offset| today.checked_sub_days(Days::new(offset)))
        .map(|date| (date, DailyAccumulator::default()))
        .collect()
}

fn aggregate_reader<R: Read>(reader: R) -> SessionAggregate {
    aggregate_reader_with_date_resolver(reader, system_local_date)
}

fn aggregate_reader_with_date_resolver<R: Read, F>(reader: R, resolve_date: F) -> SessionAggregate
where
    F: Fn(DateTime<Utc>) -> NaiveDate,
{
    let mut aggregate = SessionAggregate::default();
    let mut previous_usage = None;

    for line in BufReader::new(reader).lines().map_while(Result::ok) {
        let Ok(event) = serde_json::from_str::<HistoryEvent>(&line) else {
            continue;
        };
        if event.event_type.as_deref() == Some("session_meta") {
            aggregate.source = classify_source(event.payload.source.as_ref());
            continue;
        }
        if event.payload.payload_type.as_deref() != Some("token_count") {
            continue;
        }
        let Some(current_usage) = event
            .payload
            .info
            .and_then(|info| info.total_token_usage)
            .and_then(TokenUsageCounters::into_breakdown)
        else {
            continue;
        };
        let Some(timestamp) = event.timestamp else {
            continue;
        };
        let Ok(timestamp) = DateTime::parse_from_rfc3339(&timestamp) else {
            continue;
        };
        let date = resolve_date(timestamp.with_timezone(&Utc));
        let delta = current_usage.delta_from(previous_usage);
        previous_usage = Some(current_usage);
        if delta.raw == 0 {
            continue;
        }
        let day = aggregate.daily.entry(date).or_default();
        day.usage.add(delta);
        day.event_count = day.event_count.saturating_add(1);
    }

    aggregate
}

fn discover_history_files(roots: &[HistoryRoot<'_>]) -> Vec<DiscoveredFile> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for root in roots {
        let mut directories = vec![root.path.to_path_buf()];
        while let Some(directory) = directories.pop() {
            let Ok(entries) = fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                let path = entry.path();
                if file_type.is_dir() {
                    directories.push(path);
                    continue;
                }
                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if !file_type.is_file()
                    || !name.starts_with("rollout-")
                    || !name.ends_with(".jsonl")
                {
                    continue;
                }
                let canonical_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                if seen.insert(canonical_path.clone()) {
                    files.push(DiscoveredFile {
                        path,
                        canonical_path,
                        kind: root.kind,
                    });
                }
            }
        }
    }

    files
}

fn load_session(file: fs::File, canonical_path: &Path) -> Arc<SessionAggregate> {
    let cache_key = file.metadata().ok().and_then(|metadata| {
        Some(FileCacheKey {
            canonical_path: canonical_path.to_path_buf(),
            length: metadata.len(),
            modified: metadata.modified().ok()?,
        })
    });

    if let Some(key) = cache_key.as_ref() {
        let cache = session_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.get(key) {
            return Arc::clone(cached);
        }
    }

    let aggregate = Arc::new(aggregate_reader(file));
    if let Some(key) = cache_key {
        let mut cache = session_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.retain(|cached_key, _| cached_key.canonical_path != key.canonical_path);
        cache.insert(key, Arc::clone(&aggregate));
    }
    aggregate
}

fn read_history_from_files(files: Vec<DiscoveredFile>, today: NaiveDate) -> TokenHistorySnapshot {
    let mut totals = empty_days(today);
    let mut sources = [SourceAccumulator::default(); 3];
    let mut active_file_count = 0_u64;
    let mut archive_file_count = 0_u64;
    let mut unreadable_file_count = 0_u64;

    let live_paths = files
        .iter()
        .map(|file| file.canonical_path.clone())
        .collect::<HashSet<_>>();
    session_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .retain(|key, _| live_paths.contains(&key.canonical_path));

    for discovered in files {
        match discovered.kind {
            HistoryRootKind::Active => active_file_count = active_file_count.saturating_add(1),
            HistoryRootKind::Archive => archive_file_count = archive_file_count.saturating_add(1),
        }

        let file = match fs::File::open(&discovered.path) {
            Ok(file) => file,
            Err(_) => {
                unreadable_file_count = unreadable_file_count.saturating_add(1);
                continue;
            }
        };
        let aggregate = load_session(file, &discovered.canonical_path);
        let source = &mut sources[aggregate.source.index()];
        source.file_count = source.file_count.saturating_add(1);

        for (date, day) in &aggregate.daily {
            let Some(total) = totals.get_mut(date) else {
                continue;
            };
            total.usage.add(day.usage);
            total.event_count = total.event_count.saturating_add(day.event_count);
            source.usage.add(day.usage);
        }
    }

    snapshot_from_totals(
        totals,
        today,
        sources,
        active_file_count,
        archive_file_count,
        unreadable_file_count,
    )
}

fn read_history_from_roots(roots: &[HistoryRoot<'_>], today: NaiveDate) -> TokenHistorySnapshot {
    read_history_from_files(discover_history_files(roots), today)
}

fn snapshot_from_totals(
    totals: BTreeMap<NaiveDate, DailyAccumulator>,
    today: NaiveDate,
    source_totals: [SourceAccumulator; 3],
    active_file_count: u64,
    archive_file_count: u64,
    unreadable_file_count: u64,
) -> TokenHistorySnapshot {
    let mut usage = TokenUsageBreakdown::default();
    let mut event_count = 0_u64;
    for day in totals.values() {
        usage.add(day.usage);
        event_count = event_count.saturating_add(day.event_count);
    }
    let today_tokens = totals.get(&today).map(|day| day.usage.raw).unwrap_or(0);
    let average_request_tokens = if event_count == 0 {
        0
    } else {
        usage.raw / event_count
    };
    let daily = totals
        .into_iter()
        .map(|(date, day)| DailyTokenTotal {
            date: date.format("%Y-%m-%d").to_string(),
            total_tokens: day.usage.raw,
            event_count: day.event_count,
            usage: day.usage,
        })
        .collect();
    let names = ["vscode", "subagent", "other"];
    let sources = names
        .into_iter()
        .zip(source_totals)
        .map(|(source, total)| TokenSourceTotal {
            source: source.to_string(),
            file_count: total.file_count,
            usage: total.usage,
        })
        .collect();

    TokenHistorySnapshot {
        today_tokens,
        seven_day_tokens: usage.raw,
        average_request_tokens,
        daily,
        event_count,
        usage,
        sources,
        active_file_count,
        archive_file_count,
        unreadable_file_count,
    }
}

#[tauri::command]
pub async fn get_token_history() -> Result<TokenHistorySnapshot, String> {
    let codex_root = crate::codex_root::codex_root().map_err(str::to_string)?;
    let active = codex_root.join("sessions");
    let archive = codex_root.join("archived_sessions");
    tauri::async_runtime::spawn_blocking(move || {
        read_history_from_roots(
            &[HistoryRoot::active(&active), HistoryRoot::archive(&archive)],
            system_local_date(Utc::now()),
        )
    })
    .await
    .map_err(|error| format!("Token history worker failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(std::path::PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "kunkun-token-history-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn usage_event(
        timestamp: &str,
        raw: u64,
        input: u64,
        cached: u64,
        output: u64,
        reasoning: u64,
    ) -> Value {
        json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": input,
                        "cached_input_tokens": cached,
                        "output_tokens": output,
                        "reasoning_output_tokens": reasoning,
                        "total_tokens": raw
                    }
                }
            }
        })
    }

    fn write_session(path: &Path, source: Value, timestamp: &str, events: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut lines = vec![json!({
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": { "source": source }
        })
        .to_string()];
        lines.extend(events.iter().map(Value::to_string));
        fs::write(path, format!("{}\n", lines.join("\n"))).unwrap();
    }

    #[test]
    fn combines_active_and_archive_with_local_dates_deltas_and_source_totals() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
        let timestamp = "2026-07-14T22:30:00Z";
        let fixture = TestDirectory::new();
        let active = fixture.0.join("sessions");
        let archive = fixture.0.join("archived_sessions");

        write_session(
            &active.join("2026/07/15/rollout-vscode.jsonl"),
            json!("vscode"),
            timestamp,
            &[
                usage_event(timestamp, 100, 80, 30, 20, 5),
                usage_event(timestamp, 100, 80, 30, 20, 5),
                usage_event(timestamp, 160, 130, 50, 30, 8),
            ],
        );
        write_session(
            &active.join("2026/07/15/rollout-other.jsonl"),
            json!("exec"),
            timestamp,
            &[usage_event(timestamp, 10, 8, 3, 2, 1)],
        );
        write_session(
            &archive.join("rollout-subagent.jsonl"),
            json!({ "subagent": { "other": "test" } }),
            timestamp,
            &[usage_event(timestamp, 40, 30, 10, 10, 2)],
        );

        let snapshot = read_history_from_roots(
            &[
                HistoryRoot::active(&active),
                HistoryRoot::active(&active),
                HistoryRoot::archive(&archive),
            ],
            today,
        );

        assert_eq!(snapshot.today_tokens, 210);
        assert_eq!(snapshot.seven_day_tokens, 210);
        assert_eq!(snapshot.event_count, 4);
        assert_eq!(snapshot.usage.raw, 210);
        assert_eq!(snapshot.usage.input, 168);
        assert_eq!(snapshot.usage.cached_input, 63);
        assert_eq!(snapshot.usage.uncached_input, 105);
        assert_eq!(snapshot.usage.output, 42);
        assert_eq!(snapshot.usage.reasoning_output, 11);
        assert_eq!(snapshot.active_file_count, 2);
        assert_eq!(snapshot.archive_file_count, 1);
        assert_eq!(snapshot.sources[0].source, "vscode");
        assert_eq!(snapshot.sources[0].file_count, 1);
        assert_eq!(snapshot.sources[0].usage.raw, 160);
        assert_eq!(snapshot.sources[1].source, "subagent");
        assert_eq!(snapshot.sources[1].file_count, 1);
        assert_eq!(snapshot.sources[1].usage.raw, 40);
        assert_eq!(snapshot.sources[2].source, "other");
        assert_eq!(snapshot.sources[2].file_count, 1);
        assert_eq!(snapshot.sources[2].usage.raw, 10);
        assert_eq!(snapshot.daily.len(), 7);
        assert_eq!(snapshot.daily.last().unwrap().date, "2026-07-15");
        assert_eq!(snapshot.daily.last().unwrap().usage.raw, 210);
    }

    #[test]
    fn invalid_timestamp_does_not_advance_the_cumulative_baseline() {
        let current = "2026-07-15T12:00:00Z";
        let input = [
            usage_event("2026-07-01T12:00:00Z", 100, 80, 30, 20, 5),
            usage_event("not-a-timestamp", 150, 120, 45, 30, 7),
            usage_event(current, 200, 160, 60, 40, 10),
        ]
        .into_iter()
        .map(|event| event.to_string())
        .collect::<Vec<_>>()
        .join("\n");

        let aggregate = aggregate_reader(input.as_bytes());
        let day = aggregate
            .daily
            .get(&NaiveDate::from_ymd_opt(2026, 7, 15).unwrap())
            .unwrap();

        assert_eq!(day.usage.raw, 100);
        assert_eq!(day.event_count, 1);
    }

    #[test]
    fn groups_events_with_the_supplied_local_date_resolver() {
        let input = usage_event("2026-07-15T23:30:00Z", 100, 80, 30, 20, 5).to_string();
        let forced_date = NaiveDate::from_ymd_opt(2026, 7, 16).unwrap();

        let aggregate = aggregate_reader_with_date_resolver(input.as_bytes(), |_| forced_date);

        assert_eq!(aggregate.daily.get(&forced_date).unwrap().usage.raw, 100);
    }

    #[test]
    fn unreadable_files_are_reported_without_becoming_other_sources() {
        let fixture = TestDirectory::new();
        let missing = fixture.0.join("rollout-missing.jsonl");
        let snapshot = read_history_from_files(
            vec![DiscoveredFile {
                path: missing.clone(),
                canonical_path: missing,
                kind: HistoryRootKind::Active,
            }],
            NaiveDate::from_ymd_opt(2026, 7, 15).unwrap(),
        );

        assert_eq!(snapshot.active_file_count, 1);
        assert_eq!(snapshot.unreadable_file_count, 1);
        assert_eq!(snapshot.sources[2].source, "other");
        assert_eq!(snapshot.sources[2].file_count, 0);
    }

    #[test]
    fn shortened_files_are_reparsed_instead_of_using_cached_totals() {
        let fixture = TestDirectory::new();
        let active = fixture.0.join("sessions");
        let path = active.join("2026/07/15/rollout-cache.jsonl");
        let timestamp = "2026-07-15T12:00:00Z";
        let roots = [HistoryRoot::active(&active)];
        let today = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();

        write_session(
            &path,
            json!("vscode"),
            timestamp,
            &[
                usage_event(timestamp, 1_000, 800, 300, 200, 50),
                usage_event(timestamp, 2_000, 1_600, 600, 400, 100),
            ],
        );
        assert_eq!(read_history_from_roots(&roots, today).usage.raw, 2_000);

        write_session(
            &path,
            json!("vscode"),
            timestamp,
            &[usage_event(timestamp, 100, 80, 30, 20, 5)],
        );
        assert_eq!(read_history_from_roots(&roots, today).usage.raw, 100);
    }
}
