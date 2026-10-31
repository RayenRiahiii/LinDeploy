FROM python:3.13-alpine@sha256:540c7d91f98ff6880174c40e99067bf5941eb54d818a7a5e094d188b196a934d

RUN addgroup -S mirror && adduser -S -G mirror mirror
WORKDIR /app
COPY mirror_gateway.py /app/mirror_gateway.py
COPY cache_store.py /app/cache_store.py
RUN mkdir -p /var/cache/lindeploy && chown -R mirror:mirror /var/cache/lindeploy

USER mirror
EXPOSE 8080
CMD ["python", "/app/mirror_gateway.py"]
