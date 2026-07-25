//! Backend command construction for development and packaged builds.

use std::path::{Path, PathBuf};
#[cfg(debug_assertions)]
use std::process::{Command as StdCommand, Stdio};

#[cfg(not(debug_assertions))]
use tauri::Manager;
use tauri_plugin_shell::{process::Command, ShellExt};

/// Builds the command used to start the Python backend sidecar.
#[cfg(debug_assertions)]
pub(super) fn create(app: &tauri::AppHandle) -> Result<Command, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let source_path = repo_root.join("src");

    // In dev mode, check for bundled OCR tools under src-tauri/binaries/ocr-tools/
    let ocr_tools = dev_ocr_tools(&repo_root);
    if let Some(ref path) = ocr_tools {
        log::info!("[backend] dev: bundled OCR tools: {}", path.display());
    } else {
        log::warn!("[backend] dev: bundled OCR tools not found; Tesseract/Poppler will use system PATH");
    }

    let command = if command_exists("uv") {
        log::info!(
            "[backend] dev command: uv run python -m aiarb.tauri.entry cwd={}",
            repo_root.display(),
        );
        let mut cmd = app
            .shell()
            .command("uv")
            .args(["run", "python", "-m", "aiarb.tauri.entry"])
            .current_dir(repo_root)
            .env("PYTHONPATH", source_path.display().to_string());
        if let Some(path) = ocr_tools {
            cmd = cmd.env("AIARB_DESKTOP_OCR_TOOLS", path.display().to_string());
        }
        cmd
    } else {
        let (python, prefix_args) = python_command(&repo_root);
        let mut args = prefix_args;
        args.extend(["-m", "aiarb.tauri.entry"]);
        log::info!(
            "[backend] dev command: {} {} cwd={}",
            python,
            args.join(" "),
            repo_root.display(),
        );
        let mut cmd = app
            .shell()
            .command(python)
            .args(args)
            .current_dir(repo_root)
            .env("PYTHONPATH", source_path.display().to_string());
        if let Some(path) = ocr_tools {
            cmd = cmd.env("AIARB_DESKTOP_OCR_TOOLS", path.display().to_string());
        }
        cmd
    };
    Ok(command)
}

#[cfg(debug_assertions)]
fn dev_ocr_tools(repo_root: &Path) -> Option<PathBuf> {
    let root = repo_root
        .join("console")
        .join("src-tauri")
        .join("binaries")
        .join("ocr-tools");
    let tess = if cfg!(windows) {
        root.join("tesseract").join("tesseract.exe")
    } else {
        root.join("tesseract").join("tesseract")
    };
    if tess.is_file() {
        Some(root)
    } else {
        None
    }
}

/// Builds the command used to start the packaged Python backend sidecar.
#[cfg(not(debug_assertions))]
pub(super) fn create(app: &tauri::AppHandle) -> Result<Command, String> {
    let backend = packaged_backend_executable(app)?;
    let backend_dir = backend
        .parent()
        .ok_or_else(|| format!("backend executable has no parent: {}", backend.display()))?
        .to_path_buf();
    log::info!(
        "[backend] packaged command: {} cwd={}",
        backend.display(),
        backend_dir.display(),
    );
    let mut command = app
        .shell()
        .command(backend)
        .current_dir(&backend_dir)
        .env(path_env_key(), path_with_backend_dir(&backend_dir)?);
    // Bundled standalone Python used by the backend to install third-party
    // plugin dependencies (sys.executable is the frozen backend, not Python).
    if let Some(python) = packaged_python_runtime(app) {
        log::info!("[backend] bundled python runtime: {}", python.display());
        command = command.env(
            "AIARB_DESKTOP_PY_RUNTIME",
            python.to_string_lossy().to_string(),
        );
    } else {
        log::warn!(
            "[backend] bundled python runtime not found; plugin dependency \
             installation will be unavailable"
        );
    }
    if let Some(node_runtime) = packaged_node_runtime(app) {
        log::info!("[backend] bundled node runtime: {}", node_runtime.display());
        command = command.env(
            "AIARB_DESKTOP_NODE_RUNTIME",
            node_runtime.to_string_lossy().to_string(),
        );
    } else {
        log::warn!("[backend] bundled node runtime not found");
    }
    if let Some(ocr_tools) = packaged_ocr_tools(app) {
        log::info!("[backend] bundled OCR tools: {}", ocr_tools.display());
        command = command.env(
            "AIARB_DESKTOP_OCR_TOOLS",
            ocr_tools.to_string_lossy().to_string(),
        );
    } else {
        log::warn!("[backend] bundled OCR tools not found; Tesseract/Poppler will use system PATH");
    }
    Ok(command)
}

