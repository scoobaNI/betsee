FROM python:3.13-alpine
WORKDIR /app
COPY runner/ runner/
COPY scenarios/ scenarios/
ENV SCENARIO_DIR=/app/scenarios \
    PORT=8090 \
    PYTHONUNBUFFERED=1
USER nobody
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8090/healthz || exit 1
ENTRYPOINT ["python", "-m", "runner"]
CMD ["serve"]
