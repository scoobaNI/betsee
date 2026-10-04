use crate::{
    MODEL_LABEL,
    auth::Claims,
    connectors::hash,
    content::{self, GuardedName},
    guard::Kind,
    guardrails::Action,
    pipeline::{Gateway, append_span, render_template, tier},
    store::{find_entity, now, text},
};
use anyhow::{Context, Result};
use betsee_decision::{Outcome, uid};
use chrono::Utc;
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Instant};

/// Names a person could type for each catalogued resource above the session ceiling: the full id,
/// the id below its top-level folder, and a file's own name.
fn guarded_names(entities: &Value, ceiling: i64) -> Vec<GuardedName> {
    entities
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entity| entity["uid"]["type"] == "Betsee::Resource")
        .filter(|entity| entity["attrs"]["tier"].as_i64().unwrap_or(3) > ceiling)
        .map(|entity| {
            let id = text(&entity["uid"], "id").to_owned();
            let mut needles = vec![id.clone()];
            if let Some((_, below)) = id.split_once('/') {
                needles.push(below.to_owned());
            }
            if let Some((_, name)) = id.rsplit_once('/')
                && name.contains('.')
                && name.len() >= 6
            {
                needles.push(name.to_owned());
            }
            needles.dedup();
            GuardedName {
                resource_id: id,
                needles,
            }
        })
        .collect()
}

