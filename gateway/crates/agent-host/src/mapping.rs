//! Maps a Claude Code tool call to the Betsee ActionRequest the Gateway decides.
//!
//! | Claude tool         | Betsee capability                          |
//! |---------------------|--------------------------------------------|
//! | Bash                | shell.exec on runtime/shell                |
//! | Read, Glob, Grep    | files.read on the catalogued workspace path|
//! | Write, Edit         | files.write on the workspace path          |
//! | WebFetch, WebSearch | web.egress on runtime/web                  |
//! | anything else       | runtime.unmapped on runtime/unmapped       |
//!
//! The mapping only names what the call touches; the Gateway resolves tiers from its catalogue and
//! decides. A path outside the workspace keeps its absolute spelling, which no catalogue entry
//! matches, so the Gateway denies it.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

const PREVIEW_CHARS: usize = 600;

/// Lexical normalisation, then symlink resolution for the longest existing prefix, so neither
/// `..` nor a link can move a path out of the workspace unnoticed.
fn resolve(workspace: &Path, raw: &str) -> PathBuf {
    let joined = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        workspace.join(raw)
    };
    let mut lexical = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                lexical.pop();
            }
            Component::CurDir => {}
            other => lexical.push(other),
        }
    }
    let mut existing = lexical.clone();
    let mut rest = Vec::new();
    while !existing.exists() {
        match (
            existing.file_name().map(ToOwned::to_owned),
            existing.parent(),
        ) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return lexical,
        }
    }
    let mut resolved = existing.canonicalize().unwrap_or(existing);
    for name in rest.into_iter().rev() {
        resolved.push(name);
    }
    resolved
}

/// The catalogue id for a path: `workspace` or `workspace/<relative>`, or the absolute path when it
/// lies outside the workspace.
pub fn resource_id(workspace: &Path, raw: &str) -> (String, bool) {
    let root = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    let resolved = resolve(&root, raw);
    let is_dir = resolved.is_dir();
    match resolved.strip_prefix(&root) {
        Ok(relative) if relative.as_os_str().is_empty() => ("workspace".into(), true),
        Ok(relative) => (
            format!(
                "workspace/{}",
                relative.to_string_lossy().replace('\\', "/")
            ),
            is_dir,
        ),
        Err(_) => (resolved.to_string_lossy().into_owned(), is_dir),
    }
}

fn relative(id: &str) -> &str {
    id.strip_prefix("workspace/")
        .unwrap_or(if id == "workspace" { "." } else { id })
}

fn preview(text: &str) -> String {
    text.chars().take(PREVIEW_CHARS).collect()
}

fn sha256(text: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(text.as_bytes()))
}

/// The ActionRequest body for one tool call (session id added by the caller).
pub fn action(workspace: &Path, tool: &str, input: &Value) -> Value {
    let text = |key: &str| input[key].as_str().unwrap_or("");
    let file = |raw: &str| {
        let (id, is_dir) = resource_id(workspace, raw);
        (id, if is_dir { "folder" } else { "file" })
    };
    let (capability, resource_type, id, parameters) = match tool {
        "Read" => {
            let (id, kind) = file(text("file_path"));
            let path = relative(&id).to_owned();
            (
                "files.read",
                kind,
                id,
                json!({"tool":tool,"path":path,"mode":"content"}),
            )
        }
        "Glob" => {
            let (id, kind) = file(input["path"].as_str().unwrap_or("."));
            let path = relative(&id).to_owned();
            (
                "files.read",
                kind,
                id,
                json!({"tool":tool,"path":path,"pattern":text("pattern"),"mode":"names"}),
            )
        }
        "Grep" => {
            let (id, kind) = file(input["path"].as_str().unwrap_or("."));
            let path = relative(&id).to_owned();
            (
                "files.read",
                kind,
                id,
                json!({"tool":tool,"path":path,"pattern":text("pattern"),"mode":"content"}),
            )
        }
        "Bash" => (
            "shell.exec",
            "shell",
            "runtime/shell".into(),
            json!({"tool":tool,"command":text("command")}),
        ),
        "Write" => {
            let (id, _) = file(text("file_path"));
            let content = text("content");
            let path = relative(&id).to_owned();
            (
                "files.write",
                "file",
                id,
                json!({"tool":tool,"path":path,"bytes":content.len(),"sha256":sha256(content),"preview":preview(content)}),
            )
        }
        "Edit" => {
            let (id, _) = file(text("file_path"));
            let path = relative(&id).to_owned();
            (
                "files.write",
                "file",
                id,
                json!({"tool":tool,"path":path,"replace":preview(text("old_string")),"with":preview(text("new_string")),"replace_all":input["replace_all"].as_bool().unwrap_or(false)}),
            )
        }
        "WebFetch" => (
            "web.egress",
            "network",
            "runtime/web".into(),
            json!({"tool":tool,"url":text("url")}),
        ),
        "WebSearch" => (
            "web.egress",
            "network",
            "runtime/web".into(),
            json!({"tool":tool,"query":text("query")}),
        ),
        _ => (
            "runtime.unmapped",
            "runtime_tool",
            "runtime/unmapped".into(),
            json!({"tool":tool}),
        ),
    };
    json!({"capability":capability,"resource":{"type":resource_type,"id":id,"tier":"internal"},"parameters":parameters})
}

/// Paths a Codex `apply_patch` touches. Every added, updated, deleted or moved-to file is a write
/// the Gateway decides on its own; a patch naming no path is treated as unmappable.
pub fn patch_paths(patch: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in patch.lines() {
        for marker in [
            "*** Add File: ",
            "*** Update File: ",
            "*** Delete File: ",
            "*** Move to: ",
        ] {
            if let Some(path) = line.strip_prefix(marker) {
                let path = path.trim().to_owned();
                if !path.is_empty() && !paths.contains(&path) {
                    paths.push(path);
                }
            }
        }
    }
    paths
}

