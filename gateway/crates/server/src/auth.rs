use crate::store::Store;
use anyhow::{Context, Result, bail};
use axum::http::HeaderMap;
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::RwLock;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub azp: String,
    pub exp: i64,
    pub iat: i64,
    pub iss: String,
    pub aud: Value,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub acr: String,
    #[serde(default)]
    pub auth_time: Option<i64>,
    #[serde(default)]
    pub realm_access: Value,
}

impl Claims {
    pub fn role(&self, role: &str) -> bool {
        self.realm_access["roles"]
            .as_array()
            .is_some_and(|roles| roles.iter().any(|r| r == role))
    }
    pub fn agent(&self) -> bool {
        matches!(
            self.azp.as_str(),
            "invoice-assistant"
                | "support-triage"
                | "research-agent"
                | "research-peer"
                | "ops-runner"
                | "report-bot"
        )
    }
    pub fn browser(&self) -> bool {
        matches!(self.azp.as_str(), "betsee-director" | "betsee-ecosystem")
    }
    pub fn runner(&self) -> bool {
        self.azp == "betsee-demo-runner" && self.role("demo-initiator")
    }
    pub fn fresh_step_up(&self) -> bool {
        let now = Utc::now().timestamp();
        self.acr == "2"
            && self
                .auth_time
                .is_some_and(|time| time <= now && now - time <= 300)
            && self.role("approver")
    }
}

#[derive(Clone)]
pub struct Auth {
    issuer: String,
    audience: String,
    jwks_url: String,
    client: reqwest::Client,
    cache: Arc<RwLock<Option<(Instant, JwkSet)>>>,
}

impl Auth {
    pub fn new(issuer: String, audience: String, jwks_url: String) -> Result<Self> {
        Ok(Self {
            issuer,
            audience,
            jwks_url,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            cache: Arc::new(RwLock::new(None)),
        })
    }

    pub async fn verify(&self, headers: &HeaderMap) -> Result<Claims> {
        let bearer = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        let token = bearer.context("missing bearer token")?;
        let header = decode_header(token)?;
        if header.alg != Algorithm::RS256 {
            bail!("only RS256 accepted");
        }
        let kid = header.kid.context("missing key id")?;
        let refresh = self.cache.read().await.as_ref().is_none_or(|(at, keys)| {
            at.elapsed() > Duration::from_secs(60) || keys.find(&kid).is_none()
        });
        if refresh {
            let keys = self
                .client
                .get(&self.jwks_url)
                .send()
                .await?
                .error_for_status()?
                .json::<JwkSet>()
                .await?;
            *self.cache.write().await = Some((Instant::now(), keys));
        }
        let cache = self.cache.read().await;
        let keys = &cache.as_ref().context("no JWKS")?.1;
        let key = DecodingKey::from_jwk(keys.find(&kid).context("unknown signing key")?)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.audience]);
        validation.leeway = 0;
        validation.validate_nbf = true;
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub", "iat"]);
        let claims = decode::<Claims>(token, &key, &validation)?.claims;
        if claims.iat > Utc::now().timestamp() + 5 {
            bail!("issued in future");
        }
        if claims.agent()
            && (claims.agent_id.as_deref() != Some(&claims.azp) || claims.exp - claims.iat > 300)
        {
            bail!("invalid agent claims");
        }
        Ok(claims)
    }

    pub async fn human(&self, claims: &Claims, store: &Store, allow_runner: bool) -> Result<Value> {
        if !(claims.browser() || (allow_runner && claims.runner())) {
            bail!("wrong principal kind");
        }
        let human = store
            .human(&claims.sub)
            .await?
            .context("unregistered human")?;
        if human["active"] != true || human["organization_id"] != "acme" {
            bail!("inactive or foreign human");
        }
        Ok(human)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn step_up_requires_fresh_auth_and_approver_role() {
        let mut claims: Claims = serde_json::from_value(serde_json::json!({"sub":"d","azp":"betsee-director","exp":1,"iat":0,"iss":"i","aud":"a","acr":"2","auth_time":Utc::now().timestamp(),"realm_access":{"roles":["approver"]}})).unwrap();
        assert!(claims.fresh_step_up());
        claims.auth_time = Some(Utc::now().timestamp() - 301);
        assert!(!claims.fresh_step_up());
        claims.auth_time = Some(Utc::now().timestamp() + 1);
        assert!(!claims.fresh_step_up());
        claims.auth_time = Some(Utc::now().timestamp());
        claims.acr = "1".into();
        assert!(!claims.fresh_step_up());
    }
}
