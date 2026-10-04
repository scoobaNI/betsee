//! The Gateway's policy state and its hot reload (CTL-CFG-001).
//!
//! Everything under the policies directory that decides a request is one PolicyState: the Cedar
//! schema and policies, the controls catalog, guardrails.yaml, the semantic model and the baseline
//! threat signatures. A watcher reloads the whole state when any of those files changes and swaps
//! it in only if every part loads and validates; otherwise the last good state stays and the
//! rejection is recorded. Requests read one consistent snapshot (an Arc) for their whole run.

use crate::{
    content,
    semantic::Classifier,
    threats::{Feed, ThreatSet},
};
use anyhow::{Context, Result, bail};
use betsee_decision::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, SystemTime},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Block,
    Redact,
    Allow,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Thresholds {
    pub review_at: f64,
    pub block_at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    #[serde(default)]
    pub description: String,
    pub input: BTreeMap<String, Action>,
    pub output: BTreeMap<String, Action>,
    pub semantic: Thresholds,
}

impl Profile {
    pub fn input_action(&self, class: &str) -> Action {
        self.input.get(class).copied().unwrap_or(Action::Block)
    }
    pub fn output_action(&self, class: &str) -> Action {
        self.output.get(class).copied().unwrap_or(Action::Redact)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Assignments {
    pub default: String,
    #[serde(default)]
    pub use_cases: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticSettings {
    pub model: String,
    #[serde(default)]
    pub llm_judge: bool,
    #[serde(default = "yes")]
    pub scan_tool_output: bool,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignatureSettings {
    pub baseline: String,
    #[serde(default)]
    pub feed_url: Option<String>,
    #[serde(default = "poll")]
    pub poll_seconds: u64,
}

fn poll() -> u64 {
    30
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ModelPrice {
    pub id: String,
    #[serde(default)]
    pub label: String,
    /// local or external.
    pub provider: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub input_cents_per_1k: f64,
    #[serde(default)]
    pub output_cents_per_1k: f64,
    #[serde(default)]
    pub compute_cents_per_second: f64,
    pub max_output_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SessionBudget {
    pub cents: i64,
    pub tokens: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SessionBudgets {
    pub default: SessionBudget,
    #[serde(default)]
    pub use_cases: BTreeMap<String, SessionBudget>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Budgets {
    pub max_session_cents: i64,
    pub sessions: SessionBudgets,
    pub action_cost_cents: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SupplyChain {
    pub allowed_orgs: Vec<String>,
    pub safe_formats: Vec<String>,
    pub unsafe_formats: Vec<String>,
    pub require_pinned_revision: bool,
    pub forbid_trust_remote_code: bool,
    pub typosquat_distance: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Guardrails {
    pub version: u32,
    pub profiles: BTreeMap<String, Profile>,
    pub assignments: Assignments,
    pub semantic: SemanticSettings,
    pub signatures: SignatureSettings,
    pub models: Vec<ModelPrice>,
    pub budgets: Budgets,
    pub supply_chain: SupplyChain,
}

impl Guardrails {
    pub fn parse(text: &str) -> Result<Self> {
        let guardrails: Guardrails = serde_yaml::from_str(text).context("guardrails.yaml")?;
        guardrails.validate()?;
        Ok(guardrails)
    }

    fn validate(&self) -> Result<()> {
        for (name, profile) in &self.profiles {
            for class in profile.input.keys() {
                if !content::INPUT_CLASSES.contains(&class.as_str()) {
                    bail!("profile {name}: unknown input detector {class}");
                }
            }
            for class in profile.output.keys() {
                if !content::OUTPUT_CLASSES.contains(&class.as_str()) {
                    bail!("profile {name}: unknown output detector {class}");
                }
            }
            let t = &profile.semantic;
            if !(0.0..=1.0).contains(&t.review_at)
                || !(0.0..=1.0).contains(&t.block_at)
                || t.review_at > t.block_at
            {
                bail!("profile {name}: semantic thresholds need 0 <= review_at <= block_at <= 1");
            }
        }
        let known = |profile: &String| self.profiles.contains_key(profile);
        if !known(&self.assignments.default) {
            bail!("assignments.default names unknown profile {}", self.assignments.default);
        }
        if let Some((use_case, profile)) =
            self.assignments.use_cases.iter().find(|(_, p)| !known(p))
        {
            bail!("assignments.use_cases.{use_case} names unknown profile {profile}");
        }
        let mut ids = std::collections::BTreeSet::new();
        for model in &self.models {
            if !ids.insert(&model.id) {
                bail!("model {} is listed twice", model.id);
            }
            if !matches!(model.provider.as_str(), "local" | "external") {
                bail!("model {}: provider must be local or external", model.id);
            }
            if [
                model.input_cents_per_1k,
                model.output_cents_per_1k,
                model.compute_cents_per_second,
            ]
            .iter()
            .any(|price| !price.is_finite() || *price < 0.0)
            {
                bail!("model {}: prices must be zero or more", model.id);
            }
            if model.max_output_tokens == 0 || model.max_output_tokens > 32_768 {
                bail!("model {}: max_output_tokens must be 1..=32768", model.id);
            }
        }
        let b = &self.budgets;
        if b.max_session_cents < 1
            || b.sessions.default.cents < 1
            || b.sessions.default.tokens < 0
            || b.sessions.use_cases.values().any(|s| s.cents < 1 || s.tokens < 0)
        {
            bail!("budgets: session budgets need at least 1 cent and zero or more tokens");
        }
        if !b.action_cost_cents.contains_key("default")
            || b.action_cost_cents.values().any(|c| !c.is_finite() || *c < 0.0)
        {
            bail!("budgets.action_cost_cents needs a default and non-negative costs");
        }
        if self.signatures.poll_seconds < 2 {
            bail!("signatures.poll_seconds must be at least 2");
        }
        Ok(())
    }

    pub fn profile_for(&self, use_case: &str) -> (&str, &Profile) {
        let name = self
            .assignments
            .use_cases
            .get(use_case)
            .unwrap_or(&self.assignments.default);
        (name, &self.profiles[name])
    }

    pub fn model(&self, id: &str) -> Option<&ModelPrice> {
        self.models.iter().find(|model| model.id == id)
    }

    pub fn session_budget(&self, use_case: &str) -> &SessionBudget {
        self.budgets
            .sessions
            .use_cases
            .get(use_case)
            .unwrap_or(&self.budgets.sessions.default)
    }

    pub fn action_cost(&self, capability: &str) -> f64 {
        self.budgets
            .action_cost_cents
            .get(capability)
            .or_else(|| self.budgets.action_cost_cents.get("default"))
            .copied()
            .unwrap_or(10.0)
    }
}

/// Approximate token count: about four characters per token for European languages.
pub fn estimate_tokens(text: &str) -> u64 {
    (text.chars().count() as u64).div_ceil(4).max(1)
}

/// What a model call costs, in cents, from the token usage the provider reports or from the
/// wall-clock time a local model needed.
pub fn model_cost(model: &ModelPrice, prompt_tokens: u64, completion_tokens: u64, seconds: f64) -> f64 {
    if model.provider == "local" {
        model.compute_cents_per_second * seconds
    } else {
        model.input_cents_per_1k * prompt_tokens as f64 / 1000.0
            + model.output_cents_per_1k * completion_tokens as f64 / 1000.0
    }
}

pub struct PolicyState {
    pub engine: Engine,
    pub catalog: Value,
    pub guardrails: Guardrails,
    pub classifier: Arc<Classifier>,
    pub baseline: Feed,
    pub version: String,
    pub loaded_at: String,
    pub files: Vec<(String, String)>,
}

fn policy_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.extension().is_some_and(|ext| ext == "cedar")
                || path.file_name().is_some_and(|name| {
                    name == "schema.cedarschema"
                        || name == "controls.yaml"
                        || name == "guardrails.yaml"
                })
        })
        .collect();
    files.sort();
    Ok(files)
}

impl PolicyState {
    pub fn load(dir: &Path) -> Result<Self> {
        let engine = Engine::load(dir)?;
        let catalog: Value =
            serde_yaml::from_str(&std::fs::read_to_string(dir.join("controls.yaml"))?)
                .context("controls.yaml")?;
        if !catalog["controls"].is_array() {
            bail!("controls.yaml has no controls list");
        }
        let guardrails = Guardrails::parse(&std::fs::read_to_string(dir.join("guardrails.yaml"))?)?;
        let classifier = Arc::new(Classifier::load(&dir.join(&guardrails.semantic.model))?);
        let baseline_path = dir.join(&guardrails.signatures.baseline);
        let baseline = Feed::parse(
            &std::fs::read(&baseline_path)
                .with_context(|| format!("signature baseline {}", baseline_path.display()))?,
        )?;
        let mut files = Vec::new();
        let mut all = Sha256::new();
        let mut paths = policy_files(dir)?;
        paths.push(dir.join(&guardrails.semantic.model));
        paths.push(baseline_path);
        for path in paths {
            let bytes = std::fs::read(&path)?;
            let sha = format!("{:x}", Sha256::digest(&bytes));
            all.update(path.file_name().map(|n| n.as_encoded_bytes()).unwrap_or_default());
            all.update(&sha);
            files.push((
                path.strip_prefix(dir).unwrap_or(&path).display().to_string(),
                sha,
            ));
        }
        Ok(Self {
            engine,
            catalog,
            guardrails,
            classifier,
            baseline,
            version: format!("{:x}", all.finalize())[..12].to_owned(),
            loaded_at: crate::store::now(),
            files,
        })
    }

    pub fn summary(&self) -> Value {
        json!({"version":self.version,"loaded_at":self.loaded_at,"files":self.files.iter().map(|(path,sha)|json!({"path":path,"sha256":sha})).collect::<Vec<_>>()})
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ReloadStatus {
    pub active_version: String,
    pub loaded_at: String,
    pub reloads: u64,
    pub last_checked_at: Option<String>,
    pub last_rejected_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct FeedStatus {
    pub url: Option<String>,
    pub last_fetch_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub version: Option<String>,
    pub sha256: Option<String>,
    pub updates: u64,
}

/// Shared, swappable runtime state.
#[derive(Clone)]
pub struct Runtime {
    pub dir: PathBuf,
    state: Arc<RwLock<Arc<PolicyState>>>,
    threats: Arc<RwLock<Arc<ThreatSet>>>,
    external: Arc<RwLock<Option<Feed>>>,
    pub reload: Arc<Mutex<ReloadStatus>>,
    pub feed: Arc<Mutex<FeedStatus>>,
}

impl Runtime {
    pub fn load(dir: PathBuf) -> Result<Self> {
        let state = PolicyState::load(&dir)?;
        let threats = ThreatSet::new(state.baseline.clone(), None)?;
        let reload = ReloadStatus {
            active_version: state.version.clone(),
            loaded_at: state.loaded_at.clone(),
            ..ReloadStatus::default()
        };
        Ok(Self {
            dir,
            state: Arc::new(RwLock::new(Arc::new(state))),
            threats: Arc::new(RwLock::new(Arc::new(threats))),
            external: Arc::new(RwLock::new(None)),
            reload: Arc::new(Mutex::new(reload)),
            feed: Arc::new(Mutex::new(FeedStatus::default())),
        })
    }

    pub fn state(&self) -> Arc<PolicyState> {
        self.state.read().expect("policy state lock").clone()
    }

    pub fn threats(&self) -> Arc<ThreatSet> {
        self.threats.read().expect("threat lock").clone()
    }

    fn rebuild_threats(&self) -> Result<()> {
        let baseline = self.state().baseline.clone();
        let external = self.external.read().expect("feed lock").clone();
        let set = ThreatSet::new(baseline, external)?;
        *self.threats.write().expect("threat lock") = Arc::new(set);
        Ok(())
    }

    fn fingerprint(&self) -> Vec<(PathBuf, u64, Option<SystemTime>)> {
        let mut paths = policy_files(&self.dir).unwrap_or_default();
        let state = self.state();
        paths.push(self.dir.join(&state.guardrails.semantic.model));
        paths.push(self.dir.join(&state.guardrails.signatures.baseline));
        paths
            .into_iter()
            .map(|path| {
                let meta = std::fs::metadata(&path).ok();
                let len = meta.as_ref().map_or(0, std::fs::Metadata::len);
                let modified = meta.and_then(|m| m.modified().ok());
                (path, len, modified)
            })
            .collect()
    }

    /// Loads the directory again. Ok(Some(version)) when a new state went live, Ok(None) when
    /// nothing changed, Err when the new files were rejected (the old state stays).
    pub fn try_reload(&self) -> Result<Option<String>> {
        let current = self.state().version.clone();
        let candidate = PolicyState::load(&self.dir);
        let mut status = self.reload.lock().expect("reload lock");
        status.last_checked_at = Some(crate::store::now());
        match candidate {
            Ok(state) if state.version == current => {
                status.last_error = None;
                Ok(None)
            }
            Ok(state) => {
                let version = state.version.clone();
                status.active_version = version.clone();
                status.loaded_at = state.loaded_at.clone();
                status.reloads += 1;
                status.last_error = None;
                drop(status);
                *self.state.write().expect("policy state lock") = Arc::new(state);
                self.rebuild_threats()?;
                Ok(Some(version))
            }
            Err(error) => {
                let message = format!("{error:#}");
                status.last_rejected_at = Some(crate::store::now());
                status.last_error = Some(message.clone());
                Err(anyhow::anyhow!(message))
            }
        }
    }

    /// Polls the policy files every second. `on_event` receives ("policy_reloaded", detail) or
    /// ("policy_reload_rejected", detail) so the Gateway can record a security event.
    pub fn watch<F, Fut>(self, on_event: F)
    where
        F: Fn(&'static str, Value) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        tokio::spawn(async move {
            let mut seen = self.fingerprint();
            let mut last_error: Option<String> = None;
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let now = self.fingerprint();
                if now == seen {
                    continue;
                }
                // Editors write in several steps; let the file settle before reading it.
                tokio::time::sleep(Duration::from_millis(300)).await;
                seen = self.fingerprint();
                let runtime = self.clone();
                let result = tokio::task::spawn_blocking(move || runtime.try_reload()).await;
                match result {
                    Ok(Ok(Some(version))) => {
                        last_error = None;
                        tracing::info!(%version, "policy state reloaded");
                        on_event("policy_reloaded", json!({"version":version,"files":self.state().files.iter().map(|(p,_)|p.clone()).collect::<Vec<_>>()})).await;
                    }
                    Ok(Ok(None)) => {}
                    Ok(Err(error)) => {
                        let message = error.to_string();
                        tracing::warn!(error = %message, "policy reload rejected; last good state stays");
                        if last_error.as_deref() != Some(message.as_str()) {
                            on_event("policy_reload_rejected", json!({"error":message,"active_version":self.state().version})).await;
                        }
                        last_error = Some(message);
                    }
                    Err(error) => tracing::warn!(%error, "policy reload task failed"),
                }
            }
        });
    }

    /// Polls the external signature feed. A failed fetch or an invalid feed keeps the last good one.
    pub fn poll_feed<F, Fut>(self, on_event: F)
    where
        F: Fn(&'static str, Value) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("feed client");
            let mut last_sha: Option<String> = None;
            let mut last_error: Option<String> = None;
            // The feed host starts after the Gateway in the demo stack; give it a head start.
            tokio::time::sleep(Duration::from_secs(20)).await;
            loop {
                let settings = self.state().guardrails.signatures.clone();
                let url = std::env::var("THREAT_FEED_URL").ok().or(settings.feed_url.clone());
                if let Some(url) = url.filter(|url| !url.is_empty()) {
                    let fetched = async {
                        let response = client.get(&url).send().await?.error_for_status()?;
                        let bytes = response.bytes().await?;
                        if bytes.len() > 4 * 1024 * 1024 {
                            bail!("feed larger than 4 MiB");
                        }
                        let sha = format!("{:x}", Sha256::digest(&bytes));
                        let feed = Feed::parse(&bytes)?;
                        Ok::<_, anyhow::Error>((feed, sha))
                    }
                    .await;
                    let mut status = self.feed.lock().expect("feed status lock").clone();
                    status.url = Some(url.clone());
                    status.last_fetch_at = Some(crate::store::now());
                    match fetched {
                        Ok((feed, sha)) => {
                            status.last_success_at = status.last_fetch_at.clone();
                            status.last_error = None;
                            last_error = None;
                            if last_sha.as_deref() != Some(sha.as_str()) {
                                let version = feed.version.clone();
                                let count = feed.signatures.len();
                                *self.external.write().expect("feed lock") = Some(feed);
                                match self.rebuild_threats() {
                                    Ok(()) => {
                                        status.version = Some(version.clone());
                                        status.sha256 = Some(sha.clone());
                                        status.updates += 1;
                                        last_sha = Some(sha);
                                        on_event("threat_feed_updated", json!({"url":url,"version":version,"signatures":count})).await;
                                    }
                                    Err(error) => status.last_error = Some(format!("{error:#}")),
                                }
                            }
                        }
                        Err(error) => {
                            let message = format!("{error:#}");
                            if last_error.as_deref() != Some(message.as_str()) {
                                on_event("threat_feed_rejected", json!({"url":url,"error":message,"active_version":status.version})).await;
                            }
                            last_error = Some(message.clone());
                            status.last_error = Some(message);
                        }
                    }
                    *self.feed.lock().expect("feed status lock") = status;
                }
                tokio::time::sleep(Duration::from_secs(settings.poll_seconds)).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shipped() -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../policies/guardrails.yaml"),
        )
        .unwrap()
    }

    #[test]
    fn shipped_guardrails_parse_and_assign_profiles() {
        let g = Guardrails::parse(&shipped()).unwrap();
        assert_eq!(g.profile_for("invoice-processing").0, "strict");
        assert_eq!(g.profile_for("no-such-use-case").0, "balanced");
        assert_eq!(g.profile_for("market-research").1.input_action("pesel"), Action::Allow);
        assert_eq!(g.session_budget("model-onboarding").tokens, 3000);
        assert_eq!(g.action_cost("crm.read"), 10.0);
    }

    #[test]
    fn invalid_edits_are_rejected_with_a_reason() {
        let typo = shipped().replace("pesel: redact", "pesel: redakt");
        assert!(Guardrails::parse(&typo).is_err());
        let unknown = shipped().replace("default: balanced", "default: lenient");
        assert!(format!("{:#}", Guardrails::parse(&unknown).unwrap_err()).contains("lenient"));
        let inverted = shipped().replace("review_at: 0.60", "review_at: 0.95");
        assert!(Guardrails::parse(&inverted).is_err());
    }

    #[test]
    fn model_costs_follow_token_or_compute_pricing() {
        let g = Guardrails::parse(&shipped()).unwrap();
        let sonnet = g.model("claude-sonnet").unwrap();
        assert!((model_cost(sonnet, 1000, 1000, 9.0) - 1.8).abs() < 1e-9);
        let local = g.model("mock-llm").unwrap();
        assert!((model_cost(local, 1000, 1000, 1.5) - 3.0).abs() < 1e-9);
        assert_eq!(estimate_tokens("abcdefgh"), 2);
    }

    #[test]
    fn the_shipped_policy_directory_loads() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../policies");
        let state = PolicyState::load(&dir).expect("policies load");
        assert_eq!(state.version.len(), 12);
        assert!(state.files.iter().any(|(path, _)| path == "guardrails.yaml"));
    }
}
