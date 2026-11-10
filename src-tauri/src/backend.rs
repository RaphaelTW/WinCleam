use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
};
use sysinfo::System;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

const EVENT: &str = "wincleam:event";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
struct Runner {
    running: AtomicBool,
    stop_after_current: AtomicBool,
}

#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    rammap_path: Option<String>,
    lasso_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    is_admin: bool,
    is_windows: bool,
    version: String,
    preferences: Preferences,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    cpu_percent: f32,
    memory_total: u64,
    memory_used: u64,
    cpu_count: usize,
    os_name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DriveInfo {
    letter: String,
    label: String,
    size: u64,
    free: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    ids: Vec<String>,
    disk_target: String,
    repair_acknowledged: bool,
    locale: String,
}

struct Step {
    executable: PathBuf,
    args: Vec<String>,
    answer_prompt: bool,
}

fn emit(app: &AppHandle, value: Value) {
    let _ = app.emit(EVENT, value);
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("preferences.json"))
}

fn read_preferences(app: &AppHandle) -> Preferences {
    preferences_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Preferences>(&text).ok())
        .unwrap_or_default()
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("wincleam-{}.log", Local::now().format("%Y-%m-%d"))))
}

fn write_log(app: &AppHandle, id: &str, message: &str) {
    let line = message
        .trim()
        .chars()
        .filter(|c| *c == '\t' || !c.is_control())
        .take(1500)
        .collect::<String>();
    if line.is_empty() {
        return;
    }
    if let Ok(file) = log_path(app) {
        if let Ok(mut out) = OpenOptions::new().create(true).append(true).open(file) {
            let _ = writeln!(
                out,
                "[{}] [{}] {}",
                Local::now().to_rfc3339(),
                id,
                line
            );
        }
    }
    emit(app, json!({"kind": "log", "taskId": id, "message": line}));
    static PERCENT: OnceLock<Regex> = OnceLock::new();
    let regex = PERCENT.get_or_init(|| Regex::new(r"(\d{1,3})(?:[.,]\d+)?\s*%").unwrap());
    if let Some(capture) = regex.captures(&line) {
        if let Ok(percent) = capture[1].parse::<u8>() {
            if percent <= 100 {
                emit(
                    app,
                    json!({"kind": "progress", "taskId": id, "percent": percent}),
                );
            }
        }
    }
}

fn sys_exe(name: &str) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32")
            .join(name)
    }
    #[cfg(not(windows))]
    {
        PathBuf::from(name)
    }
}

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = (command, CREATE_NO_WINDOW);
    }
}

fn ps_command(script: &str) -> Command {
    let mut command = Command::new(sys_exe("WindowsPowerShell\\v1.0\\powershell.exe"));
    // EncodedCommand avoids shell quoting bugs with whitespace and Unicode paths.
    let utf16_bytes: Vec<u8> = script
        .encode_utf16()
        .flat_map(|ch| ch.to_le_bytes())
        .collect();
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16_bytes);
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded]);
    hidden(&mut command);
    command
}

fn ps_quote(input: &str) -> String {
    format!("'{}'", input.replace('\'', "''"))
}

fn build_ps_step(step: &Step) -> String {
    let mut words = vec![ps_quote(&step.executable.to_string_lossy())];
    words.extend(step.args.iter().map(|arg| ps_quote(arg)));
    format!(
        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); \
         $OutputEncoding = [Console]::OutputEncoding; & {}; exit $LASTEXITCODE",
        words.join(" ")
    )
}

