//! Conservative, allowlisted filesystem cache cleanup.
//!
//! No taskkill, takeown, icacls, Windows diagnostic log removal, browser
//! extension storage removal or Service Worker database removal.
//! Cache directories are emptied without deleting the directory itself.

use std::{
    env,
    fs::{self, Metadata},
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Default)]
struct Stats {
    files: u64,
    bytes: u64,
    skipped: u64,
}

pub(crate) fn is_cleanup_task(id: &str) -> bool {
    matches!(
        id,
        "temp-user"
            | "temp-windows"
            | "thumbcache-user"
            | "browser-edge"
            | "browser-firefox"
            | "browser-vivaldi"
            | "browser-brave"
            | "browser-chrome"
    )
}

fn is_reparse(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn ensure_regular_directory(path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("{}: {}", path.display(), error)),
    };
    if is_reparse(&metadata) || !metadata.is_dir() {
        return Err(format!("Unsafe or non-directory path was skipped: {}", path.display()));
    }
    Ok(true)
}

fn validate_ancestors(base: &Path, root: &Path) -> Result<bool, String> {
    if !root.starts_with(base) {
        return Err("Cleanup path is outside of its trusted base directory.".into());
    }
    if !ensure_regular_directory(base)? {
        return Ok(false);
    }
    let mut path = base.to_path_buf();
    let relative = root.strip_prefix(base).map_err(|e| e.to_string())?;
    for component in relative.components() {
        path.push(component);
        if !ensure_regular_directory(&path)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn delete_entry(path: &Path, stats: &mut Stats, depth: usize) {
    // Bound recursion even if a malformed cache contains an unusual tree.
    if depth > 32 {
        stats.skipped += 1;
        return;
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            stats.skipped += 1;
            return;
        }
    };
    if is_reparse(&metadata) {
        stats.skipped += 1;
        return;
    }
    if metadata.is_dir() {
        match fs::read_dir(path) {
            Ok(children) => {
                for child in children {
                    match child {
                        Ok(child) => delete_entry(&child.path(), stats, depth + 1),
                        Err(_) => stats.skipped += 1,
                    }
                }
                // Only empty directories are removed. Never remove a root.
                if fs::remove_dir(path).is_err() {
                    stats.skipped += 1;
                }
            }
            Err(_) => stats.skipped += 1,
        }
    } else if metadata.is_file() {
        if fs::remove_file(path).is_ok() {
            stats.files += 1;
            stats.bytes += metadata.len();
        } else {
            stats.skipped += 1;
        }
    } else {
        stats.skipped += 1;
    }
}

fn cleanup_root(base: &Path, root: &Path, stats: &mut Stats) -> Result<(), String> {
    if !validate_ancestors(base, root)? {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        match entry {
            Ok(entry) => {
                // Original Windows thumbnail cleanup only selected .tmp files.
                if root.file_name().and_then(|name| name.to_str()) == Some("ThumbCacheToDelete")
                    && entry.path().extension().and_then(|ext| ext.to_str()) != Some("tmp")
                {
                    continue;
                }
                delete_entry(&entry.path(), stats, 0)
            }
            Err(_) => stats.skipped += 1,
        }
    }
    Ok(())
}

fn profiles(base: &Path) -> Result<Vec<PathBuf>, String> {
    if !ensure_regular_directory(base)? {
        return Ok(Vec::new());
    }
    let mut roots = Vec::new();
    for entry in fs::read_dir(base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "Default" || name.starts_with("Profile ") {
            let path = entry.path();
            if ensure_regular_directory(&path)? {
                roots.push(path);
            }
        }
    }
    Ok(roots)
}

fn browser_paths(id: &str, local: &Path) -> Result<(PathBuf, Vec<PathBuf>), String> {
    if id == "browser-firefox" {
        let base = local.join("Mozilla").join("Firefox").join("Profiles");
        let mut roots = Vec::new();
        if validate_ancestors(local, &base)? {
            for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if ensure_regular_directory(&path)? {
                    roots.push(path.join("cache2"));
                    roots.push(path.join("startupCache"));
                }
            }
        }
        return Ok((base, roots));
    }
    let vendor = match id {
        "browser-edge" => ["Microsoft", "Edge", "User Data"],
        "browser-chrome" => ["Google", "Chrome", "User Data"],
        "browser-brave" => ["BraveSoftware", "Brave-Browser", "User Data"],
        "browser-vivaldi" => ["Vivaldi", "User Data", ""],
        _ => return Err("Unknown browser".into()),
    };
    let mut base = local.to_path_buf();
    for part in vendor {
        if !part.is_empty() {
            base.push(part);
        }
    }
    if !validate_ancestors(local, &base)? {
        return Ok((base, Vec::new()));
    }
    let mut roots = vec![
        base.join("GrShaderCache"),
        base.join("ShaderCache"),
    ];
    for profile in profiles(&base)? {
        for subpath in ["Cache", "Network\\Cache", "Code Cache", "GPUCache", "DawnCache"] {
            let mut root = profile.clone();
            for part in subpath.split('\\') {
                root.push(part);
            }
            roots.push(root);
        }
    }
    Ok((base, roots))
}

