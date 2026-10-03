use crate::{
    MODEL_LABEL,
    auth::Claims,
    connectors::{SecurityAnalyzer, hash},
    content::{self, GuardedName},
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
        let detect_started = Instant::now();
        let findings = content::detect(text_value, &guarded_names(&entities, ceiling));
        let detected: Vec<&str> = content::CLASSES
            .into_iter()
            .filter(|class| findings.iter().any(|finding| finding.class == *class))
            .collect();
        append_span(
            &mut trace,
            "information_tier",
            if detected.is_empty() {
                "passed"
            } else {
                "denied"
            },
            "Deterministic detectors: card (Luhn), IBAN (mod-97), PESEL (checksum), keys, resource names",
            json!({"detected":detected,"findings":findings}),
            detect_started.elapsed().as_secs_f64() * 1000.0,
        );
        let engine = self.engine().await?;
        let mut context = json!({"detected":detected,"now":Utc::now().timestamp()});
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
            "Cedar decides from the detected classes",
            json!({"detected":detected}),
            cedar_started.elapsed().as_secs_f64() * 1000.0,
        );
        trace["deterministic_decision"] = json!(deterministic.decision());
        let mut outcome = deterministic.clone();
        if deterministic.deny {
            append_span(
                &mut trace,
                "ai_analysis",
                "skipped",
                "Deterministic deny cannot be loosened",
                json!({"model_label":MODEL_LABEL}),
                0.0,
            );
        } else {
            let analysis_started = Instant::now();
            match self.llm.analyze(&json!({"human_input":text_value})).await {
                Ok(analysis) => {
                    trace["analyzer"] = analysis.clone();
                    context["analysis"] =
                        json!({"verdict":analysis["verdict"],"analyzer":MODEL_LABEL});
                    outcome =
                        engine.deciding_outcome(deterministic.clone().tighten(evaluate(context)));
                }
                Err(error) => {
                    trace["analyzer"] = json!({"verdict":"unavailable","rationale":format!("Analyzer unavailable: {error}; the deterministic decision stands"),"model_label":MODEL_LABEL});
                }
            }
            trace["ai_tightened"] = json!(outcome.deny != deterministic.deny);
            let analysis = trace["analyzer"].clone();
            append_span(
                &mut trace,
                "ai_analysis",
                if outcome.deny { "denied" } else { "passed" },
                "Analyzer can only add a deny",
                analysis,
                analysis_started.elapsed().as_secs_f64() * 1000.0,
            );
        }
        self.render_input_reasons(&mut trace, &outcome, &engine, &session_entity);
        let allowed = outcome.decision() == "allow";
        trace["executed"] = json!(allowed);
        append_span(
            &mut trace,
            "decision",
            if allowed { "passed" } else { "denied" },
            if allowed {
                "Message passes to the agent"
            } else {
                "Message stays with the human; the model never sees it"
            },
            json!({"detected":detected}),
            0.0,
        );
        let mut execution_context = json!({"organization":{"id":"acme","name":"Acme Logistics"},"human":trace["human"],"agent":trace["agent"],"use_case":trace["use_case"],"session":session,"input":{"characters":text_value.chars().count(),"sha256":hash(&json!(text_value)),"findings":findings,"detected":detected}});
        if allowed {
            execution_context["input"]["preview"] =
                json!(text_value.chars().take(160).collect::<String>());
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