impl Gateway {
    pub async fn check_input(
        &self,
        claims: &Claims,
        human: &Value,
        session: &Value,
        text_value: &str,
        requested_trace: &str,
    ) -> Result<Value> {
        let started = Instant::now();
        let (trace_id, caller_trace_id) = self.unique_trace(requested_trace).await?;
        let entities = self.store.entities().await?;
        let session_id = text(session, "id");
        let session_entity = find_entity(&entities, "AgentSession", session_id)
            .context("session entity missing")?
            .clone();
        let agent_id = text(session, "agent_id");
        let ceiling = session_entity["attrs"]["tierCeiling"].as_i64().unwrap_or(0);
        let mut trace = json!({"trace_id":trace_id,"caller_trace_id":caller_trace_id,"occurred_at":now(),"agent":crate::pipeline::agent_ref(find_entity(&entities,"Agent",agent_id),agent_id),"session_id":session_id,"human":session["human"],"use_case":session["use_case"],"capability":"input.submit","resource":{"type":"chat_input","id":format!("chat/{session_id}"),"tier":tier(ceiling)},"tool":null,"decision":"deny","deterministic_decision":"deny","analyzer":{"verdict":"skipped","rationale":"Deterministic deny is not negotiable","model_label":MODEL_LABEL},"ai_tightened":false,"control_ids":[],"policy_ids":[],"reasons":[],"approval_state":"none","latency_ms":0,"executed":false,"execution":"forwarded","output":null,"obligations":[],"step_up_required":false,"spans":[],"execution_context":{}});
        append_span(
            &mut trace,
            "authenticate",
            "passed",
            "Human token signature, issuer, audience, expiry and identity verified",
            json!({"azp":claims.azp,"sub":claims.sub}),
            0.0,
        );
        append_span(
            &mut trace,
            "resolve_context",
            "passed",
            "Gateway resolves the session, its human and its tier ceiling from PostgreSQL",
            json!({"organization":"acme","session_id":session_id}),
            0.0,
        );
        append_span(
            &mut trace,
            "identity",
            "passed",
            "Typing human resolved from the verified token",
            json!({"human":human["username"]}),
            0.0,
        );
        let state = self.state();
        let threat_set = self.threats();
        trace["analyzer"]["model_label"] = json!(crate::guard::label(&state));
        let use_case_id = text(&session["use_case"], "id");
        let (profile_name, profile) = state.guardrails.profile_for(use_case_id);
        let detect_started = Instant::now();
        let findings = content::detect_all(text_value, &guarded_names(&entities, ceiling));
        let mut blocking: Vec<&str> = Vec::new();
        let mut redact: Vec<&str> = Vec::new();
        let mut recorded_only: Vec<&content::Finding> = Vec::new();
        for finding in &findings {
            match profile.input_action(finding.class) {
                Action::Block => blocking.push(finding.class),
                Action::Redact => redact.push(finding.class),
                Action::Allow => recorded_only.push(finding),
            }
        }
        blocking.sort_unstable();
        blocking.dedup();
        let (forwarded, applied) = content::redact(text_value, &findings, &redact);
        let detected: Vec<&str> = content::INPUT_CLASSES
            .into_iter()
            .filter(|class| findings.iter().any(|finding| finding.class == *class))
            .collect();
        append_span(
            &mut trace,
            "information_tier",
            if blocking.is_empty() {
                "passed"
            } else {
                "denied"
            },
            "Deterministic detectors (card by Luhn, IBAN by mod-97, PESEL by checksum, keys, email, phone, resource names) under the use case's guardrail profile",
            json!({"profile":profile_name,"detected":detected,"blocking":blocking,"redacted":applied.iter().map(|f| f.class).collect::<Vec<_>>(),"recorded":recorded_only.iter().map(|f| f.class).collect::<Vec<_>>(),"findings":findings}),
            detect_started.elapsed().as_secs_f64() * 1000.0,
        );
        let signatures_started = Instant::now();
        let mut hits = threat_set.scan_text("prompt", text_value);
        crate::threats::dedup(&mut hits);
        let threat = json!({"block":hits.iter().any(|h| h.action == "block"),"review":hits.iter().any(|h| h.action == "review")});
        append_span(
            &mut trace,
            "threat_signatures",
            if threat["block"] == true { "denied" } else { "passed" },
            "Known-exploit signatures: shipped baseline merged with the external feed",
            json!({"signatures":hits,"signature_set":threat_set.len()}),
            signatures_started.elapsed().as_secs_f64() * 1000.0,
        );
        let engine = self.engine().await?;
        let mut context = json!({"detected":blocking,"now":Utc::now().timestamp(),"threat":threat});
        let evaluate = |context: Value| {
            engine.evaluate(
                &uid("Human", text(human, "username")),
                &uid("Action", "input.submit"),
                &uid("AgentSession", session_id),
                entities.clone(),
                context,
            )
        };
        let cedar_started = Instant::now();
        let deterministic = engine.deciding_outcome(evaluate(context.clone()));
        append_span(
            &mut trace,
            "cedar_authz",
            if deterministic.deny {
                "denied"
            } else {
                "passed"
            },
            "Cedar decides from the blocking classes and the signature match",
            json!({"detected":blocking,"threat":context["threat"]}),
            cedar_started.elapsed().as_secs_f64() * 1000.0,
        );
        trace["deterministic_decision"] = json!(deterministic.decision());
        let mut outcome = deterministic.clone();
        let mut flagged = threat["review"] == true;
        if deterministic.deny {
            append_span(
                &mut trace,
                "ai_analysis",
                "skipped",
                "Deterministic deny cannot be loosened",
                json!({"model_label":crate::guard::label(&state)}),
                0.0,
            );
        } else {
            let analysis_started = Instant::now();
            let semantic = self
                .semantic(&state, profile_name, profile, text_value, Kind::Input)
                .await;
            trace["analyzer"] = semantic.record.clone();
            context["analysis"] = json!({"verdict":semantic.verdict,"analyzer":crate::guard::label(&state),"score":(semantic.score*100.0).round() as i64});
            outcome = engine.deciding_outcome(deterministic.clone().tighten(evaluate(context)));
            if semantic.classifier_raised {
                outcome.control_ids.insert("CTL-AI-002".into());
            }
            flagged |= semantic.verdict == "suspicious";
            trace["ai_tightened"] = json!(outcome.deny != deterministic.deny);
            let analysis = trace["analyzer"].clone();
            append_span(
                &mut trace,
                "ai_analysis",
                if outcome.deny {
                    "denied"
                } else if semantic.verdict == "suspicious" {
                    "tightened"
                } else {
                    "passed"
                },
                "Semantic analysis can only add a deny or mark the session as holding untrusted input",
                analysis,
                analysis_started.elapsed().as_secs_f64() * 1000.0,
            );
        }
        self.render_input_reasons(&mut trace, &outcome, &engine, &session_entity);
        let allowed = outcome.decision() == "allow";
        trace["executed"] = json!(allowed);
        // A message that passes but reads like an injection marks the session as holding untrusted
        // input, so its high-impact actions need a person (CTL-PROV-001).
        if allowed && flagged && session_entity["attrs"]["untrustedInput"] != true {
            let mut next = session_entity.clone();
            next["attrs"]["untrustedInput"] = json!(true);
            self.store.put_entity(&next).await?;
        }
        trace["guardrails"] = json!({"profile":profile_name,"policy_version":state.version,"redactions":applied.iter().map(|f| json!({"class":f.class,"masked":f.masked})).collect::<Vec<_>>(),"recorded":recorded_only.iter().map(|f| json!({"class":f.class,"masked":f.masked})).collect::<Vec<_>>(),"signatures":hits,"flagged_untrusted":allowed && flagged});
        append_span(
            &mut trace,
            "decision",
            if allowed { "passed" } else { "denied" },
            if allowed && !applied.is_empty() {
                "Message passes to the agent with the profile's redactions applied"
            } else if allowed {
                "Message passes to the agent"
            } else {
                "Message stays with the human; the model never sees it"
            },
            json!({"detected":detected,"redactions":applied.len(),"flagged_untrusted":allowed && flagged}),
            0.0,
        );
        let mut execution_context = json!({"organization":{"id":"acme","name":"Acme Logistics"},"human":trace["human"],"agent":trace["agent"],"use_case":trace["use_case"],"session":session,"input":{"characters":text_value.chars().count(),"sha256":hash(&json!(text_value)),"findings":findings,"detected":detected},"guardrails":trace["guardrails"]});
        if allowed {
            execution_context["input"]["preview"] =
                json!(forwarded.chars().take(160).collect::<String>());
        }
        trace["execution_context"] = execution_context;
        trace["latency_ms"] = json!(started.elapsed().as_secs_f64() * 1000.0);
        append_span(
            &mut trace,
            "audit",
            "passed",
            "Input check persisted with masked findings only",
            json!({}),
            0.0,
        );
        let mut recorded = self
            .store
            .audit(&trace, "input_check", Some("action.decided"))
            .await?;
        recorded["findings"] = json!(findings);
        if allowed {
            recorded["forwarded_text"] = json!(forwarded);
        }
        Ok(recorded)
    }