fn is_admin() -> bool {
    #[cfg(windows)]
    {
        let script = "[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
        ps_command(script)
            .output()
            .map(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).trim().eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn accepted_tool_name(tool: &str, path: &Path) -> bool {
    let name = path
        .to_string_lossy()
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match tool {
        "rammap" => matches!(name.as_str(), "rammap.exe" | "rammap64.exe" | "rammap64a.exe"),
        "lasso" => matches!(name.as_str(), "processlasso.exe" | "processlasso64.exe"),
        _ => false,
    }
}

#[tauri::command]
fn bootstrap(app: AppHandle) -> Bootstrap {
    Bootstrap {
        is_admin: is_admin(),
        is_windows: cfg!(windows),
        version: app.package_info().version.to_string(),
        preferences: read_preferences(&app),
    }
}

#[tauri::command]
fn system_snapshot(system: State<'_, Mutex<System>>) -> Result<Snapshot, String> {
    let mut sys = system.lock().map_err(|_| "System monitor unavailable".to_string())?;
    sys.refresh_memory();
    sys.refresh_cpu();
    Ok(Snapshot {
        cpu_percent: sys.global_cpu_info().cpu_usage().clamp(0.0, 100.0),
        memory_total: sys.total_memory(),
        memory_used: sys.used_memory(),
        cpu_count: sys.cpus().len(),
        os_name: if cfg!(windows) {
            "Windows".to_string()
        } else {
            "Preview".to_string()
        },
    })
}

fn discover_drives() -> Result<Vec<DriveInfo>, String> {
    if !cfg!(windows) {
        return Ok(vec![]);
    }
    let script = "$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); \
      Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | \
      Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress";
    let result = ps_command(script).output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err("Windows did not return the drive list.".into());
    }
    let output = String::from_utf8_lossy(&result.stdout);
    let parsed: Value = serde_json::from_str(output.trim())
        .map_err(|_| "Could not interpret disk information.".to_string())?;
    let items = match parsed {
        Value::Array(items) => items,
        Value::Object(_) => vec![parsed],
        Value::Null => vec![],
        _ => return Err("Unexpected Windows disk response.".into()),
    };
    let mut drives: Vec<DriveInfo> = items
        .iter()
        .filter_map(|item| {
            let letter = item.get("DeviceID")?.as_str()?.to_ascii_uppercase();
            if !valid_letter(&letter) {
                return None;
            }
            Some(DriveInfo {
                letter,
                label: item
                    .get("VolumeName")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                size: item.get("Size").and_then(Value::as_u64).unwrap_or(0),
                free: item.get("FreeSpace").and_then(Value::as_u64).unwrap_or(0),
            })
        })
        .collect();
    drives.sort_by(|a, b| a.letter.cmp(&b.letter));
    drives.dedup_by(|a, b| a.letter == b.letter);
    Ok(drives)
}

fn valid_letter(letter: &str) -> bool {
    let chars = letter.as_bytes();
    chars.len() == 2 && chars[0].is_ascii_uppercase() && chars[1] == b':'
}

#[tauri::command]
fn list_drives() -> Result<Vec<DriveInfo>, String> {
    discover_drives()
}

#[tauri::command]
async fn choose_external_tool(app: AppHandle, tool: String) -> Result<Option<String>, String> {
    if !matches!(tool.as_str(), "rammap" | "lasso") {
        return Err("Unknown external tool".into());
    }
    let selected = app
        .dialog()
        .file()
        .add_filter("Windows executable", &["exe"])
        .set_title(if tool == "rammap" { "RAMMap" } else { "Process Lasso" })
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    if !path.is_file() || !accepted_tool_name(&tool, &path) {
        return Err("Select the original executable of the chosen tool.".into());
    }
    let mut prefs = read_preferences(&app);
    let stored = path.to_string_lossy().to_string();
    if tool == "rammap" {
        prefs.rammap_path = Some(stored.clone());
    } else {
        prefs.lasso_path = Some(stored.clone());
    }
    let data = serde_json::to_vec_pretty(&prefs).map_err(|e| e.to_string())?;
    fs::write(preferences_path(&app)?, data).map_err(|e| e.to_string())?;
    Ok(Some(stored))
}

fn configured_tool(app: &AppHandle, tool: &str) -> Result<PathBuf, String> {
    let prefs = read_preferences(app);
    let path = match tool {
        "rammap" => prefs.rammap_path,
        "lasso" => prefs.lasso_path,
        _ => None,
    }
    .ok_or_else(|| "Tool not configured.".to_string())?;
    let candidate = PathBuf::from(path);
    if !candidate.is_file() || !accepted_tool_name(tool, &candidate) {
        return Err("Selected executable was moved or is invalid.".into());
    }
    Ok(candidate)
}

#[tauri::command]
fn open_external_tool(app: AppHandle, tool: String) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Only available on Windows.".into());
    }
    let path = configured_tool(&app, &tool)?;
    Command::new(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_windows_settings(target: String) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Only available on Windows.".into());
    }
    let uri = match target.as_str() {
        "drivers" => "ms-settings:windowsupdate-optionalupdates",
        "updates" => "ms-settings:windowsupdate",
        _ => return Err("Unsupported Windows settings target.".into()),
    };
    Command::new(sys_exe("explorer.exe"))
        .arg(uri)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_latest_release() -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Only available on Windows.".into());
    }
    // This URL is intentionally fixed; the frontend never supplies a URL to open.
    Command::new(sys_exe("explorer.exe"))
        .arg("https://github.com/RaphaelTW/WinCleam/releases/latest")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn export_log(app: AppHandle) -> Result<bool, String> {
    let source = log_path(&app)?;
    if !source.is_file() {
        return Err("There is no log to export yet.".into());
    }
    let chosen = app
        .dialog()
        .file()
        .set_title("Export WinCleam log")
        .set_file_name("wincleam.log")
        .add_filter("Log", &["log"])
        .blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(false);
    };
    let destination = chosen.into_path().map_err(|e| e.to_string())?;
    fs::copy(source, destination).map_err(|e| e.to_string())?;
    Ok(true)
}

