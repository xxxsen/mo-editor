#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use store::{ExpectedFile, GameStore, SaveEntry, VersionFileInfo, VersionInfo};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager, State,
};
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, String>;

struct Runtime {
    data_dir: PathBuf,
    sessions: Mutex<HashMap<String, Arc<GameStore>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileInfo {
    name: String,
    path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenResult {
    session_id: String,
    directory: String,
    files: Vec<LocalFileInfo>,
}

fn display_directory(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
    }
}

fn session(state: &Runtime, id: &str) -> Result<Arc<GameStore>> {
    state
        .sessions
        .lock()
        .map_err(|_| "无法访问本地会话".to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "游戏目录会话已失效，请重新打开。".to_string())
}

fn scan_directory(root: &Path) -> Result<Vec<LocalFileInfo>> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory)
            .map_err(|e| format!("无法读取目录 {}：{e}", directory.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("无法读取目录项目：{e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("无法检查文件：{e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if !matches!(name.to_ascii_lowercase().as_str(), ".git" | "node_modules") {
                    pending.push(entry.path());
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "文件路径超出游戏目录".to_string())?;
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let is_root = relative.components().count() == 1;
            if !(extension == "ini"
                || extension == "pcx"
                || (is_root
                    && (extension == "mix"
                        || extension == "csf"
                        || name.eq_ignore_ascii_case("Phobos.dll"))))
            {
                continue;
            }
            let size = entry
                .metadata()
                .map_err(|e| format!("无法检查 {name}：{e}"))?
                .len();
            let relative = relative.to_string_lossy().replace('\\', "/");
            files.push(LocalFileInfo {
                name,
                path: relative,
                size,
            });
            if files.len() > 50_000 {
                return Err("游戏目录中的规则或资源文件过多".into());
            }
        }
    }
    files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(files)
}

fn open_session(state: &Runtime, path: PathBuf) -> Result<OpenResult> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("无法打开游戏目录：{e}"))?;
    let id = hex::encode(Sha256::digest(canonical.to_string_lossy().as_bytes()));
    let existing = state
        .sessions
        .lock()
        .map_err(|_| "无法访问本地会话".to_string())?
        .get(&id)
        .cloned();
    let store = match existing {
        Some(store) => store,
        None => Arc::new(GameStore::open(&canonical, &state.data_dir)?),
    };
    let files = scan_directory(&store.root)?;
    let directory = display_directory(&store.root);
    state
        .sessions
        .lock()
        .map_err(|_| "无法访问本地会话".to_string())?
        .insert(id.clone(), store);
    Ok(OpenResult {
        session_id: id,
        directory,
        files,
    })
}

#[tauri::command(async)]
fn pick_game_directory(
    app: tauri::AppHandle,
    state: State<'_, Runtime>,
) -> Result<Option<OpenResult>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("选择心灵终结游戏目录")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| format!("无效的游戏目录：{e}"))?;
    open_session(&state, path).map(Some)
}

#[tauri::command(async)]
fn pick_output_directory(
    app: tauri::AppHandle,
    state: State<'_, Runtime>,
) -> Result<Option<OpenResult>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("选择规则版本的输出目录")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| format!("无效的输出目录：{e}"))?;
    open_session(&state, path).map(Some)
}

#[tauri::command(async)]
fn open_recent_directory(state: State<'_, Runtime>) -> Result<Option<OpenResult>> {
    #[cfg(debug_assertions)]
    if let Some(test_path) = std::env::var_os("MO_EDITOR_TEST_DIRECTORY") {
        let temp = fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
        let test = fs::canonicalize(PathBuf::from(test_path)).map_err(|e| e.to_string())?;
        if !test.starts_with(temp) {
            return Err("测试目录必须位于系统临时目录".into());
        }
        return open_session(&state, test).map(Some);
    }
    let path = state.data_dir.join("last-directory.json");
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("无法读取最近使用的目录：{e}")),
    };
    let directory: String =
        serde_json::from_slice(&data).map_err(|e| format!("最近目录记录无效：{e}"))?;
    open_session(&state, PathBuf::from(directory)).map(Some)
}

#[tauri::command(async)]
fn remember_directory(session_id: String, state: State<'_, Runtime>) -> Result<()> {
    let store = session(&state, &session_id)?;
    fs::create_dir_all(&state.data_dir).map_err(|e| format!("无法创建设置目录：{e}"))?;
    let data =
        serde_json::to_vec(&store.root.to_string_lossy().to_string()).map_err(|e| e.to_string())?;
    fs::write(state.data_dir.join("last-directory.json"), data)
        .map_err(|e| format!("无法记住游戏目录：{e}"))
}

#[tauri::command(async)]
fn refresh_game_files(session_id: String, state: State<'_, Runtime>) -> Result<OpenResult> {
    let store = session(&state, &session_id)?;
    Ok(OpenResult {
        session_id,
        directory: display_directory(&store.root),
        files: scan_directory(&store.root)?,
    })
}

