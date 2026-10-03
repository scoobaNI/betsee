FROM python:3.13-alpine
RUN apk add --no-cache postgresql-client
WORKDIR /app
ENV BETSEE_BOOTSTRAP_LOCAL_PSQL=true
COPY scripts/bootstrap.py /app/bootstrap.py
COPY scripts/demo_env.py /app/demo_env.py
ENTRYPOINT ["python3", "/app/bootstrap.py"]
CMD ["--seed"]