fn known_task(id: &str) -> bool {
    crate::cleanup::is_cleanup_task(id) || matches!(
        id,
        "dism-check"
            | "dism-scan"
            | "dism-restore"
            | "sfc"
            | "components"
            | "cleanmgr-config"
            | "cleanmgr-run"
            | "chkdsk-scan"
            | "chkdsk-f"
            | "defrag"
            | "flushdns"
            | "renewip"
            | "winget-list"
            | "winget-upgrade"
            | "rammap-empty"
    )
}

fn step(program: &str, arguments: &[&str]) -> Step {
    Step {
        executable: sys_exe(program),
        args: arguments.iter().map(|s| s.to_string()).collect(),
        answer_prompt: false,
    }
}

fn winget_executable() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .ok_or("LOCALAPPDATA unavailable: WinGet cannot be located.")?;
    let alias = PathBuf::from(base)
        .join("Microsoft")
        .join("WindowsApps")
        .join("winget.exe");
    if !alias.is_file() {
        return Err("WinGet is unavailable. Install Microsoft App Installer.".into());
    }
    Ok(alias)
}

fn selected_drives(target: &str) -> Result<Vec<String>, String> {
    let drives = discover_drives()?;
    if target == "all" {
        if drives.is_empty() {
            return Err("No fixed drives were found.".into());
        }
        return Ok(drives.into_iter().map(|drive| drive.letter).collect());
    }
    let selected = target.to_ascii_uppercase();
    if !valid_letter(&selected) || !drives.iter().any(|drive| drive.letter == selected) {
        return Err("Selected drive is not a mounted fixed drive.".into());
    }
    Ok(vec![selected])
}

fn build_steps(app: &AppHandle, id: &str, request: &RunRequest) -> Result<Vec<Step>, String> {
    let direct = |program: &str, args: &[&str]| Ok(vec![step(program, args)]);
    match id {
        "dism-check" => direct("Dism.exe", &["/Online", "/Cleanup-Image", "/CheckHealth"]),
        "dism-scan" => direct("Dism.exe", &["/Online", "/Cleanup-Image", "/ScanHealth"]),
        "dism-restore" => direct("Dism.exe", &["/Online", "/Cleanup-Image", "/RestoreHealth"]),
        "sfc" => direct("sfc.exe", &["/scannow"]),
        "components" => direct(
            "Dism.exe",
            &["/Online", "/Cleanup-Image", "/StartComponentCleanup"],
        ),
        "cleanmgr-config" => direct("cleanmgr.exe", &["/sageset:1"]),
        "cleanmgr-run" => direct("cleanmgr.exe", &["/sagerun:1"]),
        "chkdsk-scan" | "chkdsk-f" => {
            if id == "chkdsk-f" && !request.repair_acknowledged {
                return Err("CHKDSK /f requires explicit risk confirmation.".into());
            }
            let args = if id == "chkdsk-f" { "/f" } else { "/scan" };
            Ok(selected_drives(&request.disk_target)?
                .into_iter()
                .map(|letter| Step {
                    executable: sys_exe("chkdsk.exe"),
                    args: vec![letter, args.to_string()],
                    answer_prompt: id == "chkdsk-f",
                })
                .collect())
        }
        "defrag" => direct("defrag.exe", &["/C", "/O"]),
        "flushdns" => direct("ipconfig.exe", &["/flushdns"]),
        "renewip" => Ok(vec![
            step("ipconfig.exe", &["/release"]),
            step("ipconfig.exe", &["/renew"]),
        ]),
        "winget-list" | "winget-upgrade" => {
            let mut args = vec!["upgrade", "--include-unknown", "--accept-source-agreements", "--disable-interactivity"];
            if id == "winget-upgrade" {
                args = vec![
                    "upgrade", "--all", "--include-unknown",
                    "--accept-package-agreements", "--accept-source-agreements",
                    "--disable-interactivity",
                ];
            }
            Ok(vec![Step {
                executable: winget_executable()?,
                args: args.into_iter().map(str::to_string).collect(),
                answer_prompt: false,
            }])
        }
        "rammap-empty" => Ok(vec![Step {
            executable: configured_tool(app, "rammap")?,
            args: vec!["-Et".into()],
            answer_prompt: false,
        }]),
        _ => Err("Unsupported operation.".into()),
    }
}

