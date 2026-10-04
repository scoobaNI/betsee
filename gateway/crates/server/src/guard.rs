//! Content guardrails shared by the action pipeline, the input filter and the playground:
//! semantic analysis (CTL-AI-002, optionally joined by an LLM judge), the output filter
//! (CTL-OUT-002) and model-call pricing (CTL-RUN-005).

use crate::{
    connectors::SecurityAnalyzer,
    content::{self, Finding},
    guardrails::{Action, PolicyState, Profile},
    pipeline::Gateway,
    threats::{Hit, ThreatSet, dedup},
};
use serde_json::{Value, json};
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Text a person typed: block_at refuses it, review_at marks the session untrusted.
    Input,
    /// An agent's action data: review_at asks for an approval; only the LLM judge can deny.
    Action,
    /// A model or tool result: review_at marks the session untrusted.
    Output,
}

pub struct Semantic {
    /// clean, suspicious or malicious: the value Cedar reads as context.analysis.verdict.
    pub verdict: &'static str,
    pub score: f64,
    /// The analyzer record stored on the trace.
    pub record: Value,
    /// The classifier, not only the LLM judge, raised the verdict above clean.
    pub classifier_raised: bool,
    pub judge_unavailable: bool,
}

pub fn label(state: &PolicyState) -> String {
    format!(
        "{} {} (in-Gateway classifier)",
        state.classifier.id, state.classifier.version
    )
}