#[cfg(not(debug_assertions))]
fn packaged_python_runtime(app: &tauri::AppHandle) -> Option<PathBuf> {
    let base = app
        .path()
        .resource_dir()
        .ok()?
        .join("binaries")
        .join("python-runtime")
        .join("python");
    let candidates = if cfg!(windows) {
        vec![base.join("python.exe")]
    } else {
        vec![base.join("bin").join("python3"), base.join("bin").join("python")]
    };
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(not(debug_assertions))]
fn packaged_node_runtime(app: &tauri::AppHandle) -> Option<PathBuf> {
    let root = app
        .path()
        .resource_dir()
        .ok()?
        .join("binaries")
        .join("node-runtime");
    let node = if cfg!(windows) {
        root.join("node.exe")
    } else {
        root.join("bin").join("node")
    };
    node.is_file().then_some(root)
}

#[cfg(not(debug_assertions))]
fn packaged_ocr_tools(app: &tauri::AppHandle) -> Option<PathBuf> {
    let root = app
        .path()
        .resource_dir()
        .ok()?
        .join("binaries")
        .join("ocr-tools");
    // Verify tesseract binary exists inside
    let tess = if cfg!(windows) {
        root.join("tesseract").join("tesseract.exe")
    } else {
        root.join("tesseract").join("tesseract")
    };
    if tess.is_file() {
        Some(root)
    } else {
        None
    }
}

#[cfg(not(debug_assertions))]
fn packaged_backend_executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let executable_name = if cfg!(windows) {
        "aiarb.exe"
    } else {
        "aiarb"
    };
    let path = app
        .path()
        .resource_dir()
        .map_err(|err| format!("failed to resolve resource directory: {err}"))?
        .join("binaries")
        .join("aiarb-backend")
        .join(executable_name);

    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "backend executable not found at {}",
            path.display()
        ))
    }
}

#[cfg(not(debug_assertions))]
fn path_with_backend_dir(backend_dir: &Path) -> Result<String, String> {
    let mut paths = vec![backend_dir.to_path_buf()];
    if let Some(existing) = std::env::var_os(path_env_key()) {
        paths.extend(std::env::split_paths(&existing));
    }

    std::env::join_paths(paths)
        .map_err(|err| format!("failed to join backend PATH entries: {err}"))?
        .into_string()
        .map_err(|_| "backend PATH contains non-Unicode data".to_string())
}

#[cfg(all(not(debug_assertions), windows))]
fn path_env_key() -> &'static str {
    "Path"
}

#[cfg(all(not(debug_assertions), not(windows)))]
fn path_env_key() -> &'static str {
    "PATH"
}

#[cfg(debug_assertions)]
fn command_exists(command: &str) -> bool {
    StdCommand::new(command)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(debug_assertions)]
fn local_python(repo_root: &Path) -> Option<String> {
    let candidates = if cfg!(windows) {
        vec![
            repo_root.join(".venv/Scripts/python.exe"),
            repo_root.join("venv/Scripts/python.exe"),
        ]
    } else {
        vec![
            repo_root.join(".venv/bin/python"),
            repo_root.join("venv/bin/python"),
        ]
    };

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.display().to_string())
}

#[cfg(debug_assertions)]
fn python_command(repo_root: &Path) -> (String, Vec<&'static str>) {
    if let Some(local) = local_python(repo_root) {
        return (local, vec![]);
    }
    #[cfg(windows)]
    {
        if command_exists("py") {
            return ("py".to_string(), vec!["-3"]);
        }
    }
    if command_exists("python3") {
        ("python3".to_string(), vec![])
    } else {
        ("python".to_string(), vec![])
    }
}