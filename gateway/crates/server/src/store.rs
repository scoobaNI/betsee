use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use std::path::Path;

#[derive(Clone)]
pub struct Store {
    pub pool: PgPool,
}

impl Store {
    pub async fn connect(url: &str) -> Result<Self> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(12)
            .connect(url)
            .await?;
        sqlx::migrate!("../../migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn seed(&self, policies: &Path) -> Result<()> {
        let fixtures: Value = serde_json::from_str(&std::fs::read_to_string(
            policies.join("tests/acme-cases.json"),
        )?)?;
        for entity in fixtures["entities"]
            .as_array()
            .context("seed entities missing")?
        {
            let kind = entity["uid"]["type"].as_str().context("seed type")?;
            if kind == "Betsee::AgentSession" {
                continue;
            }
            let id = entity["uid"]["id"].as_str().context("seed id")?;
            let mut entity = entity.clone();
            if kind == "Betsee::Human" {
                let (sub, name, team, roles) = match id {
                    "maya" => (
                        "00000000-0000-4000-8000-000000000001",
                        "Maya Chen",
                        "finance",
                        json!(["employee", "demo-initiator"]),
                    ),
                    "daniel" => (
                        "00000000-0000-4000-8000-000000000002",
                        "Daniel Ortiz",
                        "security",
                        json!(["security-officer", "approver"]),
                    ),
                    "priya" => (
                        "00000000-0000-4000-8000-000000000003",
                        "Priya Raman",
                        "administration",
                        json!(["org-admin", "demo-initiator"]),
                    ),
                    _ => anyhow::bail!("unexpected human seed {id}"),
                };
                entity["attrs"]["sub"] = json!(sub);
                let caps = entity["attrs"]["entitlements"]
                    .as_array()
                    .context("entitlements")?
                    .iter()
                    .map(|v| v["__entity"]["id"].clone())
                    .collect::<Vec<_>>();
                sqlx::query("INSERT INTO users(sub,username,display_name,organization_id,team_id,roles,clearance,entitlements) VALUES($1,$2,$3,'acme',$4,$5,$6,$7) ON CONFLICT(sub) DO NOTHING")
                    .bind(sub).bind(id).bind(name).bind(team).bind(roles).bind(entity["attrs"]["clearance"].as_i64().unwrap_or(0) as i32).bind(json!(caps)).execute(&self.pool).await?;
            }
            sqlx::query("INSERT INTO cedar_entities(entity_type,entity_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING")
                .bind(kind).bind(id).bind(entity).execute(&self.pool).await?;
        }
        Ok(())
    }

