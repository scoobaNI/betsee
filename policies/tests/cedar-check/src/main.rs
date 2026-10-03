// Reference checker for the Betsee Cedar policies (test oracle, not the Gateway).
// 1. Validates policies/schema.cedarschema + policies/*.cedar in strict mode, re-keyed by @id.
// 2. Enforces the analyzer invariant: no permit policy reads context.analysis.
// 3. Runs policies/tests/acme-cases.json through the composition in
//    docs/security/adr-0001-policy-engine-cedar.md ("Gateway contract for F09", step 4).
use cedar_policy::*;
use std::str::FromStr;

fn load_policies(dir: &str) -> PolicySet {
    let mut text = String::new();
    let mut paths: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path())
        .filter(|p| p.extension().map(|x| x == "cedar").unwrap_or(false)).collect();
    paths.sort();
    for p in paths { text.push_str(&std::fs::read_to_string(&p).unwrap()); text.push('\n'); }
    let parsed = PolicySet::from_str(&text).unwrap_or_else(|e| { eprintln!("{:?}", miette_like(&e)); std::process::exit(2) });
    let mut out = PolicySet::new();
    for t in parsed.templates() {
        let id = t.annotation("id").unwrap_or_else(|| { eprintln!("template without @id"); std::process::exit(2) });
        out.add_template(t.new_id(PolicyId::new(id))).unwrap_or_else(|e| { eprintln!("duplicate id {id}: {e}"); std::process::exit(2) });
    }
    for p in parsed.policies() {
        let id = p.annotation("id").unwrap_or_else(|| { eprintln!("policy without @id: {}", p); std::process::exit(2) });
        out.add(p.new_id(PolicyId::new(id))).unwrap_or_else(|e| { eprintln!("duplicate id {id}: {e}"); std::process::exit(2) });
    }
    out
}
fn miette_like<E: std::fmt::Display>(e: &E) -> String { e.to_string() }

struct Outcome { deny: bool, obligations: std::collections::BTreeSet<String>, reasons: Vec<String> }

fn label(o: &Outcome) -> String {
    if o.deny { return "deny".into() }
    let a = o.obligations.contains("require_approval");
    let s = o.obligations.contains("require_step_up");
    match (a, s) { (true, true) => "require_approval+step_up", (true, false) => "require_approval",
                   (false, true) => "require_step_up", _ => "allow" }.into()
}

