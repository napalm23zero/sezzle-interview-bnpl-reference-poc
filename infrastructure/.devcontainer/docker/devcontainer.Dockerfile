# ┌───────────────────────────────────────────┐
# │  pulsepay-devcontainer                    │
# │                                           │
# │  Lightweight Ubuntu with tools to manage  │
# │  infrastructure services                  │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM ubuntu:22.04

LABEL maintainer="PulsePay Team"
LABEL description="DevContainer shell for infrastructure management"

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Basic utilities
    ca-certificates \
    curl \
    wget \
    git \
    vim \
    less \
    jq \
    unzip \
    # Shell
    zsh \
    # Database clients
    postgresql-client \
    mysql-client \
    redis-tools \
    # Network tools
    dnsutils \
    iputils-ping \
    netcat \
    telnet \
    # Process management
    htop \
    # Python for awslocal
    python3 \
    python3-pip \
    # Docker CLI dependencies
    gnupg \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (to communicate with host's Docker daemon)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Create docker group and set socket permissions on startup
# The GID will be matched to host's docker group at runtime
RUN groupadd -g 999 docker || true

# Install AWS CLI + LocalStack wrapper
RUN pip3 install --no-cache-dir \
    awscli \
    awscli-local

# Install oh-my-zsh
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Set zsh as default shell
SHELL ["/bin/zsh", "-c"]

# Create workspace directory
WORKDIR /workspace

# Create helpful aliases
RUN echo '\n\
# PulsePay Infrastructure Aliases\n\
alias pg="psql -h postgres -U pulsepay -d pulsepay_orders"\n\
alias mysql-ledger="mysql -h mysql -u pulsepay -ppulsepay_dev pulsepay_ledger"\n\
alias redis="redis-cli -h redis"\n\
alias sqs-list="awslocal sqs list-queues"\n\
alias sqs-receive="awslocal sqs receive-message --queue-url"\n\
alias es-health="curl -s http://elasticsearch:9200/_cluster/health | jq"\n\
alias es-indices="curl -s http://elasticsearch:9200/_cat/indices?v"\n\
\n\
# Quick status check\n\
infra-status() {\n\
  echo "🐘 PostgreSQL:"; pg -c "SELECT 1" 2>/dev/null && echo "  ✅ Connected" || echo "  ❌ Not available"\n\
  echo "🐬 MySQL:"; mysql-ledger -e "SELECT 1" 2>/dev/null && echo "  ✅ Connected" || echo "  ❌ Not available"\n\
  echo "🔴 Redis:"; redis ping 2>/dev/null && echo "  ✅ Connected" || echo "  ❌ Not available"\n\
  echo "📨 LocalStack:"; curl -s http://localstack:4566/_localstack/health | jq -r .services.sqs 2>/dev/null || echo "  ❌ Not available"\n\
  echo "🔍 Elasticsearch:"; curl -s http://elasticsearch:9200/_cluster/health | jq -r .status 2>/dev/null || echo "  ❌ Not available"\n\
}\n\
' >> ~/.zshrc

# Environment variables for AWS LocalStack
ENV AWS_ACCESS_KEY_ID=test
ENV AWS_SECRET_ACCESS_KEY=test
ENV AWS_DEFAULT_REGION=us-east-1
ENV AWS_ENDPOINT_URL=http://localstack:4566

CMD ["sleep", "infinity"]
