const invoke = window.__TAURI__?.core?.invoke;
export const isDesktop = typeof invoke === 'function';

class LocalFile {
  constructor(sessionId, info) {
    this.sessionId = sessionId;
    this.name = info.name;
    this.path = info.path;
    this.size = info.size;
    this.webkitRelativePath = `GameDirectory/${info.path}`;
  }
  slice(start = 0, end = this.size) {
    const from = Math.max(0, Math.min(this.size, start < 0 ? this.size + start : start));
    const to = Math.max(from, Math.min(this.size, end < 0 ? this.size + end : end));
    return { arrayBuffer: () => invoke('read_game_file', { sessionId: this.sessionId, path: this.path, start: from, end: to }) };
  }
  arrayBuffer() { return this.slice().arrayBuffer(); }
}

export function localFiles(session) {
  return session.files.map(info => new LocalFile(session.sessionId, info));
}

export async function hashBytes(bytes) {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function pickDirectory() { return invoke('pick_game_directory'); }
export async function pickOutputDirectory() { return invoke('pick_output_directory'); }
export async function recentDirectory() { return invoke('open_recent_directory'); }
export async function rememberDirectory(sessionId) { return invoke('remember_directory', { sessionId }); }
export async function refreshDirectory(sessionId) { return invoke('refresh_game_files', { sessionId }); }
export async function listVersions(sessionId) { return invoke('list_versions', { sessionId }); }
export async function versionFiles(sessionId, version) { return invoke('version_files', { sessionId, version }); }
export async function versionSnapshot(sessionId, version, index, side) {
  return new Uint8Array(await invoke('read_version_snapshot', { sessionId, version, index, side }));
}
export async function restoreVersion(sessionId, version, expected, targets) { return invoke('restore_version', { sessionId, version, expected, targets }); }
export async function prepareExportDirectories(sessionId, paths) { return invoke('prepare_export_directories', { sessionId, paths }); }

export async function saveFiles(sessionId, files) {
  const entries = await Promise.all(files.map(async ({ file, ...item }) => ({
    path: file.path,
    expectedHash: Object.hasOwn(item, 'expectedHash') ? item.expectedHash : file.sourceArchive ? null : await hashBytes(file.originalBytes),
  })));
  const transaction = await invoke('prepare_save', { sessionId, entries });
  try {
    for (let index = 0; index < files.length; index++) {
      await invoke('stage_save_file', files[index].bytes, { headers: {
        'x-session-id': sessionId, 'x-transaction-id': transaction, 'x-file-index': String(index),
      } });
    }
    await invoke('commit_save', { sessionId, transaction });
  } catch (error) {
    await invoke('abort_save', { sessionId, transaction }).catch(() => {});
    throw error;
  }
  return transaction;
}

export async function expectedFiles(project, paths) {
  return Promise.all(paths.map(async path => {
    const matches = project.files.filter(file => file.path.toLowerCase() === path.toLowerCase() && !file.sourceArchive);
    if (matches.length > 1) throw new Error(`规则文件路径不明确：${path}`);
    return { path, expectedHash: matches.length ? await hashBytes(matches[0].originalBytes) : null };
  }));
}