/// Every string inside a JSON value, in document order, for scanning.
pub fn strings(value: &Value) -> String {
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::String(text) => out.push(text.clone()),
            Value::Array(items) => items.iter().for_each(|item| walk(item, out)),
            Value::Object(map) => map.values().for_each(|item| walk(item, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(value, &mut out);
    out.join("\n")
}

impl Gateway {
    pub async fn semantic(
        &self,
        state: &PolicyState,
        profile_name: &str,
        profile: &Profile,
        text: &str,
        kind: Kind,
    ) -> Semantic {
        let started = Instant::now();
        let classifier = state.classifier.score(text);
        let thresholds = &profile.semantic;
        let score = classifier.score;
        let mut verdict = match kind {
            Kind::Input if score >= thresholds.block_at => "malicious",
            _ if score >= thresholds.review_at => "suspicious",
            _ => "clean",
        };
        let classifier_raised = verdict != "clean";
        let classifier_ms = started.elapsed().as_secs_f64() * 1000.0;
        let mut judge = Value::Null;
        let mut judge_unavailable = false;
        if state.guardrails.semantic.llm_judge && !text.trim().is_empty() {
            match self.llm.analyze(&json!({"text": text})).await {
                Ok(analysis) => {
                    let judged = match analysis["verdict"].as_str() {
                        Some("malicious") => "malicious",
                        Some("suspicious") => "suspicious",
                        _ => "clean",
                    };
                    if rank(judged) > rank(verdict) {
                        verdict = judged;
                    }
                    judge = analysis;
                }
                Err(error) => {
                    judge_unavailable = true;
                    judge = json!({"verdict":"unavailable","rationale":format!("LLM judge unavailable: {error}")});
                }
            }
        }
        let terms: Vec<&str> = classifier.terms.iter().map(|(t, _)| t.as_str()).collect();
        let rationale = format!(
            "Classifier score {:.2} on the {} reading (profile {profile_name}: review at {:.2}, block at {:.2}){}{}{}",
            score,
            classifier.variant.replace('_', " "),
            thresholds.review_at,
            thresholds.block_at,
            if terms.is_empty() {
                String::new()
            } else {
                format!("; strongest terms: {}", terms.join(", "))
            },
            if classifier.intents.is_empty() {
                String::new()
            } else {
                format!("; intents: {}", classifier.intents.join(", "))
            },
            match judge["verdict"].as_str() {
                Some(v) => format!("; LLM judge: {v}"),
                None => String::new(),
            }
        );
        Semantic {
            verdict,
            score,
            classifier_raised,
            judge_unavailable,
            record: json!({
                "verdict": verdict,
                "rationale": rationale,
                "model_label": label(state),
                "score": (score * 1000.0).round() / 1000.0,
                "profile": profile_name,
                "thresholds": {"review_at": thresholds.review_at, "block_at": thresholds.block_at},
                "classifier": {"id": state.classifier.id, "version": state.classifier.version, "latency_ms": (classifier_ms * 100.0).round() / 100.0, "detail": classifier.to_json()},
                "llm_judge": judge,
            }),
        }
    }
}

fn rank(verdict: &str) -> u8 {
    match verdict {
        "malicious" => 2,
        "suspicious" => 1,
        _ => 0,
    }
}

/// What the output filter did to a connector result.
#[derive(Default)]
pub struct OutputReport {
    pub redactions: Vec<Finding>,
    pub recorded: Vec<Finding>,
    pub withheld: Vec<String>,
    pub hits: Vec<Hit>,
    pub untrusted: bool,
    pub semantic: Option<Value>,
}

impl OutputReport {
    pub fn to_json(&self) -> Value {
        json!({
            "redactions": self.redactions.iter().map(|f| json!({"class":f.class,"masked":f.masked})).collect::<Vec<_>>(),
            "recorded": self.recorded.iter().map(|f| json!({"class":f.class,"masked":f.masked})).collect::<Vec<_>>(),
            "withheld": self.withheld,
            "signatures": self.hits,
            "indirect_injection_suspected": self.untrusted,
            "semantic": self.semantic,
        })
    }
}

/// CTL-OUT-002: applies the profile's output actions and the output signatures to every string in
/// a connector result, in place.
pub fn filter_output(profile: &Profile, threats: &ThreatSet, value: &mut Value) -> OutputReport {
    let mut report = OutputReport::default();
    fn walk(value: &mut Value, f: &mut dyn FnMut(&mut String)) {
        match value {
            Value::String(text) => f(text),
            Value::Array(items) => items.iter_mut().for_each(|item| walk(item, f)),
            Value::Object(map) => map.values_mut().for_each(|item| walk(item, f)),
            _ => {}
        }
    }
    walk(value, &mut |text: &mut String| {
        let findings: Vec<Finding> = content::detect_all(text, &[])
            .into_iter()
            .filter(|f| content::OUTPUT_CLASSES.contains(&f.class))
            .collect();
        let mut redact: Vec<&str> = Vec::new();
        for finding in &findings {
            match profile.output_action(finding.class) {
                Action::Block => report.withheld.push(finding.class.to_owned()),
                Action::Redact => redact.push(finding.class),
                Action::Allow => report.recorded.push(finding.clone()),
            }
        }
        if !redact.is_empty() {
            let (redacted, applied) = content::redact(text, &findings, &redact);
            *text = redacted;
            report.redactions.extend(applied);
        }
        let hits = threats.scan_text("output", text);
        let mut spans: Vec<(usize, usize, String)> = hits
            .iter()
            .filter(|hit| hit.action == "block")
            .filter_map(|hit| hit.span.map(|(s, e)| (s, e, hit.id.clone())))
            .collect();
        spans.sort();
        if !spans.is_empty() {
            let mut out = String::new();
            let mut at = 0;
            for (start, end, id) in spans {
                if start < at {
                    continue;
                }
                out.push_str(&text[at..start]);
                out.push_str(&format!("[REMOVED:{id}]"));
                at = end;
            }
            out.push_str(&text[at..]);
            *text = out;
        }
        if hits.iter().any(|hit| hit.action == "review") {
            report.untrusted = true;
        }
        report.hits.extend(hits);
    });
    report.withheld.sort();
    report.withheld.dedup();
    dedup(&mut report.hits);
    report
}

/// The prompt of an llm.complete request: parameters.prompt, else parameters.content, else every
/// string in the messages.
pub fn prompt_of(parameters: &Value) -> String {
    parameters["prompt"]
        .as_str()
        .or_else(|| parameters["content"].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| strings(&parameters["messages"]))
}