fn eval(pset: &PolicySet, schema: &Schema, ents: &Entities, c: &serde_json::Value, ctx: &serde_json::Value) -> Outcome {
    let p = EntityUid::from_str(c["principal"].as_str().unwrap()).unwrap();
    let a = EntityUid::from_str(c["action"].as_str().unwrap()).unwrap();
    let r = EntityUid::from_str(c["resource"].as_str().unwrap()).unwrap();
    let auth = Authorizer::new();
    let deny = |reasons: Vec<String>| Outcome { deny: true, obligations: Default::default(), reasons };
    let run = |ctx: &serde_json::Value| -> Result<Response, String> {
        let cx = Context::from_json_value(ctx.clone(), Some((schema, &a))).map_err(|e| format!("context: {e}"))?;
        let req = Request::new(p.clone(), a.clone(), r.clone(), cx, Some(schema)).map_err(|e| format!("request: {e}"))?;
        Ok(auth.is_authorized(&req, pset, ents))
    };
    let resp = match run(ctx) { Ok(r) => r, Err(e) => return deny(vec![format!("ERR {e}")]) };
    let errs: Vec<String> = resp.diagnostics().errors().map(|e| format!("ERR {e}")).collect();
    if !errs.is_empty() { return deny(errs) }
    let reasons: Vec<String> = resp.diagnostics().reason().map(|i| i.to_string()).collect();
    if resp.decision() == Decision::Allow { return Outcome { deny: false, obligations: Default::default(), reasons } }
    let outcome = |id: &str| pset.policy(&PolicyId::new(id)).and_then(|p| p.annotation("outcome").map(|s| s.to_string()));
    let obligations: std::collections::BTreeSet<String> = reasons.iter().filter_map(|r| outcome(r)).collect();
    let hard: Vec<String> = reasons.iter().filter(|r| outcome(r).is_none()).cloned().collect();
    if reasons.is_empty() { return deny(vec!["default-deny (no permit)".into()]) }
    if !hard.is_empty() { return deny(hard) }
    // Only obligations fired: confirm a permit holds once they are discharged.
    let mut ctx2 = ctx.clone();
    ctx2["approval"] = serde_json::json!({"granted": true, "stepUp": true});
    match run(&ctx2) {
        Ok(r2) if r2.decision() == Decision::Allow && r2.diagnostics().errors().count() == 0 =>
            Outcome { deny: false, obligations, reasons },
        Ok(r2) => { let w: Vec<String> = r2.diagnostics().reason().map(|i| i.to_string()).collect();
                    deny(if w.is_empty() { vec!["default-deny (no permit)".into()] } else { w }) }
        Err(e) => deny(vec![e]),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (schema, warns) = Schema::from_cedarschema_str(&std::fs::read_to_string(&args[1]).unwrap())
        .unwrap_or_else(|e| { eprintln!("schema error: {e:?}"); std::process::exit(2) });
    for w in warns { eprintln!("schema warning: {w}"); }
    let pset = load_policies(&args[2]);
    let res = Validator::new(schema.clone()).validate(&pset, ValidationMode::Strict);
    let mut bad = false;
    for e in res.validation_errors() { eprintln!("VALIDATION ERROR: {e}"); bad = true; }
    for w in res.validation_warnings() { eprintln!("validation warning: {w}"); }
    println!("schema + {} policies + {} templates: {}", pset.policies().count(), pset.templates().count(), if bad { "INVALID" } else { "valid (strict)" });
    if bad { std::process::exit(1) }
    // Invariant: the analyzer may only tighten, so no permit policy may mention context.analysis.
    for p in pset.policies() {
        if p.effect() == Effect::Permit && p.to_string().contains("analysis") {
            eprintln!("INVARIANT: permit policy {} references the analyzer", p.id()); std::process::exit(1)
        }
    }
    if args.len() < 4 { return }
    let cases: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&args[3]).unwrap()).unwrap();
    let base = cases["entities"].as_array().unwrap().clone();
    let mut fails = 0;
    for c in cases["cases"].as_array().unwrap() {
        // A case may replace whole entities by uid (state changes: taint, quarantine, spend).
        let mut list = base.clone();
        if let Some(patch) = c.get("patch").and_then(|p| p.as_array()) {
            for pe in patch {
                list.retain(|e| e["uid"] != pe["uid"]);
                list.push(pe.clone());
            }
        }
        let mut pset = pset.clone();
        if let Some(links) = c.get("links").and_then(|l| l.as_array()) {
            for l in links {
                let slot = std::collections::HashMap::from([(SlotId::principal(), EntityUid::from_str(l["principal"].as_str().unwrap()).unwrap())]);
                pset.link(PolicyId::new(l["template"].as_str().unwrap()), PolicyId::new(l["id"].as_str().unwrap()), slot).unwrap();
            }
        }
        let ents = Entities::from_json_value(serde_json::Value::Array(list), Some(&schema))
            .unwrap_or_else(|e| { eprintln!("entities: {e}"); std::process::exit(2) });
        let ctx = &c["context"];
        let mut o = eval(&pset, &schema, &ents, c, ctx);
        if ctx.get("analysis").is_some() {
            // Composition: the analyzed outcome can only add to the deterministic one.
            let mut base = ctx.clone(); base.as_object_mut().unwrap().remove("analysis");
            let o0 = eval(&pset, &schema, &ents, c, &base);
            if o0.deny { o = o0 } else if !o.deny { o.obligations.extend(o0.obligations); }
        }
        let d = label(&o); let why = o.reasons;
        let want = c["expect"].as_str().unwrap();
        let ok = d == want && c.get("expect_reason").map(|r| why.iter().any(|w| w == r.as_str().unwrap())).unwrap_or(true);
        if !ok { fails += 1; }
        println!("{} {:<58} {:<17} {:?}", if ok { "PASS" } else { "FAIL" }, c["name"].as_str().unwrap(), d, why);
    }
    println!("{} cases, {} failed", cases["cases"].as_array().unwrap().len(), fails);
    if fails > 0 { std::process::exit(1) }
}
