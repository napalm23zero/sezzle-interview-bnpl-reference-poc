# ┌───────────────────────────────────────────┐
# │  pulsepay-elasticsearch                   │
# │                                           │
# │  Search engine for operational queries    │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM docker.elastic.co/elasticsearch/elasticsearch:8.11.0

LABEL maintainer="PulsePay Team"
LABEL description="Elasticsearch for operational search"

ENV discovery.type=single-node
ENV xpack.security.enabled=false
ENV ES_JAVA_OPTS="-Xms512m -Xmx512m"

EXPOSE 9200 9300
