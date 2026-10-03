CREATE TABLE users (
    sub TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    roles JSONB NOT NULL DEFAULT '[]',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    clearance INTEGER NOT NULL CHECK (clearance BETWEEN 0 AND 3),
    entitlements JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE cedar_entities (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    data JSONB NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE gateway_objects (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, id)
);

CREATE TABLE audit_records (
    id BIGSERIAL PRIMARY KEY,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    human_sub TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    use_case_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    policy_ids JSONB NOT NULL,
    control_ids JSONB NOT NULL,
    decision TEXT NOT NULL,
    phase TEXT NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_trace_idx ON audit_records(trace_id, id);
CREATE INDEX audit_agent_time_idx ON audit_records(agent_id, occurred_at);

CREATE TABLE security_events (
    id BIGSERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    trace_id TEXT,
    data JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_org_id_idx ON security_events(organization_id, id);

CREATE FUNCTION reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit and security event records are append-only';
END;
$$;

CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_records
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_records
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON security_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_mutation();
