use anyhow::{Context as _, Result, bail};
use cedar_policy::{
    Authorizer, Context, Decision, Effect, Entities, EntityUid, PolicyId, PolicySet, Request,
    Schema, SlotId, ValidationMode, Validator,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
    str::FromStr,
};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    pub deny: bool,
    pub approval: bool,
    pub step_up: bool,
    pub policy_ids: BTreeSet<String>,
    pub control_ids: BTreeSet<String>,
    pub reasons: BTreeSet<String>,
}

impl Outcome {
    pub fn denied(reason: impl Into<String>) -> Self {
        Self {
            deny: true,
            reasons: BTreeSet::from([reason.into()]),
            control_ids: BTreeSet::from(["CTL-POL-001".into()]),
            ..Self::default()
        }
    }

    pub fn decision(&self) -> &'static str {
        if self.deny {
            "deny"
        } else if self.approval {
            "require_approval"
        } else if self.step_up {
            "require_step_up"
        } else {
            "allow"
        }
    }

    pub fn reference_label(&self) -> &'static str {
        if !self.deny && self.approval && self.step_up {
            "require_approval+step_up"
        } else {
            self.decision()
        }
    }

    pub fn tighten(mut self, other: Self) -> Self {
        self.deny |= other.deny;
        self.approval |= other.approval;
        self.step_up |= other.step_up;
        self.policy_ids.extend(other.policy_ids);
        self.control_ids.extend(other.control_ids);
        self.reasons.extend(other.reasons);
        self
    }
}

#[derive(Clone)]
pub struct Engine {
    pub schema: Schema,
    pub policies: PolicySet,
}

pub struct ReasonTemplate {
    pub policy_id: String,
    pub control_id: String,
    pub text: String,
}

impl Engine {
    pub fn deciding_outcome(&self, mut outcome: Outcome) -> Outcome {
        let deciding = self.deciding_reasons(&outcome);
        let policy_ids: BTreeSet<_> = deciding
            .iter()
            .map(|reason| reason.policy_id.clone())
            .collect();
        let control_ids: BTreeSet<_> = deciding
            .iter()
            .map(|reason| reason.control_id.clone())
            .collect();
        let removed_controls: BTreeSet<_> = outcome
            .policy_ids
            .iter()
            .filter(|id| !policy_ids.contains(*id))
            .filter_map(|id| self.annotation(id, "control"))
            .collect();
        let old_ids = outcome.policy_ids.clone();
        outcome.policy_ids.retain(|id| policy_ids.contains(id));
        outcome
            .control_ids
            .retain(|id| control_ids.contains(id) || !removed_controls.contains(id));
        outcome
            .reasons
            .retain(|reason| !old_ids.contains(reason) || policy_ids.contains(reason));
        if outcome.deny {
            outcome.approval = false;
            outcome.step_up = false;
        }
        outcome
    }

    pub fn deciding_reasons(&self, outcome: &Outcome) -> Vec<ReasonTemplate> {
        outcome
            .policy_ids
            .iter()
            .filter_map(|id| {
                let policy = self.policies.policy(&PolicyId::new(id))?;
                let deciding = if outcome.deny {
                    policy.effect() == Effect::Forbid && policy.annotation("outcome").is_none()
                } else if outcome.approval || outcome.step_up {
                    policy.annotation("outcome").is_some()
                } else {
                    policy.effect() == Effect::Permit
                };
                deciding.then(|| ReasonTemplate {
                    policy_id: id.clone(),
                    control_id: self
                        .annotation(id, "control")
                        .unwrap_or_else(|| "CTL-POL-001".into()),
                    text: self.annotation(id, "reason").unwrap_or_default(),
                })
            })
            .collect()
    }

    pub fn load(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        let (schema, _) = Schema::from_cedarschema_str(&std::fs::read_to_string(
            dir.join("schema.cedarschema"),
        )?)?;
        let mut paths: Vec<_> = std::fs::read_dir(dir)?
            .map(|entry| entry.map(|e| e.path()))
            .collect::<std::io::Result<_>>()?;
        paths.retain(|path| path.extension().is_some_and(|ext| ext == "cedar"));
        paths.sort();
        let mut source = String::new();
        for path in paths {
            source.push_str(&std::fs::read_to_string(path)?);
            source.push('\n');
        }
        let parsed = PolicySet::from_str(&source)?;
        let mut policies = PolicySet::new();
        for template in parsed.templates() {
            let id = template.annotation("id").context("template missing @id")?;
            template
                .annotation("control")
                .context("template missing @control")?;
            policies.add_template(template.new_id(PolicyId::new(id)))?;
        }
        for policy in parsed.policies() {
            let id = policy.annotation("id").context("policy missing @id")?;
            policy
                .annotation("control")
                .context("policy missing @control")?;
            if policy.effect() == Effect::Permit && policy.to_string().contains("analysis") {
                bail!("permit policy {id} references analysis");
            }
            policies.add(policy.new_id(PolicyId::new(id)))?;
        }
        let engine = Self { schema, policies };
        engine.validate()?;
        Ok(engine)
    }

