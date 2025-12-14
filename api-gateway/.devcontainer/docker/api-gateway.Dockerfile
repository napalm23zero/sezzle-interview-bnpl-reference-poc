# ┌───────────────────────────────────────────┐
# │  pulsepay-api-gateway                     │
# │                                           │
# │  Lightweight Node.js container for        │
# │  API Gateway development                  │
# │                                           │
# │  for development use ONLY                 │
# └───────────────────────────────────────────┘

FROM node:20-slim

LABEL maintainer="PulsePay Team"
LABEL description="API Gateway - Proxy + Middleware Layer"

# Install essential tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    vim \
    zsh \
    ca-certificates \
    procps \
    net-tools \
    lsof \
    psmisc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install oh-my-zsh for better DX
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Set zsh as default shell
ENV SHELL=/bin/zsh

# Create workspace directory
WORKDIR /workspace

# Keep container running for devcontainer
CMD ["sleep", "infinity"]
