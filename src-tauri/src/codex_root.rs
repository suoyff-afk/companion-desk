use std::{ffi::OsString, path::PathBuf};

pub(crate) fn resolve_codex_root(
    codex_home: Option<OsString>,
    user_home: Option<PathBuf>,
) -> Result<PathBuf, &'static str> {
    codex_home
        .map(PathBuf::from)
        .or_else(|| user_home.map(|home| home.join(".codex")))
        .ok_or("Codex home directory is unavailable.")
}

pub(crate) fn codex_root() -> Result<PathBuf, &'static str> {
    resolve_codex_root(std::env::var_os("CODEX_HOME"), dirs::home_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsString, path::PathBuf};

    #[test]
    fn prefers_codex_home_over_user_home() {
        let root = resolve_codex_root(
            Some(OsString::from("E:\\\\portable-codex")),
            Some(PathBuf::from("C:\\\\Users\\\\Kunkun")),
        )
        .unwrap();

        assert_eq!(root, PathBuf::from("E:\\\\portable-codex"));
    }

    #[test]
    fn falls_back_to_dot_codex_under_user_home() {
        let root = resolve_codex_root(None, Some(PathBuf::from("C:\\\\Users\\\\Kunkun"))).unwrap();

        assert_eq!(root, PathBuf::from("C:\\\\Users\\\\Kunkun").join(".codex"));
    }
}