    pub async fn entities(&self) -> Result<Value> {
        let mut items = sqlx::query_scalar::<_, Value>(
            "SELECT data FROM cedar_entities ORDER BY entity_type,entity_id",
        )
        .fetch_all(&self.pool)
        .await?;
        let users = sqlx::query("SELECT sub,username,active,clearance,entitlements FROM users")
            .fetch_all(&self.pool)
            .await?;
        for user in users {
            let username: String = user.try_get("username")?;
            if let Some(entity) = items
                .iter_mut()
                .find(|e| e["uid"]["type"] == "Betsee::Human" && e["uid"]["id"] == username)
            {
                entity["attrs"]["sub"] = json!(user.try_get::<String, _>("sub")?);
                entity["attrs"]["active"] = json!(user.try_get::<bool, _>("active")?);
                entity["attrs"]["clearance"] = json!(user.try_get::<i32, _>("clearance")?);
                let caps: Value = user.try_get("entitlements")?;
                entity["attrs"]["entitlements"] = json!(
                    caps.as_array()
                        .context("invalid entitlements")?
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|cap| betsee_decision::entity_ref("Capability", cap))
                        .collect::<Vec<_>>()
                );
            }
        }
        Ok(json!(items))
    }

    pub async fn put_entity(&self, entity: &Value) -> Result<()> {
        sqlx::query("INSERT INTO cedar_entities(entity_type,entity_id,data) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET data=excluded.data")
            .bind(entity["uid"]["type"].as_str().context("entity type")?).bind(entity["uid"]["id"].as_str().context("entity id")?).bind(entity).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get(&self, kind: &str, id: &str) -> Result<Option<Value>> {
        Ok(
            sqlx::query_scalar("SELECT data FROM gateway_objects WHERE kind=$1 AND id=$2")
                .bind(kind)
                .bind(id)
                .fetch_optional(&self.pool)
                .await?,
        )
    }

    pub async fn list(&self, kind: &str) -> Result<Vec<Value>> {
        Ok(sqlx::query_scalar(
            "SELECT data FROM gateway_objects WHERE kind=$1 ORDER BY updated_at DESC,id",
        )
        .bind(kind)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn put(&self, kind: &str, id: &str, data: &Value) -> Result<()> {
        sqlx::query("INSERT INTO gateway_objects(kind,id,data) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updated_at=now()")
            .bind(kind).bind(id).bind(data).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn approval_requested_reasons(&self, trace_id: &str) -> Result<Option<Value>> {
        Ok(sqlx::query_scalar(
            "SELECT payload->'reasons' FROM audit_records WHERE trace_id=$1 AND phase='pending' ORDER BY id LIMIT 1",
        )
        .bind(trace_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn event(
        &self,
        event_type: &str,
        trace_id: Option<&str>,
        data: &Value,
    ) -> Result<i64> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(782341)")
            .execute(&mut *tx)
            .await?;
        let id=sqlx::query_scalar("INSERT INTO security_events(organization_id,event_type,trace_id,data) VALUES('acme',$1,$2,$3) RETURNING id")
            .bind(event_type).bind(trace_id).bind(data).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(id)
    }

    pub async fn audit(
        &self,
        trace: &Value,
        phase: &str,
        event_type: Option<&str>,
    ) -> Result<Value> {
        let started_at = now();
        let started = std::time::Instant::now();
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(782341)")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO audit_records(trace_id,span_id,organization_id,human_sub,agent_id,use_case_id,session_id,capability,resource_id,policy_ids,control_ids,decision,phase,payload) VALUES($1,$2,'acme',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
            .bind(text(trace,"trace_id")).bind(uuid::Uuid::new_v4().simple().to_string()).bind(trace["human"]["sub"].as_str().unwrap_or("unknown"))
            .bind(trace["agent"]["id"].as_str().unwrap_or("unknown")).bind(trace["use_case"]["id"].as_str().unwrap_or("unknown"))
            .bind(text(trace,"session_id")).bind(text(trace,"capability")).bind(trace["resource"]["id"].as_str().unwrap_or("unknown"))
            .bind(&trace["policy_ids"]).bind(&trace["control_ids"]).bind(text(trace,"decision")).bind(phase).bind(trace).execute(&mut *transaction).await?;
        let mut recorded = trace.clone();
        if let Some(spans) = recorded["spans"].as_array_mut()
            && let Some(span) = spans.iter_mut().rev().find(|span| span["stage"] == "audit")
        {
            span["started_at"] = json!(started_at);
            span["duration_ms"] = json!(started.elapsed().as_secs_f64() * 1000.0);
            span["attributes"]["timing_boundary"] =
                json!("transaction begin, event-order lock and append-only audit INSERT");
        }
        let trace = &recorded;
        if let Some(event_type) = event_type {
            let mut summary = trace.clone();
            if let Some(map) = summary.as_object_mut() {
                map.remove("spans");
                map.remove("execution_context");
            }
            sqlx::query("INSERT INTO security_events(organization_id,event_type,trace_id,data) VALUES('acme',$1,$2,$3)").bind(event_type).bind(text(trace,"trace_id")).bind(summary).execute(&mut *transaction).await?;
        }
        sqlx::query("INSERT INTO gateway_objects(kind,id,data) VALUES('trace',$1,$2) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updated_at=now()")
            .bind(text(trace,"trace_id")).bind(trace).execute(&mut *transaction).await?;
        transaction.commit().await?;
        tracing::info!(
            trace_id = text(trace, "trace_id"),
            decision = text(trace, "decision"),
            phase,
            "action audit persisted"
        );
        Ok(recorded)
    }

    pub async fn human(&self, sub: &str) -> Result<Option<Value>> {
        let row = sqlx::query("SELECT sub,username,display_name,organization_id,team_id,roles,active FROM users WHERE sub=$1").bind(sub).fetch_optional(&self.pool).await?;
        row.map(|row| Ok(json!({"sub":row.try_get::<String,_>("sub")?,"username":row.try_get::<String,_>("username")?,"display_name":row.try_get::<String,_>("display_name")?,"organization_id":row.try_get::<String,_>("organization_id")?,"team":row.try_get::<String,_>("team_id")?,"roles":row.try_get::<Value,_>("roles")?,"active":row.try_get::<bool,_>("active")?}))).transpose()
    }

    pub async fn tool_transition(
        &self,
        name: &str,
        status: &Value,
        trace: Option<&Value>,
        event: &Value,
        security: Option<&Value>,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(782341)")
            .execute(&mut *tx)
            .await?;
        let changed=sqlx::query("INSERT INTO gateway_objects(kind,id,data) VALUES('tool_status',$1,$2) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updated_at=now() WHERE gateway_objects.data->>'observed_hash' IS DISTINCT FROM excluded.data->>'observed_hash'")
            .bind(name).bind(status).execute(&mut *tx).await?.rows_affected()>0;
        if changed && trace.is_some() {
            let trace = trace.context("observation trace")?;
            let trace_id = text(trace, "trace_id");
            sqlx::query("INSERT INTO gateway_objects(kind,id,data) VALUES('trace',$1,$2) ON CONFLICT(kind,id) DO NOTHING").bind(trace_id).bind(trace).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO audit_records(trace_id,span_id,organization_id,human_sub,agent_id,use_case_id,session_id,capability,resource_id,policy_ids,control_ids,decision,phase,payload) VALUES($1,$2,'acme','system','system','tool-observation','none','tool.inspect',$3,'[]',$4,$5,'tool_observation',$6)")
                .bind(trace_id).bind(uuid::Uuid::new_v4().simple().to_string()).bind(name).bind(&trace["control_ids"]).bind(text(trace,"decision")).bind(trace).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO security_events(organization_id,event_type,trace_id,data) VALUES('acme','tool.descriptor_changed',$1,$2)").bind(trace_id).bind(event).execute(&mut *tx).await?;
            if let Some(security) = security {
                sqlx::query("INSERT INTO security_events(organization_id,event_type,trace_id,data) VALUES('acme','security.event',$1,$2)").bind(trace_id).bind(security).execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        Ok(changed)
    }
}

pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub fn now() -> String {
    Utc::now().to_rfc3339()
}
pub fn find_entity<'a>(entities: &'a Value, kind: &str, id: &str) -> Option<&'a Value> {
    entities.as_array()?.iter().find(|entity| {
        entity["uid"]["type"] == format!("Betsee::{kind}") && entity["uid"]["id"] == id
    })
}
