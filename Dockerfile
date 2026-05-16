FROM nginx:alpine

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY nginx/default.conf /tmp/nginx-default.conf

# Drop stock nginx welcome page so a missed COPY cannot fall back to it.
RUN rm -rf /usr/share/nginx/html/*

# Support repo-root builds (2026/) and Railway rootDirectory=2026 (files at .).
COPY . /tmp/build-context/
RUN if [ -f /tmp/build-context/2026/index.html ]; then \
      cp -a /tmp/build-context/2026/. /usr/share/nginx/html/; \
    elif [ -f /tmp/build-context/index.html ]; then \
      cp -a /tmp/build-context/. /usr/share/nginx/html/; \
    else \
      echo "ERROR: expected 2026/index.html or index.html in build context" >&2; \
      exit 1; \
    fi && \
    rm -rf /tmp/build-context && \
    test -f /usr/share/nginx/html/index.html

ENTRYPOINT ["/docker-entrypoint.sh"]