    fn render_input_reasons(
        &self,
        trace: &mut Value,
        outcome: &Outcome,
        engine: &betsee_decision::Engine,
        session: &Value,
    ) {
        trace["decision"] = json!(outcome.decision());
        trace["control_ids"] = json!(outcome.control_ids);
        trace["policy_ids"] = json!(outcome.policy_ids);
        let facts = BTreeMap::from([
            ("useCase", text(&trace["use_case"], "name").to_owned()),
            (
                "session.tierCeiling",
                tier(session["attrs"]["tierCeiling"].as_i64().unwrap_or(0)).to_owned(),
            ),
        ]);
        let mut reasons: Vec<Value> = engine
            .deciding_reasons(outcome)
            .into_iter()
            .map(|reason| {
                json!({"policy_id":reason.policy_id,"control_id":reason.control_id,"text":render_template(&reason.text,&facts,"the input filter refused this message")})
            })
            .collect();
        for reason in &outcome.reasons {
            if !outcome.policy_ids.contains(reason) {
                reasons.push(json!({"policy_id":null,"control_id":"CTL-POL-001","text":reason}));
            }
        }
        trace["reasons"] = json!(reasons);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guarded_names_cover_only_resources_above_the_ceiling() {
        let entities = json!([
            {"uid":{"type":"Betsee::Resource","id":"workspace/hr/salaries-2026.csv"},"attrs":{"kind":"file","tier":3,"external":false},"parents":[]},
            {"uid":{"type":"Betsee::Resource","id":"workspace/handbook/onboarding.md"},"attrs":{"kind":"file","tier":1,"external":false},"parents":[]},
        ]);
        let names = guarded_names(&entities, 1);
        assert_eq!(names.len(), 1);
        assert_eq!(
            names[0].needles,
            [
                "workspace/hr/salaries-2026.csv",
                "hr/salaries-2026.csv",
                "salaries-2026.csv"
            ]
        );
    }
}

/// Which way a file crosses the agent workspace boundary.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FileDirection {
    Intake,
    Release,
}

