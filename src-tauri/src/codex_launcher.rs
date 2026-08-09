use std::process::Command;

const CODEX_PAGE: &str = "https://openai.com/codex/";
const DISCOVERY_SCRIPT: &str = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$pkg = Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -First 1
if ($null -ne $pkg) {
  $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
  $app = $manifest.Package.Applications.Application | Select-Object -First 1
  if ($null -ne $app) { Write-Output ($pkg.PackageFamilyName + '!' + $app.Id) }
}
"#;

#[cfg(target_os = "windows")]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(target_os = "windows"))]
fn hide_console(_command: &mut Command) {}

fn valid_app_user_model_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.contains('!')
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'!')
        })
}

fn discover_codex_app_id() -> Option<String> {
    let mut command = Command::new("powershell.exe");
    hide_console(&mut command);
    let output = command
        .args(["-NoProfile", "-NonInteractive", "-Command", DISCOVERY_SCRIPT])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    valid_app_user_model_id(&value).then_some(value)
}

fn open_with_windows_shell(target: &str) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open Codex: {error}"))
}

#[tauri::command]
pub fn open_codex_app() -> Result<(), String> {
    match discover_codex_app_id() {
        Some(app_id) => open_with_windows_shell(&format!("shell:AppsFolder\\{app_id}")),
        None => open_with_windows_shell(CODEX_PAGE),
    }
}

#[cfg(test)]
mod tests {
    use super::{valid_app_user_model_id, CODEX_PAGE, DISCOVERY_SCRIPT};

    #[test]
    fn accepts_only_an_inert_windows_app_id() {
        assert!(valid_app_user_model_id("OpenAI.Codex_2p2nqsd0c76g0!App"));
        assert!(!valid_app_user_model_id("OpenAI.Codex!App & calc.exe"));
        assert!(!valid_app_user_model_id("https://example.com"));
    }

    #[test]
    fn discovery_is_limited_to_official_openai_packages() {
        assert!(DISCOVERY_SCRIPT.contains("Get-AppxPackage -Name 'OpenAI.Codex'"));
        assert!(!DISCOVERY_SCRIPT.contains("'OpenAI.ChatGPT'"));
        assert_eq!(CODEX_PAGE, "https://openai.com/codex/");
    }
}