#[tauri::command(async)]
fn read_game_file(
    session_id: String,
    path: String,
    start: u64,
    end: u64,
    state: State<'_, Runtime>,
) -> Result<Response> {
    let store = session(&state, &session_id)?;
    if path.contains('\\')
        || path.contains(':')
        || !Path::new(&path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("无效的资源文件路径".into());
    }
    let ext = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "ini" | "mix" | "csf" | "pcx")
        && !path.eq_ignore_ascii_case("Phobos.dll")
    {
        return Err("不支持读取该文件类型".into());
    }
    let actual =
        fs::canonicalize(store.root.join(&path)).map_err(|e| format!("无法读取 {path}：{e}"))?;
    if !actual.starts_with(&store.root) {
        return Err("资源文件超出游戏目录".into());
    }
    let mut file = File::open(actual).map_err(|e| format!("无法打开 {path}：{e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let end = end.min(size);
    if start > end || end - start > 64 * 1024 * 1024 {
        return Err("读取资源的范围无效".into());
    }
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("无法定位资源：{e}"))?;
    let mut bytes = vec![0; (end - start) as usize];
    file.read_exact(&mut bytes)
        .map_err(|e| format!("资源文件读取不完整：{e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command(async)]
fn prepare_save(
    session_id: String,
    entries: Vec<SaveEntry>,
    state: State<'_, Runtime>,
) -> Result<String> {
    session(&state, &session_id)?.prepare(entries, "save")
}

#[tauri::command(async)]
fn prepare_export_directories(
    session_id: String,
    paths: Vec<String>,
    state: State<'_, Runtime>,
) -> Result<()> {
    session(&state, &session_id)?.ensure_export_dirs(&paths)
}

#[tauri::command(async)]
fn stage_save_file(request: Request<'_>, state: State<'_, Runtime>) -> Result<()> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("缺少请求参数 {name}"))
    };
    let session_id = header("x-session-id")?;
    let transaction = header("x-transaction-id")?;
    let index = header("x-file-index")?
        .parse::<usize>()
        .map_err(|_| "无效的文件序号".to_string())?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("保存数据格式无效".into());
    };
    session(&state, session_id)?.stage(transaction, index, bytes)
}

#[tauri::command(async)]
fn commit_save(session_id: String, transaction: String, state: State<'_, Runtime>) -> Result<()> {
    session(&state, &session_id)?.commit(&transaction)
}

#[tauri::command(async)]
fn abort_save(session_id: String, transaction: String, state: State<'_, Runtime>) -> Result<()> {
    session(&state, &session_id)?.abort(&transaction)
}

#[tauri::command(async)]
fn list_versions(session_id: String, state: State<'_, Runtime>) -> Result<Vec<VersionInfo>> {
    session(&state, &session_id)?.versions()
}

#[tauri::command(async)]
fn version_files(
    session_id: String,
    version: String,
    state: State<'_, Runtime>,
) -> Result<Vec<VersionFileInfo>> {
    session(&state, &session_id)?.version_files(&version)
}

#[tauri::command(async)]
fn read_version_snapshot(
    session_id: String,
    version: String,
    index: usize,
    side: String,
    state: State<'_, Runtime>,
) -> Result<Response> {
    Ok(Response::new(
        session(&state, &session_id)?.version_snapshot(&version, index, &side)?,
    ))
}

#[tauri::command(async)]
fn restore_version(
    session_id: String,
    version: String,
    expected: Vec<ExpectedFile>,
    targets: Vec<ExpectedFile>,
    state: State<'_, Runtime>,
) -> Result<String> {
    session(&state, &session_id)?.restore(&version, expected, targets)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            app.manage(Runtime {
                data_dir,
                sessions: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_game_directory,
            pick_output_directory,
            open_recent_directory,
            remember_directory,
            refresh_game_files,
            read_game_file,
            prepare_save,
            prepare_export_directories,
            stage_save_file,
            commit_save,
            abort_save,
            list_versions,
            version_files,
            read_version_snapshot,
            restore_version
        ])
        .run(tauri::generate_context!())
        .expect("无法启动规则编辑器");
}

#[cfg(test)]
mod tests {
    use super::scan_directory;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn detects_only_the_root_phobos_dll_as_a_game_resource() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("pHoBoS.DLL"), b"metadata").unwrap();
        fs::write(dir.path().join("Ares.dll"), b"other").unwrap();
        fs::write(dir.path().join("rulesmo.ini"), b"[General]").unwrap();
        fs::create_dir(dir.path().join("nested")).unwrap();
        fs::write(dir.path().join("nested").join("Phobos.dll"), b"nested").unwrap();
        let paths: Vec<_> = scan_directory(dir.path())
            .unwrap()
            .into_iter()
            .map(|file| file.path)
            .collect();
        assert!(paths.iter().any(|path| path == "pHoBoS.DLL"));
        assert!(paths.iter().any(|path| path == "rulesmo.ini"));
        assert!(!paths.iter().any(|path| path == "Ares.dll"));
        assert!(!paths.iter().any(|path| path == "nested/Phobos.dll"));
    }
}