fn browser_process(id: &str) -> Option<&'static str> {
    match id {
        "browser-edge" => Some("msedge"),
        "browser-chrome" => Some("chrome"),
        "browser-brave" => Some("brave"),
        "browser-vivaldi" => Some("vivaldi"),
        "browser-firefox" => Some("firefox"),
        _ => None,
    }
}

fn browser_running(name: &str) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Names are hardcoded; not supplied by the UI or the filesystem.
        let script = format!(
            "if (Get-Process -Name '{}' -ErrorAction SilentlyContinue) {{ exit 3 }} else {{ exit 0 }}",
            name
        );
        let exe = PathBuf::from(
            env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
        )
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
        let status = Command::new(exe)
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .status()
            .map_err(|e| e.to_string())?;
        match status.code() {
            Some(0) => Ok(false),
            Some(3) => Ok(true),
            other => Err(format!("Unable to determine browser status: {other:?}")),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Err("Cache cleanup is only available on Windows".into())
    }
}

pub(crate) fn run(
    id: &str,
    mut log: impl FnMut(&str),
    mut progress: impl FnMut(u8),
) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Cache cleanup only runs on Windows".into());
    }
    if !is_cleanup_task(id) {
        return Err("Unrecognized cleanup operation".into());
    }
    if let Some(process) = browser_process(id) {
        if browser_running(process)? {
            return Err(format!(
                "Close {process} completely before clearing its cache. No browser was terminated."
            ));
        }
    }
    let local = PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?);
    let system_root = PathBuf::from(env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()));
    let (base, roots) = match id {
        "temp-user" => (local.clone(), vec![local.join("Temp")]),
        "temp-windows" => (system_root.clone(), vec![system_root.join("Temp")]),
        "thumbcache-user" => (
            local.clone(),
            vec![local.join("Microsoft").join("Windows").join("Explorer").join("ThumbCacheToDelete")],
        ),
        _ => browser_paths(id, &local)?,
    };
    log("Scanning explicitly allowed cache folders; in-use files and links are preserved.");
    let mut stats = Stats::default();
    let total = roots.len().max(1);
    for (index, root) in roots.iter().enumerate() {
        match cleanup_root(&base, root, &mut stats) {
            Ok(()) => {},
            Err(error) => {
                stats.skipped += 1;
                log(&format!("Skipped {}: {error}", root.display()));
            }
        }
        progress((((index + 1) * 100) / total) as u8);
    }
    if roots.is_empty() {
        progress(100);
    }
    log(&format!(
        "Cleanup complete: {} files, {:.1} MiB recovered (approx.), {} skipped/locked entries.",
        stats.files,
        stats.bytes as f64 / (1024.0 * 1024.0),
        stats.skipped
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explicit_cleanup_jobs_are_allowed() {
        assert!(is_cleanup_task("temp-user"));
        assert!(is_cleanup_task("browser-firefox"));
        assert!(!is_cleanup_task("browser-unknown"));
        assert!(!is_cleanup_task("delete-system32"));
    }

    #[test]
    fn outside_paths_are_rejected_before_any_filesystem_access() {
        assert!(validate_ancestors(Path::new("allowed"), Path::new("elsewhere")).is_err());
    }
}
