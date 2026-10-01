mod codex;
mod codex_launcher;
mod codex_root;
pub mod hpc_query;
mod models;
mod ssh;
mod token_history;

use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use models::{ProviderSnapshot, WidgetPreferences};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

const WINDOW_STATE_FILENAME: &str = ".window-state-v3.json";
const WINDOW_STATE_FLAGS: StateFlags = StateFlags::POSITION;
const HTTP_USER_AGENT: &str = concat!("CompanionDesk/", env!("CARGO_PKG_VERSION"));

struct AppState {
    client: reqwest::Client,
    preferences: Mutex<WidgetPreferences>,
    preferences_path: PathBuf,
    fetch_lock: tokio::sync::Mutex<()>,
    snapshot_cache: Mutex<Option<(Instant, Vec<ProviderSnapshot>)>>,
}

async fn fetch_snapshots_uncached(state: &State<'_, AppState>) -> Vec<ProviderSnapshot> {
    let _guard = state.fetch_lock.lock().await;
    let values = vec![codex::fetch_snapshot(&state.client).await];
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    values
}

fn load_preferences(path: &PathBuf) -> WidgetPreferences {
    let parse = |candidate: &PathBuf| {
        fs::read_to_string(candidate)
            .ok()
            .and_then(|raw| serde_json::from_str::<WidgetPreferences>(&raw).ok())
    };
    if let Some(value) = parse(path) {
        return value.normalized();
    }
    let backup = path.with_extension("json.bak");
    if let Some(value) = parse(&backup) {
        eprintln!("preferences recovered from backup");
        return value.normalized();
    }
    WidgetPreferences::default()
}

fn persist_preferences(path: &PathBuf, value: &WidgetPreferences) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "failed to create settings directory".to_string())?;
    }
    let serialized =
        serde_json::to_vec_pretty(value).map_err(|_| "failed to serialize settings".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = fs::File::create(&temporary)
        .map_err(|_| "failed to create temporary settings file".to_string())?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| "failed to write settings".to_string())?;
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup).map_err(|_| "failed to back up settings".to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::rename(&backup, path);
        return Err(format!("failed to commit settings: {error}"));
    }
    Ok(())
}

#[tauri::command]
async fn get_snapshots(state: State<'_, AppState>) -> Result<Vec<ProviderSnapshot>, String> {
    const CACHE_TTL: Duration = Duration::from_secs(30);
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                return Ok(values.clone());
            }
        }
    }
    let _guard = match state.fetch_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            if let Ok(cache) = state.snapshot_cache.lock() {
                if let Some((_, values)) = &*cache {
                    return Ok(values.clone());
                }
            }
            return Ok(vec![ProviderSnapshot::failure(
                "unavailable",
                "Quota refresh is already running.",
            )]);
        }
    };
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                return Ok(values.clone());
            }
        }
    }
    let values = vec![codex::fetch_snapshot(&state.client).await];
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    Ok(values)
}

#[tauri::command]
async fn refresh_snapshots(state: State<'_, AppState>) -> Result<Vec<ProviderSnapshot>, String> {
    Ok(fetch_snapshots_uncached(&state).await)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<WidgetPreferences, String> {
    state
        .preferences
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "settings unavailable".into())
}

#[tauri::command]
fn set_preferences(
    preferences: WidgetPreferences,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let preferences = preferences.normalized();
    persist_preferences(&state.preferences_path, &preferences)?;
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = preferences;
    Ok(())
}

fn apply_lock(app: &AppHandle, locked: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    window
        .set_ignore_cursor_events(locked)
        .map_err(|_| "failed to toggle click-through".to_string())
}

#[tauri::command]
fn set_widget_locked(
    locked: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let previous = state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let mut next = previous.clone();
    next.locked = locked;
    persist_preferences(&state.preferences_path, &next)?;
    if let Err(error) = apply_lock(&app, locked) {
        let _ = persist_preferences(&state.preferences_path, &previous);
        return Err(error);
    }
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = next.clone();
    Ok(next)
}