/// One ActionRequest per file a Codex patch writes.
pub fn patch_actions(workspace: &Path, input: &Value) -> Vec<Value> {
    let patch = input["command"]
        .as_str()
        .or_else(|| input["patch"].as_str())
        .or_else(|| input["input"].as_str())
        .unwrap_or("");
    patch_paths(patch)
        .into_iter()
        .map(|path| {
            let (id, _) = resource_id(workspace, &path);
            let relative = relative(&id).to_owned();
            json!({"capability":"files.write","resource":{"type":"file","id":id,"tier":"internal"},"parameters":{"tool":"apply_patch","path":relative,"bytes":patch.len(),"sha256":sha256(patch),"preview":preview(patch)}})
        })
        .collect()
}

/// Identifies one exact tool call, so a retry after a timed-out approval finds the same trace.
pub fn call_key(tool: &str, input: &Value) -> String {
    sha256(&format!("{tool}\n{input}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("betsee-map-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("handbook")).unwrap();
        std::fs::write(dir.join("handbook/onboarding.md"), "x").unwrap();
        dir
    }

    #[test]
    fn tools_map_to_capabilities_and_catalogue_ids() {
        let ws = workspace();
        let abs = ws.join("handbook/onboarding.md");
        let read = action(&ws, "Read", &json!({"file_path":abs}));
        assert_eq!(read["capability"], "files.read");
        assert_eq!(read["resource"]["id"], "workspace/handbook/onboarding.md");
        assert_eq!(read["resource"]["type"], "file");
        let glob = action(&ws, "Glob", &json!({"pattern":"**/*.md"}));
        assert_eq!(
            glob["resource"],
            json!({"type":"folder","id":"workspace","tier":"internal"})
        );
        assert_eq!(glob["parameters"]["mode"], "names");
        let grep = action(&ws, "Grep", &json!({"pattern":"salary","path":"handbook"}));
        assert_eq!(grep["resource"]["id"], "workspace/handbook");
        assert_eq!(grep["parameters"]["mode"], "content");
        let bash = action(&ws, "Bash", &json!({"command":"rm -rf ."}));
        assert_eq!(bash["capability"], "shell.exec");
        assert_eq!(bash["parameters"]["command"], "rm -rf .");
        let write = action(
            &ws,
            "Write",
            &json!({"file_path":"notes/summary.md","content":"hello"}),
        );
        assert_eq!(write["capability"], "files.write");
        assert_eq!(write["resource"]["id"], "workspace/notes/summary.md");
        assert_eq!(write["parameters"]["bytes"], 5);
        assert_eq!(
            action(&ws, "Edit", &json!({"file_path":abs}))["capability"],
            "files.write"
        );
        assert_eq!(
            action(&ws, "WebFetch", &json!({"url":"https://x"}))["capability"],
            "web.egress"
        );
        assert_eq!(
            action(&ws, "WebSearch", &json!({"query":"q"}))["capability"],
            "web.egress"
        );
        let other = action(&ws, "TodoWrite", &json!({}));
        assert_eq!(other["capability"], "runtime.unmapped");
        assert_eq!(other["parameters"]["tool"], "TodoWrite");
    }

    #[test]
    fn paths_cannot_escape_the_workspace() {
        let ws = workspace();
        for raw in ["/etc/passwd", "../outside.md", "handbook/../../outside.md"] {
            let (id, _) = resource_id(&ws, raw);
            assert!(!id.starts_with("workspace"), "{raw} -> {id}");
        }
        let link = ws.join("escape");
        let _ = std::fs::remove_file(&link);
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc", &link).unwrap();
        #[cfg(unix)]
        assert!(!resource_id(&ws, "escape/passwd").0.starts_with("workspace"));
        assert_eq!(
            resource_id(&ws, "./handbook/./onboarding.md").0,
            "workspace/handbook/onboarding.md"
        );
        assert_eq!(
            resource_id(&ws, "handbook/new/deep.md").0,
            "workspace/handbook/new/deep.md"
        );
    }

    #[test]
    fn codex_patches_become_one_write_per_path() {
        let ws = workspace();
        let patch = "*** Begin Patch\n*** Add File: notes/a.md\n+hello\n*** Update File: handbook/onboarding.md\n@@\n-x\n+y\n*** Delete File: ../outside.txt\n*** End Patch";
        let actions = patch_actions(&ws, &json!({"command":patch}));
        let ids: Vec<_> = actions
            .iter()
            .map(|a| a["resource"]["id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(ids[0], "workspace/notes/a.md");
        assert_eq!(ids[1], "workspace/handbook/onboarding.md");
        assert!(!ids[2].starts_with("workspace"), "{}", ids[2]);
        assert!(actions.iter().all(|a| a["capability"] == "files.write"));
        assert!(patch_actions(&ws, &json!({"command":"no paths"})).is_empty());
    }

    #[test]
    fn call_keys_bind_tool_and_exact_input() {
        let a = call_key("Write", &json!({"file_path":"a","content":"x"}));
        assert_eq!(
            a,
            call_key("Write", &json!({"file_path":"a","content":"x"}))
        );
        assert_ne!(
            a,
            call_key("Write", &json!({"file_path":"a","content":"y"}))
        );
        assert_ne!(a, call_key("Edit", &json!({"file_path":"a","content":"x"})));
    }
}
