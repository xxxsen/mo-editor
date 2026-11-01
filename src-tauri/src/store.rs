use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
const MAX_RULE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntry {
    pub path: String,
    pub expected_hash: Option<String>,
    #[serde(default)]
    pub delete: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedFile {
    pub path: String,
    pub expected_hash: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    path: String,
    before_hash: Option<String>,
    after_hash: Option<String>,
    delete: bool,
    staged: bool,
    intent: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    id: String,
    created_ms: u64,
    root: String,
    kind: String,
    status: String,
    items: Vec<Item>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub created_ms: u64,
    pub kind: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub hash: String,
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionFileInfo {
    pub path: String,
    pub before: Option<SnapshotInfo>,
    pub after: Option<SnapshotInfo>,
    pub after_error: Option<String>,
    pub current_hash: Option<String>,
    pub current_error: Option<String>,
}

pub struct GameStore {
    pub root: PathBuf,
    versions: PathBuf,
    // Keep the lock for the lifetime of the session, including crash recovery.
    _lock: File,
}

fn err(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}：{error}")
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn validate_relative(value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.contains('\\') || value.contains(':') || value.starts_with('/') {
        return Err(format!("无效的规则文件路径：{value}"));
    }
    let path = Path::new(value);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
        || !path
            .extension()
            .and_then(|part| part.to_str())
            .is_some_and(|part| part.eq_ignore_ascii_case("ini"))
    {
        return Err(format!("只允许保存目录内的 INI 文件：{value}"));
    }
    Ok(path.to_path_buf())
}

fn sync_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = File::create(path).map_err(|e| err("创建文件失败", e))?;
    file.write_all(bytes).map_err(|e| err("写入文件失败", e))?;
    file.sync_all().map_err(|e| err("同步文件失败", e))
}

fn replace_file(target: &Path, bytes: &[u8], temp_name: &str) -> Result<()> {
    let parent = target.parent().ok_or("目标文件没有父目录")?;
    let temp = parent.join(format!(
        "{temp_name}-{:x}-{:x}",
        now_ms(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| err("创建临时文件失败", e))?;
        file.write_all(bytes)
            .map_err(|e| err("写入临时文件失败", e))?;
        file.sync_all().map_err(|e| err("同步临时文件失败", e))?;
        drop(file);
        fs::rename(&temp, target).map_err(|e| err("替换目标文件失败", e))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

impl GameStore {
    pub fn open(root: &Path, data_dir: &Path) -> Result<Self> {
        let root = fs::canonicalize(root).map_err(|e| err("无法访问游戏目录", e))?;
        if !root.is_dir() {
            return Err("选择的路径不是文件夹".into());
        }
        let versions = data_dir
            .join("backups")
            .join(digest(root.to_string_lossy().as_bytes()));
        fs::create_dir_all(&versions).map_err(|e| err("无法创建备份目录", e))?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(versions.join("session.lock"))
            .map_err(|e| err("无法打开目录锁", e))?;
        lock.try_lock_exclusive()
            .map_err(|_| "这个游戏目录已由另一个编辑器窗口打开。".to_string())?;
        let store = Self {
            root,
            versions,
            _lock: lock,
        };
        store.recover_incomplete()?;
        Ok(store)
    }

    pub fn ensure_export_dirs(&self, paths: &[String]) -> Result<()> {
        for path in paths {
            let relative = validate_relative(path)?;
            let mut parent = self.root.clone();
            for part in relative
                .parent()
                .into_iter()
                .flat_map(|value| value.components())
            {
                let Component::Normal(name) = part else {
                    return Err(format!("无效的目录：{path}"));
                };
                parent.push(name);
                match fs::symlink_metadata(&parent) {
                    Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => (),
                    Ok(_) => return Err(format!("目标目录不是普通文件夹：{}", parent.display())),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        fs::create_dir(&parent).map_err(|e| err("无法创建输出目录", e))?
                    }
                    Err(e) => return Err(err("无法检查输出目录", e)),
                }
                let resolved = fs::canonicalize(&parent).map_err(|e| err("无法检查输出目录", e))?;
                if !resolved.starts_with(&self.root) {
                    return Err("输出目录超出了所选目录".into());
                }
            }
        }
        Ok(())
    }

    fn target(&self, relative: &str) -> Result<PathBuf> {
        let relative_path = validate_relative(relative)?;
        let target = self.root.join(relative_path);
        let parent = target.parent().ok_or("无效的文件路径")?;
        let actual_parent =
            fs::canonicalize(parent).map_err(|e| err(&format!("无法访问 {relative} 的目录"), e))?;
        if !actual_parent.starts_with(&self.root) {
            return Err(format!("文件路径超出游戏目录：{relative}"));
        }
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!("目标不是普通文件：{relative}"));
            }
            let actual = fs::canonicalize(&target).map_err(|e| err("无法检查目标文件", e))?;
            if !actual.starts_with(&self.root) {
                return Err(format!("文件路径超出游戏目录：{relative}"));
            }
        }
        Ok(target)
    }

    fn current(&self, relative: &str) -> Result<Option<Vec<u8>>> {
        let target = self.target(relative)?;
        match fs::metadata(&target) {
            Ok(meta) => {
                if meta.len() > MAX_RULE_BYTES {
                    return Err(format!("规则文件过大：{relative}"));
                }
                fs::read(target)
                    .map(Some)
                    .map_err(|e| err(&format!("无法读取 {relative}"), e))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(err(&format!("无法检查 {relative}"), e)),
        }
    }

    fn manifest_path(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty()
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        {
            return Err("无效的版本编号".into());
        }
        Ok(self.versions.join(id).join("manifest.json"))
    }

    fn load(&self, id: &str) -> Result<Manifest> {
        let path = self.manifest_path(id)?;
        let bytes = fs::read(path).map_err(|e| err("无法读取备份记录", e))?;
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|e| err("备份记录损坏", e))?;
        if manifest.id != id || manifest.root != self.root.to_string_lossy() {
            return Err("备份不属于当前游戏目录".into());
        }
        Ok(manifest)
    }

    fn persist(&self, manifest: &Manifest) -> Result<()> {
        let path = self.manifest_path(&manifest.id)?;
        let data = serde_json::to_vec_pretty(manifest).map_err(|e| err("无法生成备份记录", e))?;
        let temp = path.with_extension("tmp");
        sync_file(&temp, &data)?;
        fs::rename(&temp, &path).map_err(|e| err("无法更新备份记录", e))
    }

    pub fn prepare(&self, entries: Vec<SaveEntry>, kind: &str) -> Result<String> {
        if entries.is_empty() {
            return Err("没有需要保存的文件".into());
        }
        let mut seen = HashSet::new();
        let mut originals = Vec::new();
        for entry in &entries {
            validate_relative(&entry.path)?;
            if !seen.insert(entry.path.to_lowercase()) {
                return Err(format!("保存路径重复：{}", entry.path));
            }
            let data = self.current(&entry.path)?;
            let actual = data.as_deref().map(digest);
            if actual != entry.expected_hash {
                return Err(format!(
                    "{} 已在外部被修改，请重新加载后再保存。",
                    entry.path
                ));
            }
            originals.push(data);
        }
        let id = format!(
            "{:x}-{:x}-{:x}",
            now_ms(),
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        );
        let dir = self.versions.join(&id);
        fs::create_dir(&dir).map_err(|e| err("无法创建备份版本", e))?;
        let result = (|| {
            let mut items = Vec::new();
            for (index, (entry, original)) in entries.into_iter().zip(originals).enumerate() {
                if let Some(bytes) = &original {
                    sync_file(&dir.join(format!("before-{index}")), bytes)?;
                }
                items.push(Item {
                    path: entry.path,
                    before_hash: original.as_deref().map(digest),
                    after_hash: None,
                    delete: entry.delete,
                    staged: entry.delete,
                    intent: false,
                });
            }
            self.persist(&Manifest {
                id: id.clone(),
                created_ms: now_ms(),
                root: self.root.to_string_lossy().to_string(),
                kind: kind.into(),
                status: "pending".into(),
                items,
            })?;
            Ok(id.clone())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&dir);
        }
        result
    }

    pub fn stage(&self, id: &str, index: usize, bytes: &[u8]) -> Result<()> {
        if bytes.len() as u64 > MAX_RULE_BYTES {
            return Err("规则文件过大".into());
        }
        let mut manifest = self.load(id)?;
        if manifest.status != "pending" {
            return Err("此保存任务不可继续写入".into());
        }
        let item = manifest.items.get_mut(index).ok_or("无效的保存文件序号")?;
        if item.delete {
            return Err("删除操作不能写入数据".into());
        }
        sync_file(
            &self.versions.join(id).join(format!("after-{index}")),
            bytes,
        )?;
        item.after_hash = Some(digest(bytes));
        item.staged = true;
        self.persist(&manifest)
    }

    pub fn abort(&self, id: &str) -> Result<()> {
        let manifest = self.load(id)?;
        if manifest.status == "pending" || manifest.status == "rolled_back" {
            fs::remove_dir_all(self.versions.join(id))
                .map_err(|e| err("无法清理未开始的保存任务", e))?;
        }
        Ok(())
    }

    pub fn commit(&self, id: &str) -> Result<()> {
        let mut manifest = self.load(id)?;
        if manifest.status != "pending" {
            return Err("此保存任务不可提交".into());
        }
        for (index, item) in manifest.items.iter().enumerate() {
            if !item.staged {
                return Err(format!("{} 尚未准备完成", item.path));
            }
            if self.current(&item.path)?.as_deref().map(digest) != item.before_hash {
                return Err(format!("{} 在保存期间被外部修改，请重新加载。", item.path));
            }
            if !item.delete {
                let bytes = fs::read(self.versions.join(id).join(format!("after-{index}")))
                    .map_err(|e| err("无法读取待保存文件", e))?;
                if Some(digest(&bytes)) != item.after_hash {
                    return Err("待保存文件校验失败".into());
                }
            }
        }
        manifest.status = "committing".into();
        self.persist(&manifest)?;
        for index in 0..manifest.items.len() {
            manifest.items[index].intent = true;
            if let Err(error) = self
                .persist(&manifest)
                .and_then(|_| self.apply_after(&manifest, index))
            {
                return match self.rollback(&mut manifest) {
                    Ok(()) => Err(format!("保存失败，已恢复原文件：{error}")),
                    Err(rollback_error) => Err(format!(
                        "保存失败：{error}；自动恢复失败：{rollback_error}。备份版本：{id}"
                    )),
                };
            }
        }
        manifest.status = "complete".into();
        if let Err(error) = self.persist(&manifest) {
            return match self.rollback(&mut manifest) {
                Ok(()) => Err(format!("保存记录写入失败，已恢复原文件：{error}")),
                Err(rollback_error) => Err(format!(
                    "保存记录写入失败：{error}；自动恢复失败：{rollback_error}。备份版本：{id}"
                )),
            };
        }
        Ok(())
    }

    fn apply_after(&self, manifest: &Manifest, index: usize) -> Result<()> {
        let item = &manifest.items[index];
        if self.current(&item.path)?.as_deref().map(digest) != item.before_hash {
            return Err(format!("{} 在保存期间被外部修改", item.path));
        }
        let target = self.target(&item.path)?;
        if item.delete {
            match fs::remove_file(&target) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(err(&format!("无法删除 {}", item.path), e)),
            }
        } else {
            let bytes = fs::read(
                self.versions
                    .join(&manifest.id)
                    .join(format!("after-{index}")),
            )
            .map_err(|e| err("无法读取待保存文件", e))?;
            if Some(digest(&bytes)) != item.after_hash {
                return Err("待保存文件校验失败".into());
            }
            replace_file(
                &target,
                &bytes,
                &format!(".mo-editor-{}-{index}.tmp", manifest.id),
            )
        }
    }

    fn rollback(&self, manifest: &mut Manifest) -> Result<()> {
        let mut failures = Vec::new();
        for index in (0..manifest.items.len()).rev() {
            let item = &manifest.items[index];
            if !item.intent {
                continue;
            }
            let result = (|| {
                let current = self.current(&item.path)?.as_deref().map(digest);
                if current == item.before_hash {
                    return Ok(());
                }
                if current != item.after_hash {
                    return Err(format!("{} 又被外部修改，无法自动覆盖", item.path));
                }
                let target = self.target(&item.path)?;
                if let Some(expected) = &item.before_hash {
                    let bytes = fs::read(
                        self.versions
                            .join(&manifest.id)
                            .join(format!("before-{index}")),
                    )
                    .map_err(|e| err("无法读取备份", e))?;
                    if &digest(&bytes) != expected {
                        return Err("备份文件校验失败".into());
                    }
                    replace_file(
                        &target,
                        &bytes,
                        &format!(".mo-restore-{}-{index}.tmp", manifest.id),
                    )
                } else {
                    match fs::remove_file(target) {
                        Ok(()) => Ok(()),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                        Err(e) => Err(err("无法移除新生成的文件", e)),
                    }
                }
            })();
            if let Err(error) = result {
                failures.push(error);
            }
        }
        if !failures.is_empty() {
            manifest.status = "recovery_failed".into();
            self.persist(manifest)?;
            return Err(failures.join("；"));
        }
        manifest.status = "rolled_back".into();
        self.persist(manifest)
    }

    fn recover_incomplete(&self) -> Result<()> {
        let entries = fs::read_dir(&self.versions).map_err(|e| err("无法检查备份", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| err("无法读取备份目录", e))?;
            if !entry
                .file_type()
                .map_err(|e| err("无法检查备份类型", e))?
                .is_dir()
            {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if !self.manifest_path(&id)?.exists() {
                continue;
            }
            let mut manifest = self
                .load(&id)
                .map_err(|e| format!("无法检查备份版本 {id}：{e}"))?;
            if manifest.status == "committing" || manifest.status == "recovery_failed" {
                self.rollback(&mut manifest)
                    .map_err(|e| format!("上次保存中断，无法自动恢复版本 {id}：{e}"))?;
            }
        }
        Ok(())
    }

    pub fn versions(&self) -> Result<Vec<VersionInfo>> {
        let mut versions = Vec::new();
        for entry in fs::read_dir(&self.versions).map_err(|e| err("无法读取历史版本", e))? {
            let entry = entry.map_err(|e| err("无法读取历史版本", e))?;
            if !entry
                .file_type()
                .map_err(|e| err("无法检查备份类型", e))?
                .is_dir()
            {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if let Ok(manifest) = self.load(&id) {
                if manifest.status == "complete" {
                    versions.push(VersionInfo {
                        id,
                        created_ms: manifest.created_ms,
                        kind: manifest.kind,
                        paths: manifest.items.into_iter().map(|item| item.path).collect(),
                    });
                }
            }
        }
        versions.sort_by(|a, b| {
            b.created_ms
                .cmp(&a.created_ms)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(versions)
    }

    fn complete_version(&self, id: &str) -> Result<Manifest> {
        let manifest = self.load(id)?;
        if manifest.status != "complete" {
            return Err("该版本不能查看或恢复".into());
        }
        Ok(manifest)
    }

    fn snapshot_info(
        &self,
        id: &str,
        index: usize,
        side: &str,
        hash: &Option<String>,
    ) -> Option<SnapshotInfo> {
        hash.as_ref().map(|value| {
            let path = self.versions.join(id).join(format!("{side}-{index}"));
            let size = fs::metadata(path)
                .ok()
                .filter(|meta| meta.is_file() && meta.len() <= MAX_RULE_BYTES)
                .map(|meta| meta.len());
            SnapshotInfo {
                hash: value.clone(),
                size,
            }
        })
    }

    pub fn version_files(&self, id: &str) -> Result<Vec<VersionFileInfo>> {
        let manifest = self.complete_version(id)?;
        Ok(manifest
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let (current_hash, current_error) = match self.current(&item.path) {
                    Ok(bytes) => (bytes.as_deref().map(digest), None),
                    Err(error) => (None, Some(error)),
                };
                VersionFileInfo {
                    path: item.path.clone(),
                    before: self.snapshot_info(id, index, "before", &item.before_hash),
                    after: self.snapshot_info(id, index, "after", &item.after_hash),
                    after_error: if !item.delete && item.after_hash.is_none() {
                        Some("缺少操作后快照记录".into())
                    } else {
                        None
                    },
                    current_hash,
                    current_error,
                }
            })
            .collect())
    }

    pub fn version_snapshot(&self, id: &str, index: usize, side: &str) -> Result<Vec<u8>> {
        let manifest = self.complete_version(id)?;
        let item = manifest.items.get(index).ok_or("无效的历史文件序号")?;
        let expected = match side {
            "before" => &item.before_hash,
            "after" => &item.after_hash,
            _ => return Err("无效的历史文件状态".into()),
        }
        .as_ref()
        .ok_or("该文件在此状态下不存在")?;
        let path = self.versions.join(id).join(format!("{side}-{index}"));
        let metadata = fs::metadata(&path).map_err(|e| err("无法读取历史快照", e))?;
        if !metadata.is_file() || metadata.len() > MAX_RULE_BYTES {
            return Err("历史快照不是普通文件或文件过大".into());
        }
        let bytes = fs::read(path).map_err(|e| err("无法读取历史快照", e))?;
        if bytes.len() as u64 > MAX_RULE_BYTES {
            return Err("历史快照过大".into());
        }
        if &digest(&bytes) != expected {
            return Err("历史快照校验失败".into());
        }
        Ok(bytes)
    }

    pub fn restore(
        &self,
        id: &str,
        expected: Vec<ExpectedFile>,
        targets: Vec<ExpectedFile>,
    ) -> Result<String> {
        let old = self.complete_version(id)?;
        if expected.len() != old.items.len() || targets.len() != old.items.len() {
            return Err("恢复文件列表不匹配".into());
        }
        for list in [&expected, &targets] {
            let mut seen = HashSet::new();
            if list
                .iter()
                .any(|item| !seen.insert(item.path.to_lowercase()))
            {
                return Err("恢复文件列表包含重复路径".into());
            }
        }
        let mut entries = Vec::new();
        for item in &old.items {
            let entry = expected
                .iter()
                .find(|value| value.path == item.path)
                .ok_or("恢复文件列表不匹配")?;
            let target = targets
                .iter()
                .find(|value| value.path == item.path)
                .ok_or("恢复文件列表不匹配")?;
            if target.expected_hash != item.before_hash {
                return Err("历史版本在预览后发生变化，请重新查看恢复差异。".into());
            }
            entries.push(SaveEntry {
                path: item.path.clone(),
                expected_hash: entry.expected_hash.clone(),
                delete: item.before_hash.is_none(),
            });
        }
        let tx = self.prepare(entries, "restore")?;
        let result = (|| {
            for (index, item) in old.items.iter().enumerate() {
                if let Some(expected_hash) = &item.before_hash {
                    let bytes = fs::read(self.versions.join(id).join(format!("before-{index}")))
                        .map_err(|e| err("无法读取历史备份", e))?;
                    if digest(&bytes) != *expected_hash {
                        return Err("历史备份校验失败".into());
                    }
                    self.stage(&tx, index, &bytes)?;
                }
            }
            self.commit(&tx)?;
            Ok(tx.clone())
        })();
        if result.is_err() {
            let _ = self.abort(&tx);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("game");
        let data = temp.path().join("appdata");
        fs::create_dir_all(root.join("include")).unwrap();
        (temp, root, data)
    }
    fn expected(path: &str, bytes: Option<&[u8]>) -> SaveEntry {
        SaveEntry {
            path: path.into(),
            expected_hash: bytes.map(digest),
            delete: false,
        }
    }
    fn targets(store: &GameStore, id: &str) -> Vec<ExpectedFile> {
        store
            .version_files(id)
            .unwrap()
            .into_iter()
            .map(|item| ExpectedFile {
                path: item.path,
                expected_hash: item.before.map(|snapshot| snapshot.hash),
            })
            .collect()
    }

    #[test]
    fn saves_multiple_files_with_backup_and_restores_created_files() {
        let (_temp, root, data) = setup();
        fs::write(root.join("rulesmo.ini"), b"old\r\n; comment\r\n").unwrap();
        fs::write(root.join("include/units.ini"), b"old-unit").unwrap();
        let store = GameStore::open(&root, &data).unwrap();
        let tx = store
            .prepare(
                vec![
                    expected("rulesmo.ini", Some(b"old\r\n; comment\r\n")),
                    expected("include/units.ini", Some(b"old-unit")),
                    expected("new.ini", None),
                ],
                "save",
            )
            .unwrap();
        store.stage(&tx, 0, b"new\r\n; comment\r\n").unwrap();
        store.stage(&tx, 1, b"new-unit").unwrap();
        store.stage(&tx, 2, b"created").unwrap();
        store.commit(&tx).unwrap();
        assert_eq!(
            fs::read(root.join("rulesmo.ini")).unwrap(),
            b"new\r\n; comment\r\n"
        );
        assert_eq!(
            fs::read(root.join("include/units.ini")).unwrap(),
            b"new-unit"
        );
        assert_eq!(store.versions().unwrap().len(), 1);
        let restore = store
            .restore(
                &tx,
                vec![
                    ExpectedFile {
                        path: "rulesmo.ini".into(),
                        expected_hash: Some(digest(b"new\r\n; comment\r\n")),
                    },
                    ExpectedFile {
                        path: "include/units.ini".into(),
                        expected_hash: Some(digest(b"new-unit")),
                    },
                    ExpectedFile {
                        path: "new.ini".into(),
                        expected_hash: Some(digest(b"created")),
                    },
                ],
                targets(&store, &tx),
            )
            .unwrap();
        assert_eq!(
            fs::read(root.join("rulesmo.ini")).unwrap(),
            b"old\r\n; comment\r\n"
        );
        assert_eq!(
            fs::read(root.join("include/units.ini")).unwrap(),
            b"old-unit"
        );
        assert!(!root.join("new.ini").exists());
        assert_eq!(store.versions().unwrap().len(), 2);
        let restored_files = store.version_files(&restore).unwrap();
        assert_eq!(
            restored_files[2].before.as_ref().unwrap().hash,
            digest(b"created")
        );
        assert!(restored_files[2].after.is_none());
        assert!(restored_files[2].after_error.is_none());
        // Restoring the restore point puts the edited version back.
        store
            .restore(
                &restore,
                vec![
                    ExpectedFile {
                        path: "rulesmo.ini".into(),
                        expected_hash: Some(digest(b"old\r\n; comment\r\n")),
                    },
                    ExpectedFile {
                        path: "include/units.ini".into(),
                        expected_hash: Some(digest(b"old-unit")),
                    },
                    ExpectedFile {
                        path: "new.ini".into(),
                        expected_hash: None,
                    },
                ],
                targets(&store, &restore),
            )
            .unwrap();
        assert_eq!(fs::read(root.join("new.ini")).unwrap(), b"created");
    }

    #[test]
    fn history_exposes_verified_before_after_and_created_files() {
        let (_temp, root, data) = setup();
        fs::write(root.join("rulesmo.ini"), b"before").unwrap();
        let store = GameStore::open(&root, &data).unwrap();
        let tx = store
            .prepare(
                vec![
                    expected("rulesmo.ini", Some(b"before")),
                    expected("new.ini", None),
                ],
                "save",
            )
            .unwrap();
        store.stage(&tx, 0, b"after").unwrap();
        store.stage(&tx, 1, b"created").unwrap();
        store.commit(&tx).unwrap();
        let files = store.version_files(&tx).unwrap();
        assert_eq!(files[0].before.as_ref().unwrap().hash, digest(b"before"));
        assert_eq!(files[0].before.as_ref().unwrap().size, Some(6));
        assert_eq!(files[0].after.as_ref().unwrap().hash, digest(b"after"));
        assert_eq!(files[0].current_hash, Some(digest(b"after")));
        assert!(files[1].before.is_none());
        assert_eq!(store.version_snapshot(&tx, 0, "before").unwrap(), b"before");
        assert_eq!(store.version_snapshot(&tx, 0, "after").unwrap(), b"after");
        assert_eq!(store.version_snapshot(&tx, 1, "after").unwrap(), b"created");
        assert!(store.version_snapshot(&tx, 1, "before").is_err());
        assert!(store.version_snapshot(&tx, 0, "../../outside").is_err());
        assert!(store.version_snapshot(&tx, 3, "after").is_err());
        assert!(store.version_files("../outside").is_err());
        let mut manifest = store.load(&tx).unwrap();
        manifest.items[0].after_hash = None;
        store.persist(&manifest).unwrap();
        assert!(store.version_files(&tx).unwrap()[0].after_error.is_some());
        manifest.items[0].after_hash = Some(digest(b"after"));
        store.persist(&manifest).unwrap();
        fs::remove_file(store.versions.join(&tx).join("after-0")).unwrap();
        assert_eq!(
            store.version_files(&tx).unwrap()[0]
                .after
                .as_ref()
                .unwrap()
                .size,
            None
        );
        assert!(store.version_snapshot(&tx, 0, "after").is_err());
        assert_eq!(store.version_snapshot(&tx, 0, "before").unwrap(), b"before");
        let current = vec![
            ExpectedFile {
                path: "rulesmo.ini".into(),
                expected_hash: Some(digest(b"after")),
            },
            ExpectedFile {
                path: "new.ini".into(),
                expected_hash: Some(digest(b"created")),
            },
        ];
        store.restore(&tx, current, targets(&store, &tx)).unwrap();
        assert_eq!(fs::read(root.join("rulesmo.ini")).unwrap(), b"before");
        assert!(!root.join("new.ini").exists());
    }

    #[test]
    fn restore_rejects_stale_preview_targets_and_corrupted_backups() {
        let (_temp, root, data) = setup();
        fs::write(root.join("rulesmo.ini"), b"before").unwrap();
        let store = GameStore::open(&root, &data).unwrap();
        let tx = store
            .prepare(vec![expected("rulesmo.ini", Some(b"before"))], "save")
            .unwrap();
        store.stage(&tx, 0, b"after").unwrap();
        store.commit(&tx).unwrap();
        let current = vec![ExpectedFile {
            path: "rulesmo.ini".into(),
            expected_hash: Some(digest(b"after")),
        }];
        let mut wrong_targets = targets(&store, &tx);
        wrong_targets[0].expected_hash = Some(digest(b"different"));
        assert!(store
            .restore(&tx, current.clone(), wrong_targets)
            .unwrap_err()
            .contains("重新查看"));
        fs::write(root.join("rulesmo.ini"), b"external").unwrap();
        assert!(store
            .restore(&tx, current.clone(), targets(&store, &tx))
            .unwrap_err()
            .contains("外部"));
        assert_eq!(fs::read(root.join("rulesmo.ini")).unwrap(), b"external");
        fs::write(root.join("rulesmo.ini"), b"after").unwrap();
        fs::write(store.versions.join(&tx).join("before-0"), b"corrupted").unwrap();
        assert!(store
            .version_snapshot(&tx, 0, "before")
            .unwrap_err()
            .contains("校验"));
        assert!(store
            .restore(&tx, current, targets(&store, &tx))
            .unwrap_err()
            .contains("校验"));
        assert_eq!(fs::read(root.join("rulesmo.ini")).unwrap(), b"after");
    }

    #[test]
    fn detects_external_changes_before_and_during_save() {
        let (_temp, root, data) = setup();
        fs::write(root.join("rulesmo.ini"), b"original").unwrap();
        let store = GameStore::open(&root, &data).unwrap();
        assert!(store
            .prepare(vec![expected("rulesmo.ini", Some(b"stale"))], "save")
            .unwrap_err()
            .contains("外部"));
        let tx = store
            .prepare(vec![expected("rulesmo.ini", Some(b"original"))], "save")
            .unwrap();
        store.stage(&tx, 0, b"edited").unwrap();
        fs::write(root.join("rulesmo.ini"), b"external").unwrap();
        assert!(store.commit(&tx).unwrap_err().contains("外部"));
        assert_eq!(fs::read(root.join("rulesmo.ini")).unwrap(), b"external");
        assert!(store.versions().unwrap().is_empty());
    }

    #[test]
    fn rejects_unsafe_paths_and_refuses_duplicate_directory_sessions() {
        let (_temp, root, data) = setup();
        let store = GameStore::open(&root, &data).unwrap();
        for path in [
            "../outside.ini",
            "C:/outside.ini",
            "include/../../outside.ini",
            "bad.mix",
            "include\\bad.ini",
        ] {
            assert!(
                store.prepare(vec![expected(path, None)], "save").is_err(),
                "{path}"
            );
        }
        assert!(GameStore::open(&root, &data).is_err());
    }

    #[test]
    fn interrupted_write_is_rolled_back_on_reopen() {
        let (_temp, root, data) = setup();
        fs::write(root.join("rulesmo.ini"), b"before").unwrap();
        let store = GameStore::open(&root, &data).unwrap();
        let tx = store
            .prepare(vec![expected("rulesmo.ini", Some(b"before"))], "save")
            .unwrap();
        store.stage(&tx, 0, b"after").unwrap();
        let mut manifest = store.load(&tx).unwrap();
        manifest.status = "committing".into();
        manifest.items[0].intent = true;
        store.persist(&manifest).unwrap();
        fs::write(root.join("rulesmo.ini"), b"after").unwrap();
        drop(store);
        let reopened = GameStore::open(&root, &data).unwrap();
        assert_eq!(fs::read(root.join("rulesmo.ini")).unwrap(), b"before");
        assert!(reopened.versions().unwrap().is_empty());
    }

    #[test]
    fn recovery_restores_safe_files_even_if_another_file_changed_externally() {
        let (_temp, root, data) = setup();
        fs::write(root.join("rulesmo.ini"), b"before-a").unwrap();
        fs::write(root.join("include/units.ini"), b"before-b").unwrap();
        let store = GameStore::open(&root, &data).unwrap();
        let tx = store
            .prepare(
                vec![
                    expected("rulesmo.ini", Some(b"before-a")),
                    expected("include/units.ini", Some(b"before-b")),
                ],
                "save",
            )
            .unwrap();
        store.stage(&tx, 0, b"after-a").unwrap();
        store.stage(&tx, 1, b"after-b").unwrap();
        let mut manifest = store.load(&tx).unwrap();
        manifest.status = "committing".into();
        manifest.items[0].intent = true;
        manifest.items[1].intent = true;
        store.persist(&manifest).unwrap();
        fs::write(root.join("rulesmo.ini"), b"after-a").unwrap();
        fs::write(root.join("include/units.ini"), b"external").unwrap();
        drop(store);
        assert!(GameStore::open(&root, &data).is_err());
        assert_eq!(fs::read(root.join("rulesmo.ini")).unwrap(), b"before-a");
        assert_eq!(
            fs::read(root.join("include/units.ini")).unwrap(),
            b"external"
        );
    }

    #[test]
    fn export_creates_nested_directories_and_rejects_non_directory_parents() {
        let (_temp, root, data) = setup();
        let store = GameStore::open(&root, &data).unwrap();
        store
            .ensure_export_dirs(&["new/sub/units.ini".into()])
            .unwrap();
        let tx = store
            .prepare(vec![expected("new/sub/units.ini", None)], "save")
            .unwrap();
        store.stage(&tx, 0, b"rules").unwrap();
        store.commit(&tx).unwrap();
        assert_eq!(fs::read(root.join("new/sub/units.ini")).unwrap(), b"rules");
        fs::write(root.join("not-a-folder"), b"x").unwrap();
        assert!(store
            .ensure_export_dirs(&["not-a-folder/units.ini".into()])
            .is_err());
        assert!(store.ensure_export_dirs(&["../escape.ini".into()]).is_err());
    }
}
