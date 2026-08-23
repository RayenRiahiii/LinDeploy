FROM python:3.13-alpine

RUN addgroup -S mirror && adduser -S -G mirror mirror
WORKDIR /app
COPY mirror_gateway.py /app/mirror_gateway.py
RUN mkdir -p /var/cache/lindeploy && chown -R mirror:mirror /var/cache/lindeploy

USER mirror
EXPOSE 8080
CMD ["python", "/app/mirror_gateway.py"]