    pub fn validate(&self) -> Result<()> {
        let result =
            Validator::new(self.schema.clone()).validate(&self.policies, ValidationMode::Strict);
        let errors: Vec<_> = result
            .validation_errors()
            .map(ToString::to_string)
            .collect();
        if !errors.is_empty() {
            bail!("strict Cedar validation: {}", errors.join("; "));
        }
        Ok(())
    }

    pub fn validate_entities(&self, entities: Value) -> Result<()> {
        Entities::from_json_value(entities, Some(&self.schema))?;
        Ok(())
    }

    pub fn link(&mut self, template: &str, id: &str, principal: &str) -> Result<()> {
        self.policies.link(
            PolicyId::new(template),
            PolicyId::new(id),
            HashMap::from([(SlotId::principal(), EntityUid::from_str(principal)?)]),
        )?;
        self.validate()
    }

    /// An annotation of a static or template-linked policy, or of a template.
    pub fn annotation(&self, policy_id: &str, key: &str) -> Option<String> {
        let id = PolicyId::new(policy_id);
        match self.policies.policy(&id) {
            Some(policy) => policy.annotation(key).map(str::to_owned),
            None => self
                .policies
                .template(&id)
                .and_then(|template| template.annotation(key).map(str::to_owned)),
        }
    }

    pub fn evaluate(
        &self,
        principal: &str,
        action: &str,
        resource: &str,
        entities: Value,
        context: Value,
    ) -> Outcome {
        self.try_evaluate(principal, action, resource, entities, context)
            .unwrap_or_else(|error| Outcome::denied(format!("Cedar input error: {error}")))
    }

    fn try_evaluate(
        &self,
        principal: &str,
        action: &str,
        resource: &str,
        entities: Value,
        context: Value,
    ) -> Result<Outcome> {
        let principal = EntityUid::from_str(principal)?;
        let action = EntityUid::from_str(action)?;
        let resource = EntityUid::from_str(resource)?;
        let entities = Entities::from_json_value(entities, Some(&self.schema))?;
        let run = |context: Value| -> Result<_> {
            let context = Context::from_json_value(context, Some((&self.schema, &action)))?;
            let request = Request::new(
                principal.clone(),
                action.clone(),
                resource.clone(),
                context,
                Some(&self.schema),
            )?;
            Ok(Authorizer::new().is_authorized(&request, &self.policies, &entities))
        };
        let response = run(context.clone())?;
        let errors: Vec<_> = response
            .diagnostics()
            .errors()
            .map(ToString::to_string)
            .collect();
        if !errors.is_empty() {
            return Ok(Outcome::denied(format!(
                "Cedar evaluation error: {}",
                errors.join("; ")
            )));
        }
        let mut outcome = Outcome::default();
        for id in response.diagnostics().reason() {
            outcome.policy_ids.insert(id.to_string());
            outcome.reasons.insert(id.to_string());
            if let Some(policy) = self.policies.policy(id) {
                if let Some(control) = policy.annotation("control") {
                    outcome.control_ids.insert(control.into());
                }
                if response.decision() == Decision::Deny {
                    match policy.annotation("outcome") {
                        Some("require_approval") => outcome.approval = true,
                        Some("require_step_up") => outcome.step_up = true,
                        _ => outcome.deny = true,
                    }
                }
            } else {
                outcome.deny = true;
            }
        }
        if response.decision() == Decision::Allow {
            return Ok(outcome);
        }
        if outcome.policy_ids.is_empty() {
            return Ok(Outcome::denied("default-deny (no permit)"));
        }
        if outcome.deny {
            outcome.policy_ids.retain(|id| {
                self.policies
                    .policy(&PolicyId::new(id))
                    .is_none_or(|policy| policy.annotation("outcome").is_none())
            });
            outcome.control_ids = outcome
                .policy_ids
                .iter()
                .filter_map(|id| {
                    self.policies
                        .policy(&PolicyId::new(id))
                        .and_then(|policy| policy.annotation("control"))
                        .map(str::to_owned)
                })
                .collect();
            outcome.reasons = outcome.policy_ids.clone();
            outcome.approval = false;
            outcome.step_up = false;
            return Ok(outcome);
        }
        let mut discharged = context;
        discharged["approval"] = json!({"granted":true, "stepUp":true});
        let second = run(discharged)?;
        if second.decision() != Decision::Allow || second.diagnostics().errors().next().is_some() {
            outcome.deny = true;
            outcome
                .reasons
                .insert("obligations cannot discharge a missing permit".into());
        }
        Ok(outcome)
    }
}