impl Gateway {
    /// CTL-FILE-001: scan a file a human uploads to, or downloads from, the agent workspace.
    #[allow(clippy::too_many_arguments)]
    pub async fn check_file(
        &self,
        claims: &Claims,
        human: &Value,
        session: &Value,
        direction: FileDirection,
        name: &str,
        bytes: &[u8],
        requested: Option<&str>,
        requested_trace: &str,
    ) -> Result<Value> {
        let started = Instant::now();
        let (trace_id, caller_trace_id) = self.unique_trace(requested_trace).await?;
        let entities = self.store.entities().await?;
        let session_id = text(session, "id");
        let session_entity = find_entity(&entities, "AgentSession", session_id)
            .context("session entity missing")?
            .clone();
        let agent_id = text(session, "agent_id");
        let ceiling = session_entity["attrs"]["tierCeiling"].as_i64().unwrap_or(0);
        let mut initial = Outcome::default();
        // Intake lands in workspace/uploads under a safe name; release names a catalogued file.
        let (resource_id, cedar_resource, tier_rank) = match direction {
            FileDirection::Intake => {
                let safe = crate::files::safe_name(name).unwrap_or_else(|| "upload".into());
                let rank = requested
                    .and_then(crate::pipeline::tier_rank)
                    .unwrap_or(ceiling.min(1));
                (
                    format!("workspace/uploads/{safe}"),
                    "workspace/uploads".to_owned(),
                    rank,
                )
            }
            FileDirection::Release => {
                let found = find_entity(&entities, "Resource", name)
                    .filter(|resource| resource["attrs"]["kind"] == "file");
                if found.is_none() {
                    initial = Outcome::denied("unknown file: not in the workspace catalogue");
                }
                let rank = found
                    .and_then(|resource| resource["attrs"]["tier"].as_i64())
                    .unwrap_or(3);
                (name.to_owned(), name.to_owned(), rank)
            }
        };
        let capability = match direction {
            FileDirection::Intake => "file.submit",
            FileDirection::Release => "file.release",
        };
        let mut trace = json!({"trace_id":trace_id,"caller_trace_id":caller_trace_id,"occurred_at":now(),"agent":crate::pipeline::agent_ref(find_entity(&entities,"Agent",agent_id),agent_id),"session_id":session_id,"human":session["human"],"use_case":session["use_case"],"capability":capability,"resource":{"type":"file","id":resource_id,"tier":tier(tier_rank)},"tool":null,"decision":"deny","deterministic_decision":"deny","analyzer":{"verdict":"skipped","rationale":"Files are decided by deterministic scanning only","model_label":MODEL_LABEL},"ai_tightened":false,"control_ids":[],"policy_ids":[],"reasons":[],"approval_state":"none","latency_ms":0,"executed":false,"execution":"forwarded","output":null,"obligations":[],"step_up_required":false,"spans":[],"execution_context":{}});
        append_span(
            &mut trace,
            "authenticate",
            "passed",
            "Human token signature, issuer, audience, expiry and identity verified",
            json!({"azp":claims.azp,"sub":claims.sub}),
            0.0,
        );
        append_span(
            &mut trace,
            "resolve_context",
            "passed",
            "Gateway resolves the session, the file label and the workspace catalogue",
            json!({"session_id":session_id,"direction":capability}),
            0.0,
        );
        let scan_started = Instant::now();
        let mut scan = crate::files::scan(name, bytes, &guarded_names(&entities, ceiling));
        // CTL-FILE-002 and CTL-SIG-001: what the file would do when loaded, and its hash.
        let (hits, inspection) = self.threats().scan_artifact("file", bytes, &scan.sha256);
        for hit in &hits {
            let class = match hit.category.as_str() {
                "unsafe_deserialization" => Some("unsafe_deserialization"),
                "supply_chain" => Some("model_code_execution"),
                _ => None,
            };
            if let Some(class) = class
                && !scan.classes.contains(&class)
            {
                scan.classes.push(class);
            }
        }
        let threat = json!({"block":hits.iter().any(|h| h.action == "block"),"review":hits.iter().any(|h| h.action == "review")});
        append_span(
            &mut trace,
            "information_tier",
            if scan.classes.is_empty() {
                "passed"
            } else {
                "denied"
            },
            "File scan: type from bytes, EICAR, text extraction, CTL-IN-001 detectors, pickle and model inspection, threat signatures",
            json!({"kind":scan.kind,"size":scan.size,"sha256":scan.sha256,"detected":scan.classes,"findings":scan.findings,"artifact":inspection,"signatures":hits}),
            scan_started.elapsed().as_secs_f64() * 1000.0,
        );
        let engine = self.engine().await?;
        let cedar_started = Instant::now();
        let outcome = engine.deciding_outcome(
            engine
                .evaluate(
                    &uid("Human", text(human, "username")),
                    &uid("Action", capability),
                    &uid("Resource", &cedar_resource),
                    entities.clone(),
                    json!({"session":betsee_decision::entity_ref("AgentSession",session_id),"detected":scan.classes,"tier":tier_rank,"now":Utc::now().timestamp(),"threat":threat}),
                )
                .tighten(initial),
        );
        append_span(
            &mut trace,
            "cedar_authz",
            if outcome.deny { "denied" } else { "passed" },
            "Cedar decides from the scan classes and the file tier",
            json!({"detected":scan.classes,"tier":tier(tier_rank)}),
            cedar_started.elapsed().as_secs_f64() * 1000.0,
        );
        trace["deterministic_decision"] = json!(outcome.decision());
        self.render_input_reasons(&mut trace, &outcome, &engine, &session_entity);
        let allowed = outcome.decision() == "allow";
        trace["executed"] = json!(allowed);
        append_span(
            &mut trace,
            "decision",
            if allowed { "passed" } else { "denied" },
            match (direction, allowed) {
                (FileDirection::Intake, true) => {
                    "File enters the agent workspace, catalogued with its tier"
                }
                (FileDirection::Intake, false) => {
                    "File stays with the human; the agent never sees it"
                }
                (FileDirection::Release, true) => "File is released to the session's human",
                (FileDirection::Release, false) => "File stays in the agent workspace",
            },
            json!({}),
            0.0,
        );
        if allowed && direction == FileDirection::Intake {
            self.store
                .put_entity(&json!({"uid":{"type":"Betsee::Resource","id":resource_id},"attrs":{"kind":"file","tier":tier_rank,"external":false},"parents":[{"type":"Betsee::Tool","id":"runtime-files"}]}))
                .await?;
        }
        trace["execution_context"] = json!({"organization":{"id":"acme","name":"Acme Logistics"},"human":trace["human"],"agent":trace["agent"],"use_case":trace["use_case"],"session":session,"file":{"name":name,"resource_id":resource_id,"kind":scan.kind,"size":scan.size,"sha256":scan.sha256,"scanned_characters":scan.scanned_characters,"findings":scan.findings,"detected":scan.classes}});
        trace["latency_ms"] = json!(started.elapsed().as_secs_f64() * 1000.0);
        append_span(
            &mut trace,
            "audit",
            "passed",
            "File check persisted with the hash and masked findings only",
            json!({}),
            0.0,
        );
        let mut recorded = self
            .store
            .audit(&trace, "file_check", Some("action.decided"))
            .await?;
        recorded["findings"] = json!(scan.findings);
        recorded["file"] = json!({"resource_id":resource_id,"name":name,"kind":scan.kind,"size":scan.size,"sha256":scan.sha256,"artifact":inspection,"signatures":hits});
        Ok(recorded)
    }
}