#[tauri::command]
fn set_widget_always_on_top(
    always_on_top: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let previous = state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let mut next = previous.clone();
    next.always_on_top = always_on_top;
    persist_preferences(&state.preferences_path, &next)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    if let Err(error) = window.set_always_on_top(always_on_top) {
        let _ = persist_preferences(&state.preferences_path, &previous);
        return Err(format!("failed to toggle always-on-top: {error}"));
    }
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = next.clone();
    let _ = app.emit_to("main", "preferences-changed", next.clone());
    Ok(next)
}

trait CollapsedWindowOps {
    fn unminimize(&self) -> Result<(), String>;
    fn unmaximize(&self) -> Result<(), String>;
    fn set_resizable(&self, value: bool) -> Result<(), String>;
    fn clear_max_size(&self) -> Result<(), String>;
    fn set_pet_min_size(&self) -> Result<(), String>;
    fn set_pet_max_size(&self) -> Result<(), String>;
    fn set_pet_size(&self) -> Result<(), String>;
    fn emit_collapsed(&self) -> Result<(), String>;
    fn show(&self) -> Result<(), String>;
    fn focus(&self) -> Result<(), String>;
    fn set_always_on_top(&self, value: bool) -> Result<(), String>;
    fn set_skip_taskbar(&self, value: bool) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
struct ActivationError {
    step: &'static str,
    message: String,
}

fn activation_error(step: &'static str, message: String) -> ActivationError {
    ActivationError { step, message }
}

fn log_best_effort(step: &'static str, result: Result<(), String>) {
    if let Err(message) = result {
        eprintln!("collapsed activation recovery failed at {step}: {message}");
    }
}

fn recover_findable_window(ops: &dyn CollapsedWindowOps) {
    log_best_effort("always_on_top(false)", ops.set_always_on_top(false));
    log_best_effort("skip_taskbar(false)", ops.set_skip_taskbar(false));
    log_best_effort("resizable(true)", ops.set_resizable(true));
    log_best_effort("clear_max_size", ops.clear_max_size());
}

fn best_effort_emit_show_focus(ops: &dyn CollapsedWindowOps) {
    log_best_effort("emit_collapsed", ops.emit_collapsed());
    best_effort_show_focus(ops);
}

fn best_effort_show_focus(ops: &dyn CollapsedWindowOps) {
    log_best_effort("show", ops.show());
    log_best_effort("focus", ops.focus());
}

fn fail_before_emit(ops: &dyn CollapsedWindowOps, error: ActivationError) -> ActivationError {
    recover_findable_window(ops);
    best_effort_emit_show_focus(ops);
    error
}

fn fail_after_emit(ops: &dyn CollapsedWindowOps, error: ActivationError) -> ActivationError {
    recover_findable_window(ops);
    best_effort_show_focus(ops);
    error
}

fn fail_after_pet_flags(ops: &dyn CollapsedWindowOps, error: ActivationError) -> ActivationError {
    recover_findable_window(ops);
    error
}

fn activate_collapsed_with(ops: &dyn CollapsedWindowOps) -> Result<(), ActivationError> {
    macro_rules! geometry_step {
        ($step:literal, $operation:expr) => {
            if let Err(message) = $operation {
                return Err(fail_before_emit(ops, activation_error($step, message)));
            }
        };
    }

    geometry_step!("unmaximize", ops.unmaximize());
    geometry_step!("set_resizable(initial)", ops.set_resizable(true));
    geometry_step!("clear_max_size", ops.clear_max_size());
    geometry_step!("set_min_size", ops.set_pet_min_size());
    geometry_step!("set_max_size", ops.set_pet_max_size());
    geometry_step!("set_size", ops.set_pet_size());
    geometry_step!("set_resizable(final)", ops.set_resizable(false));

    if let Err(message) = ops.emit_collapsed() {
        return Err(fail_after_emit(ops, activation_error("emit_collapsed", message)));
    }
    if let Err(message) = ops.show() {
        return Err(fail_after_emit(ops, activation_error("show", message)));
    }
    if let Err(message) = ops.focus() {
        return Err(fail_after_emit(ops, activation_error("focus", message)));
    }
    if let Err(message) = ops.set_always_on_top(true) {
        return Err(fail_after_pet_flags(ops, activation_error("always_on_top(true)", message)));
    }
    if let Err(message) = ops.set_skip_taskbar(true) {
        return Err(fail_after_pet_flags(ops, activation_error("skip_taskbar(true)", message)));
    }
    Ok(())
}

struct TauriCollapsedWindowOps<'a, R: tauri::Runtime> {
    window: &'a tauri::WebviewWindow<R>,
}