pub fn effective(delegated: &[String], permitted: &[String]) -> BTreeSet<String> {
    delegated
        .iter()
        .filter(|cap| permitted.contains(cap))
        .cloned()
        .collect()
}

pub fn uid(kind: &str, id: &str) -> String {
    format!(
        "Betsee::{kind}::{}",
        serde_json::to_string(id).expect("string serializes")
    )
}
pub fn entity_ref(kind: &str, id: &str) -> Value {
    json!({"__entity":{"type":format!("Betsee::{kind}"),"id":id}})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_reference_cases_conform() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let engine = Engine::load(root.join("policies")).unwrap();
        let fixture: Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("policies/tests/acme-cases.json")).unwrap(),
        )
        .unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let mut engine = engine.clone();
            let mut entities = fixture["entities"].as_array().unwrap().clone();
            if let Some(patches) = case["patch"].as_array() {
                for patch in patches {
                    entities.retain(|e| e["uid"] != patch["uid"]);
                    entities.push(patch.clone());
                }
            }
            if let Some(links) = case["links"].as_array() {
                for link in links {
                    engine
                        .link(
                            link["template"].as_str().unwrap(),
                            link["id"].as_str().unwrap(),
                            link["principal"].as_str().unwrap(),
                        )
                        .unwrap();
                }
            }
            let mut context = case["context"].clone();
            let analysis = context.as_object_mut().unwrap().remove("analysis");
            let evaluate = |ctx| {
                engine.evaluate(
                    case["principal"].as_str().unwrap(),
                    case["action"].as_str().unwrap(),
                    case["resource"].as_str().unwrap(),
                    Value::Array(entities.clone()),
                    ctx,
                )
            };
            let mut outcome = evaluate(context.clone());
            if !outcome.deny
                && let Some(analysis) = analysis
            {
                context["analysis"] = analysis;
                outcome = outcome.tighten(evaluate(context));
            }
            outcome = engine.deciding_outcome(outcome);
            assert_eq!(
                outcome.reference_label(),
                case["expect"].as_str().unwrap(),
                "{}: {:?}",
                case["name"],
                outcome
            );
            if let Some(reason) = case["expect_reason"].as_str() {
                assert!(
                    outcome.policy_ids.contains(reason),
                    "{}: {:?}",
                    case["name"],
                    outcome
                );
            }
            if case["step"] == "att.1" {
                assert!(outcome.control_ids.contains("CTL-RUN-004"));
            }
            if case["step"] == "act3.s2" {
                assert_eq!(outcome.control_ids, BTreeSet::from(["CTL-TIER-002".into()]));
            }
        }
    }

    #[test]
    fn composition_keeps_every_obligation_and_deny() {
        for deny in [false, true] {
            for approval in [false, true] {
                for step_up in [false, true] {
                    for ai_deny in [false, true] {
                        for ai_approval in [false, true] {
                            for ai_step in [false, true] {
                                let first = Outcome {
                                    deny,
                                    approval,
                                    step_up,
                                    ..Outcome::default()
                                };
                                let result = first.tighten(Outcome {
                                    deny: ai_deny,
                                    approval: ai_approval,
                                    step_up: ai_step,
                                    ..Outcome::default()
                                });
                                assert_eq!(result.deny, deny || ai_deny);
                                assert_eq!(result.approval, approval || ai_approval);
                                assert_eq!(result.step_up, step_up || ai_step);
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn malformed_context_fails_closed() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let engine = Engine::load(root.join("policies")).unwrap();
        assert!(
            engine
                .evaluate(
                    &uid("Agent", "invoice-assistant"),
                    &uid("Action", "crm.read"),
                    &uid("Resource", "unknown"),
                    json!([]),
                    json!({})
                )
                .deny
        );
    }
}
