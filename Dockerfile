FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile

# Support repo-root builds (2027/) and Railway rootDirectory=2027 (files at .).
COPY . /tmp/build-context/
RUN if [ -f /tmp/build-context/2027/index.html ]; then \
      cp -a /tmp/build-context/2027/. /usr/share/caddy/; \
    elif [ -f /tmp/build-context/index.html ]; then \
      cp -a /tmp/build-context/. /usr/share/caddy/; \
    else \
      echo "ERROR: expected 2027/index.html or index.html in build context" >&2; \
      exit 1; \
    fi && \
    rm -rf /tmp/build-context && \
    rm -f /usr/share/caddy/Caddyfile \
          /usr/share/caddy/Dockerfile \
          /usr/share/caddy/compose.yaml \
          /usr/share/caddy/railway.json \
          /usr/share/caddy/.dockerignore \
          /usr/share/caddy/.gitignore && \
    test -f /usr/share/caddy/index.html