impl<R: tauri::Runtime> CollapsedWindowOps for TauriCollapsedWindowOps<'_, R> {
    fn unminimize(&self) -> Result<(), String> {
        self.window.unminimize().map_err(|error| error.to_string())
    }
    fn unmaximize(&self) -> Result<(), String> {
        self.window.unmaximize().map_err(|error| error.to_string())
    }

    fn set_resizable(&self, value: bool) -> Result<(), String> {
        self.window.set_resizable(value).map_err(|error| error.to_string())
    }

    fn clear_max_size(&self) -> Result<(), String> {
        self.window
            .set_max_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|error| error.to_string())
    }

    fn set_pet_min_size(&self) -> Result<(), String> {
        self.window
            .set_min_size(Some(tauri::LogicalSize::new(160.0, 150.0)))
            .map_err(|error| error.to_string())
    }

    fn set_pet_max_size(&self) -> Result<(), String> {
        self.window
            .set_max_size(Some(tauri::LogicalSize::new(160.0, 150.0)))
            .map_err(|error| error.to_string())
    }

    fn set_pet_size(&self) -> Result<(), String> {
        self.window
            .set_size(tauri::LogicalSize::new(160.0, 150.0))
            .map_err(|error| error.to_string())
    }

    fn emit_collapsed(&self) -> Result<(), String> {
        self.window
            .emit("activate-collapsed", ())
            .map_err(|error| error.to_string())
    }

    fn show(&self) -> Result<(), String> {
        self.window.show().map_err(|error| error.to_string())
    }

    fn focus(&self) -> Result<(), String> {
        self.window.set_focus().map_err(|error| error.to_string())
    }

    fn set_always_on_top(&self, value: bool) -> Result<(), String> {
        self.window
            .set_always_on_top(value)
            .map_err(|error| error.to_string())
    }

    fn set_skip_taskbar(&self, value: bool) -> Result<(), String> {
        self.window
            .set_skip_taskbar(value)
            .map_err(|error| error.to_string())
    }
}

fn activate_main_window_with(identifier: &str, ops: &dyn CollapsedWindowOps) -> Result<(), ActivationError> {
    if identifier == "com.companiondesk.hpc-experiment" {
        ops.unminimize().map_err(|message| activation_error("unminimize", message))?;
        ops.show().map_err(|message| activation_error("show", message))?;
        ops.focus().map_err(|message| activation_error("focus", message))?;
        Ok(())
    } else {
        activate_collapsed_with(ops)
    }
}

