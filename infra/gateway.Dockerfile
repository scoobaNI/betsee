FROM rust:1.96-bookworm AS build
WORKDIR /build
COPY gateway/ /build/gateway/
COPY policies/ /build/policies/
WORKDIR /build/gateway
ARG BUILD_BINARIES="betsee-gateway betsee-mcp mock-llm"
RUN --mount=type=cache,id=betsee-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=betsee-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=betsee-cargo-target,target=/build/gateway/target,sharing=locked \
    set --; for binary in $BUILD_BINARIES; do set -- "$@" --bin "$binary"; done; \
    cargo clean -p betsee-decision -p betsee-server && \
    cargo build --locked "$@" && mkdir /out && \
    for binary in $BUILD_BINARIES; do cp "target/debug/$binary" /out/; done

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl poppler-utils && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/ /usr/local/bin/
COPY policies/ /app/policies/
ENV POLICY_DIR=/app/policies \
    POLICIES_DIR=/app/policies \
    RUST_LOG=info
USER 10001:10001
CMD ["betsee-gateway"]