fn consume_pipe<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    task_id: String,
    pipe: R,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut buffer = Vec::new();
        while let Ok(n) = reader.read_until(b'\n', &mut buffer) {
            if n == 0 {
                break;
            }
            for line in String::from_utf8_lossy(&buffer).split('\r') {
                write_log(&app, &task_id, line);
            }
            buffer.clear();
        }
    })
}

fn command_step(
    app: &AppHandle,
    id: &str,
    spec: &Step,
    locale: &str,
) -> Result<i32, String> {
    let is_rammap = spec
        .executable
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.to_ascii_lowercase().starts_with("rammap"));
    let mut command = if is_rammap {
        let mut direct = Command::new(&spec.executable);
        direct.args(&spec.args);
        hidden(&mut direct);
        direct
    } else {
        ps_command(&build_ps_step(spec))
    };
    command
        .stdin(if spec.answer_prompt { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    write_log(
        app,
        id,
        &format!(
            "> {} {}",
            spec.executable
                .file_name()
                .map(|name| name.to_string_lossy())
                .unwrap_or_default(),
            spec.args.join(" ")
        ),
    );
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    if spec.answer_prompt {
        // The user has explicitly accepted a dismount / reboot schedule. Locale
        // determines the first answer; the remaining lines provide a fallback.
        // Not every locked volume accepts stdin; the exit code remains visible.
        let answers = match locale {
            "pt" | "es" => "S\nY\n",
            "ru" => "Д\nY\n",
            _ => "Y\nS\n",
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(answers.as_bytes());
        }
    }
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(consume_pipe(app.clone(), id.to_string(), stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(consume_pipe(app.clone(), id.to_string(), stderr));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    for thread in readers {
        let _ = thread.join();
    }
    Ok(status.code().unwrap_or(-1))
}

fn sequence(app: AppHandle, runner: Arc<Runner>, request: RunRequest) {
    let mut results = (0usize, 0usize, 0usize);
    let selected: Vec<String> = {
        let mut unique = HashSet::new();
        request
            .ids
            .iter()
            .filter(|id| unique.insert((*id).clone()))
            .cloned()
            .collect()
    };
    emit(&app, json!({"kind": "run-start", "total": selected.len(), "ids": selected}));
    for (index, id) in selected.iter().enumerate() {
        if runner.stop_after_current.load(Ordering::SeqCst) {
            results.2 = selected.len() - index;
            break;
        }
        emit(&app, json!({"kind": "task-start", "taskId": id, "index": index}));
        let outcome = (|| -> Result<(), String> {
            if crate::cleanup::is_cleanup_task(id) {
                emit(&app, json!({"kind": "step", "taskId": id, "step": 1, "total": 1}));
                return crate::cleanup::run(
                    id,
                    |line| write_log(&app, id, line),
                    |percent| emit(
                        &app,
                        json!({"kind": "progress", "taskId": id, "percent": percent}),
                    ),
                );
            }
            let steps = build_steps(&app, id, &request)?;
            let mut first_error = None;
            for (index, spec) in steps.iter().enumerate() {
                emit(
                    &app,
                    json!({"kind": "step", "taskId": id, "step": index + 1, "total": steps.len()}),
                );
                match command_step(&app, id, spec, &request.locale) {
                    Ok(0) => {}
                    Ok(code) => {
                        if first_error.is_none() {
                            first_error = Some(format!("Windows returned exit code {code}."));
                        }
                        // /release and /renew form an atomic pair: always attempt
                        // the renewal, even when the release fails.
                        if id != "renewip" {
                            break;
                        }
                    }
                    Err(error) => {
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                        if id != "renewip" {
                            break;
                        }
                    }
                }
            }
            first_error.map_or(Ok(()), Err)
        })();
        match outcome {
            Ok(()) => {
                results.0 += 1;
                emit(&app, json!({"kind": "task-end", "taskId": id, "ok": true}));
            }
            Err(error) => {
                results.1 += 1;
                write_log(&app, id, &format!("ERROR: {error}"));
                emit(
                    &app,
                    json!({"kind": "task-end", "taskId": id, "ok": false, "error": error}),
                );
            }
        }
    }
    runner.running.store(false, Ordering::SeqCst);
    emit(
        &app,
        json!({
            "kind": "run-end",
            "completed": results.0,
            "failed": results.1,
            "skipped": results.2
        }),
    );
}

#[tauri::command]
fn start_run(
    app: AppHandle,
    runner: State<'_, Arc<Runner>>,
    request: RunRequest,
) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Maintenance operations only run on Windows.".into());
    }
    if !is_admin() {
        return Err("Restart WinCleam as administrator.".into());
    }
    if request.ids.is_empty() || request.ids.len() > 30 || !request.ids.iter().all(|id| known_task(id)) {
        return Err("Invalid operation list.".into());
    }
    if !matches!(request.locale.as_str(), "pt" | "en" | "es" | "ru" | "zh") {
        return Err("Invalid interface locale.".into());
    }
    if request.ids.iter().any(|id| id.starts_with("chkdsk-")) {
        if request.disk_target != "all" && !valid_letter(&request.disk_target.to_ascii_uppercase()) {
            return Err("Invalid drive selection.".into());
        }
    }
    if request.ids.iter().any(|id| id == "chkdsk-f") && !request.repair_acknowledged {
        return Err("CHKDSK /f requires risk confirmation.".into());
    }
    runner
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Another maintenance sequence is already running.".to_string())?;
    runner.stop_after_current.store(false, Ordering::SeqCst);
    let shared = runner.inner().clone();
    thread::spawn(move || sequence(app, shared, request));
    Ok(())
}

#[tauri::command]
fn stop_after_current(runner: State<'_, Arc<Runner>>) -> bool {
    if runner.running.load(Ordering::SeqCst) {
        runner.stop_after_current.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn clear_ram_from_tray(app: &AppHandle) -> Result<(), String> {
    if !is_admin() {
        return Err("Restart WinCleam as administrator.".into());
    }
    let path = configured_tool(app, "rammap")?;
    let mut command = Command::new(path);
    command.arg("-Et");
    hidden(&mut command);
    command.spawn().map_err(|e| e.to_string())?;
    write_log(app, "rammap-empty", "RAMMap -Et started from the system tray.");
    Ok(())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar WinCleam", true, None::<&str>)?;
    let clear_ram = MenuItem::with_id(app, "clear-ram", "Limpar RAM em espera", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &clear_ram, &quit])?;
    let icon = app.default_window_icon().cloned().expect("Missing app icon");
    TrayIconBuilder::with_id("wincleam-tray")
        .icon(icon)
        .tooltip("WinCleam")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "clear-ram" => {
                if clear_ram_from_tray(app).is_err() {
                    show_main_window(app);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let mut system = System::new_all();
    system.refresh_cpu();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Runner::default()))
        .manage(Mutex::new(system))
        .setup(|app| Ok(setup_tray(app)?))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            system_snapshot,
            list_drives,
            choose_external_tool,
            open_external_tool,
            open_windows_settings,
            open_latest_release,
            export_log,
            start_run,
            stop_after_current
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start WinCleam");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_jobs_can_be_executed() {
        assert!(known_task("chkdsk-f"));
        assert!(known_task("winget-upgrade"));
        assert!(!known_task("cmd.exe"));
    }

    #[test]
    fn drive_letters_are_strictly_validated() {
        assert!(valid_letter("C:"));
        assert!(!valid_letter("C:\\"));
        assert!(!valid_letter("C: & del /S"));
        assert!(!valid_letter("all"));
    }

    #[test]
    fn vendors_have_strict_executable_names() {
        assert!(accepted_tool_name("rammap", Path::new("C:\\Tools\\RAMMap64.exe")));
        assert!(!accepted_tool_name("rammap", Path::new("C:\\Windows\\System32\\cmd.exe")));
    }
}