fn activate_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("failed to activate main window at lookup: main window missing");
        return;
    };
    let ops = TauriCollapsedWindowOps { window: &window };
    if let Err(error) = activate_main_window_with(&app.config().identifier, &ops) {
        eprintln!(
            "failed to activate main window at {}: {}",
            error.step, error.message
        );
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let unlock = MenuItem::with_id(app, "unlock", "Unlock widget", true, None::<&str>)?;
    let pin = MenuItem::with_id(app, "pin", "Pin / Unpin Codex", true, None::<&str>)?;
    let language = MenuItem::with_id(
        app,
        "language",
        "Switch Language / 切换语言",
        true,
        None::<&str>,
    )?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start at login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &refresh, &unlock, &pin, &language, &autostart, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Companion Desk");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let autostart_menu = autostart.clone();
    builder
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        activate_main_window(app);
                    }
                }
            }
            "refresh" => {
                let _ = app.emit_to("main", "refresh-requested", "tray");
            }
            "unlock" => {
                let _ = apply_lock(app, false);
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.locked = false;
                        let _ = persist_preferences(&state.preferences_path, &prefs);
                        let _ = app.emit_to("main", "preferences-changed", prefs.clone());
                    }
                }
            }
            "pin" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.pinned_provider = if prefs.pinned_provider.is_some() {
                            None
                        } else {
                            Some("codex".into())
                        };
                        let _ = persist_preferences(&state.preferences_path, &prefs);
                        let _ = app.emit_to("main", "preferences-changed", prefs.clone());
                    }
                }
            }
            "language" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.language = if prefs.language == "en" {
                            "zh-CN".into()
                        } else {
                            "en".into()
                        };
                        let normalized = prefs.clone().normalized();
                        *prefs = normalized.clone();
                        let _ = persist_preferences(&state.preferences_path, &normalized);
                        let _ = app.emit_to("main", "preferences-changed", normalized);
                    }
                }
            }
            "autostart" => {
                let manager = app.autolaunch();
                let enabled = manager.is_enabled().unwrap_or(false);
                let result = if enabled {
                    manager.disable()
                } else {
                    manager.enable()
                };
                match result {
                    Ok(()) => {
                        let _ = autostart_menu.set_checked(!enabled);
                    }
                    Err(_) => eprintln!("autostart update failed"),
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn window_state_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    WindowStateBuilder::default()
        .with_filename(WINDOW_STATE_FILENAME)
        .with_state_flags(WINDOW_STATE_FLAGS)
        .build()
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(ssh::TerminalState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            activate_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(window_state_plugin())
        .setup(|app| {
            let data_dir = app.path().app_config_dir()?;
            let preferences_path = data_dir.join("preferences.json");
            let preferences = load_preferences(&preferences_path);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(HTTP_USER_AGENT)
                .build()
                .expect("static HTTP client configuration must be valid");
            app.manage(AppState {
                client,
                preferences: Mutex::new(preferences.clone()),
                preferences_path,
                fetch_lock: tokio::sync::Mutex::new(()),
                snapshot_cache: Mutex::new(None),
            });
            if setup_tray(app).is_err() {
                eprintln!("tray setup failed; enabling taskbar fallback");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_skip_taskbar(false);
                }
            }
            if preferences.locked {
                let _ = apply_lock(app.handle(), true);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(preferences.always_on_top);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            codex_launcher::open_codex_app,
            get_snapshots,
            refresh_snapshots,
            get_preferences,
            set_preferences,
            set_widget_locked,
            set_widget_always_on_top,
            token_history::get_token_history,
            hpc_query::query_hpc_jobs,
            ssh::start_ssh_terminal,
            ssh::write_ssh_terminal,
            ssh::resize_ssh_terminal,
            ssh::close_ssh_terminal,
            ssh::get_ssh_status,
            ssh::close_all_ssh
        ])
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                activate_main_window(app);
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("activate-collapsed", ());
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Companion Desk");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Resumed) {
            let _ = app_handle.emit_to("main", "refresh-requested", "resume");
        }
    });
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::{activate_collapsed_with, activate_main_window_with, CollapsedWindowOps, WINDOW_STATE_FILENAME, WINDOW_STATE_FLAGS};
    use serde_json::Value;
    use tauri_plugin_window_state::StateFlags;

    #[test]
    fn main_window_capability_allows_runtime_material_transitions() {
        let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("default window capability must remain valid JSON");
        let permissions = capability["permissions"]
            .as_array()
            .expect("default window capability must list permissions");
        let allows = |permission: &str| {
            permissions.iter().any(|value| value.as_str() == Some(permission))
        };

        assert!(allows("core:window:allow-set-effects"));
        assert!(allows("core:window:allow-set-shadow"));
        assert!(allows("core:window:allow-set-always-on-top"));
        assert!(allows("core:window:allow-hide"));
    }

    #[test]
    fn window_state_policy_is_v3_and_position_only() {
        assert_eq!(WINDOW_STATE_FILENAME, ".window-state-v3.json");
        assert_eq!(WINDOW_STATE_FLAGS.bits(), StateFlags::POSITION.bits());
        assert!(!WINDOW_STATE_FLAGS.intersects(StateFlags::SIZE | StateFlags::MAXIMIZED));
    }

    #[test]
    fn http_user_agent_tracks_the_package_version() {
        let source = include_str!("lib.rs");
        assert!(source.contains(
            "const HTTP_USER_AGENT: &str = concat!(\"CompanionDesk/\", env!(\"CARGO_PKG_VERSION\"));"
        ));
        assert!(source.contains(".user_agent(HTTP_USER_AGENT)"));
    }

    #[test]
    fn window_state_builder_applies_the_position_only_policy() {
        let source = include_str!("lib.rs");
        let helper_start = source
            .find("fn window_state_plugin<")
            .expect("window-state plugin construction must stay in its production helper");
        let run_start = source[helper_start..]
            .find("\npub fn run")
            .expect("window-state helper must be defined before run");
        let helper = &source[helper_start..helper_start + run_start];
        let tests_start = source
            .find("\n#[cfg(test)]")
            .expect("window-state wiring test must remain outside production code");
        let run = &source[helper_start + run_start..tests_start];

        assert!(helper.contains(".with_filename(WINDOW_STATE_FILENAME)"));
        assert!(helper.contains(".with_state_flags(WINDOW_STATE_FLAGS)"));
        assert!(run.contains(".plugin(window_state_plugin())"));
    }

    #[test]
    fn dedicated_quit_command_exits_and_is_registered() {
        let source = include_str!("lib.rs");
        assert!(source.contains("fn quit_app(app: AppHandle)"));
        assert!(source.contains("app.exit(0);"));
        assert!(source.contains("tauri::generate_handler![\n            quit_app,"));
    }

    #[test]
    fn quota_refresh_events_use_unambiguous_lifecycle_reasons() {
        let source = include_str!("lib.rs");
        assert!(source.contains("emit_to(\"main\", \"refresh-requested\", \"tray\")"));
        assert!(source.contains("emit_to(\"main\", \"refresh-requested\", \"resume\")"));
        assert!(!source.contains("emit_to(\"main\", \"refresh-requested\", ())"));
    }

    #[test]
    fn activation_paths_use_the_shared_config_dispatch() {
        let source = include_str!("lib.rs");
        let production = source
            .split("\n#[cfg(test)]")
            .next()
            .expect("production source must precede unit tests");
        assert!(production.contains("trait CollapsedWindowOps"));
        assert!(production.contains("fn activate_collapsed_with"));
        assert!(production.contains("activate_main_window_with(&app.config().identifier, &ops)"));
        assert_eq!(production.matches("activate_main_window(app)").count(), 3);
    }

    struct FakeOps {
        calls: RefCell<Vec<&'static str>>,
        failure: Option<&'static str>,
    }

    impl FakeOps {
        fn new(failure: Option<&'static str>) -> Self {
            Self { calls: RefCell::new(Vec::new()), failure }
        }

        fn call(&self, step: &'static str) -> Result<(), String> {
            self.calls.borrow_mut().push(step);
            if self.failure == Some(step) {
                Err(format!("{step} failed"))
            } else {
                Ok(())
            }
        }

        fn calls(&self) -> Vec<&'static str> {
            self.calls.borrow().clone()
        }
    }

    impl CollapsedWindowOps for FakeOps {
        fn unminimize(&self) -> Result<(), String> { self.call("unminimize") }
        fn unmaximize(&self) -> Result<(), String> { self.call("unmaximize") }
        fn set_resizable(&self, value: bool) -> Result<(), String> {
            self.call(if value { "resizable:true" } else { "resizable:false" })
        }
        fn clear_max_size(&self) -> Result<(), String> { self.call("clear-max") }
        fn set_pet_min_size(&self) -> Result<(), String> { self.call("set-min") }
        fn set_pet_max_size(&self) -> Result<(), String> { self.call("set-max") }
        fn set_pet_size(&self) -> Result<(), String> { self.call("set-size") }
        fn emit_collapsed(&self) -> Result<(), String> { self.call("emit") }
        fn show(&self) -> Result<(), String> { self.call("show") }
        fn focus(&self) -> Result<(), String> { self.call("focus") }
        fn set_always_on_top(&self, value: bool) -> Result<(), String> {
            self.call(if value { "topmost:true" } else { "topmost:false" })
        }
        fn set_skip_taskbar(&self, value: bool) -> Result<(), String> {
            self.call(if value { "taskbar:true" } else { "taskbar:false" })
        }
    }

    #[test]
    fn hpc_experiment_activation_preserves_geometry_and_resizability() {
        let ops = FakeOps::new(None);
        assert_eq!(activate_main_window_with("com.companiondesk.hpc-experiment", &ops), Ok(()));
        assert_eq!(ops.calls(), vec!["unminimize", "show", "focus"]);
    }

    #[test]
    fn production_activation_dispatch_retains_collapsed_behavior() {
        let expected = FakeOps::new(None);
        let dispatched = FakeOps::new(None);
        assert_eq!(activate_collapsed_with(&expected), Ok(()));
        assert_eq!(activate_main_window_with("com.kunkun.desk", &dispatched), Ok(()));
        assert_eq!(dispatched.calls(), expected.calls());
    }

    #[test]
    fn hpc_experiment_failed_show_keeps_geometry_untouched() {
        let ops = FakeOps::new(Some("show"));
        let error = activate_main_window_with("com.companiondesk.hpc-experiment", &ops).unwrap_err();
        assert_eq!(error.step, "show");
        assert_eq!(ops.calls(), vec!["unminimize", "show"]);
    }

    #[test]
    fn collapsed_activation_applies_geometry_then_signals_before_pet_flags() {
        let ops = FakeOps::new(None);

        assert_eq!(activate_collapsed_with(&ops), Ok(()));
        assert_eq!(ops.calls(), vec![
            "unmaximize", "resizable:true", "clear-max", "set-min", "set-max", "set-size",
            "resizable:false", "emit", "show", "focus", "topmost:true", "taskbar:true",
        ]);
    }

    #[test]
    fn every_geometry_failure_recovers_a_findable_window_then_signals() {
        let cases = [
            ("unmaximize", "unmaximize"),
            ("resizable:true", "set_resizable(initial)"),
            ("clear-max", "clear_max_size"),
            ("set-min", "set_min_size"),
            ("set-max", "set_max_size"),
            ("set-size", "set_size"),
            ("resizable:false", "set_resizable(final)"),
        ];
        let recovery_and_signal = [
            "topmost:false", "taskbar:false", "resizable:true", "clear-max", "emit", "show", "focus",
        ];

        for (failure, step) in cases {
            let ops = FakeOps::new(Some(failure));
            let error = activate_collapsed_with(&ops).expect_err("geometry failure must be reported");

            assert_eq!(error.step, step);
            assert!(ops.calls().ends_with(&recovery_and_signal));
        }
    }

    #[test]
    fn pet_flag_failure_recovers_a_findable_window_without_hiding_the_window() {
        let ops = FakeOps::new(Some("taskbar:true"));
        let error = activate_collapsed_with(&ops).expect_err("pet flag failure must be reported");

        assert_eq!(error.step, "skip_taskbar(true)");
        assert!(ops.calls().ends_with(&[
            "topmost:false", "taskbar:false", "resizable:true", "clear-max",
        ]));
        assert!(ops.calls().contains(&"show"));
        assert!(ops.calls().contains(&"focus"));
    }

    #[test]
    fn close_request_emits_collapsed_activation_before_hiding() {
        let source = include_str!("lib.rs");
        let close_start = source
            .find("if let WindowEvent::CloseRequested { api, .. } = event {")
            .expect("close requests must remain intercepted");
        let close = &source[close_start..];
        let prevent_close = close.find("api.prevent_close();").expect("close must be prevented");
        let emit = close.find("window.emit(\"activate-collapsed\", ())").expect("close must notify the frontend");
        let hide = close.find("window.hide()").expect("close must hide the window");

        assert!(prevent_close < emit && emit < hide);
    }

    #[test]
    fn initial_window_is_the_standard_collapsed_pet_geometry() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri configuration must remain valid JSON");
        let window = &config["app"]["windows"][0];

        assert_eq!(window["width"], 160);
        assert_eq!(window["height"], 150);
        assert_eq!(window["minWidth"], 160);
        assert_eq!(window["minHeight"], 150);
        assert_eq!(config["identifier"], "com.kunkun.desk");
    }
}
