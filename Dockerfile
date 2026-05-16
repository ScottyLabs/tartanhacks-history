FROM nginx:alpine

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY nginx/default.conf /tmp/nginx-default.conf
COPY sites/ /usr/share/nginx/html/

ENTRYPOINT ["/docker-entrypoint.sh"]
