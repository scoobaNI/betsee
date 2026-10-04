use betsee_server::{
    api,
    auth::Auth,
    connectors::{McpConnector, OpenAiCompatible, validate_url},
    guardrails::Runtime,
    pipeline::Gateway,
    store::Store,
};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

fn setting(name: &str, alias: &str, default: &str) -> String {
    std::env::var(name)
        .or_else(|_| std::env::var(alias))
        .unwrap_or_else(|_| default.into())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let policies =
        PathBuf::from(std::env::var("POLICIES_DIR").unwrap_or_else(|_| "../policies".into()));
    let runtime = Runtime::load(policies.clone())?;
    let http_hosts: Vec<_> = std::env::var("CONNECTOR_HTTP_ALLOWED_HOSTS")
        .unwrap_or_else(|_| "mock-llm,betsee-mcp,mcp".into())
        .split(',')
        .map(|host| host.trim().to_owned())
        .collect();
    let llm_url = validate_url(
        &setting("OPENAI_BASE_URL", "LLM_BASE_URL", "http://mock-llm:8082/v1"),
        &http_hosts,
    )?;
    let mcp_url = validate_url(
        &setting("MCP_URL", "MCP_BASE_URL", "http://betsee-mcp:8081/mcp"),
        &http_hosts,
    )?;
    let store = Store::connect(&std::env::var("DATABASE_URL")?).await?;
    let gateway = Arc::new(Gateway {
        store,
        auth: Auth::new(
            setting(
                "OIDC_ISSUER",
                "KEYCLOAK_ISSUER",
                "http://auth.betsee.localhost/realms/betsee",
            ),
            setting("OIDC_AUDIENCE", "KEYCLOAK_AUDIENCE", "betsee-gateway"),
            setting(
                "OIDC_JWKS_URL",
                "KEYCLOAK_JWKS_URL",
                "http://keycloak:8080/realms/betsee/protocol/openid-connect/certs",
            ),
        )?,
        runtime: runtime.clone(),
        llm: OpenAiCompatible::new(
            llm_url,
            std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "mock-model-demo".into()),
            std::env::var("OPENAI_API_KEY").ok(),
        )?,
        mcp: McpConnector::new(mcp_url, std::env::var("MCP_GATEWAY_TOKEN")?)?,
        action_gate: Arc::new(Mutex::new(())),
    });
    gateway.seed_runtime(&policies).await?;
    // CTL-CFG-001: policies, guardrails, the classifier and the signature baseline reload live; the
    // external threat feed is polled. Both report through security events.
    let events = gateway.clone();
    runtime.clone().watch(move |kind, detail| {
        let events = events.clone();
        async move {
            let severity = if kind.ends_with("rejected") { "high" } else { "info" };
            let message = if kind.ends_with("rejected") {
                "Policy change rejected; the last good configuration stays active"
            } else {
                "Policy configuration reloaded without a restart"
            };
            let trace = uuid::Uuid::new_v4().simple().to_string();
            if let Err(error) = events.security(kind, severity, &trace, message, detail).await {
                tracing::warn!(%error, "could not record policy reload event");
            }
        }
    });
    let events = gateway.clone();
    runtime.poll_feed(move |kind, detail| {
        let events = events.clone();
        async move {
            let severity = if kind.ends_with("rejected") { "medium" } else { "info" };
            let message = if kind.ends_with("rejected") {
                "Threat feed unavailable or invalid; the last good signatures stay active"
            } else {
                "Threat feed updated"
            };
            let trace = uuid::Uuid::new_v4().simple().to_string();
            if let Err(error) = events.security(kind, severity, &trace, message, detail).await {
                tracing::warn!(%error, "could not record threat feed event");
            }
        }
    });
    let watcher = gateway.clone();
    tokio::spawn(async move {
        loop {
            if let Err(error) = watcher.observe_tools(None).await {
                tracing::warn!(%error,"MCP tool observation unavailable");
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!(
        address = "0.0.0.0:8080",
        policy_engine = "Cedar",
        "Gateway listening"
    );
    axum::serve(listener, api::router(gateway))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
