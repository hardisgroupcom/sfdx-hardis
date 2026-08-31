# Docker image to run sfdx-hardis

# Node.js is deliberately NOT installed from Alpine's apk repo.
# As of July 2026, Alpine 3.23 ships nodejs 24.17.0, which sits in the broken band of the
# CVE-2026-48931 http.Agent security fix and hangs the Salesforce CLI / jsforce with an
# "unsettled top-level await" error (see https://github.com/hardisgroupcom/sfdx-hardis/issues/1972).
# The follow-up fix (PR #64004) landed one patch later, in Node 24.18.0, which Alpine's repo
# does not serve yet. So we copy a fixed Node 24 build from the official node:24-alpine image
# (currently 24.18.0), while keeping the official python base so pip/Zensical keeps working
# (no PEP-668 issues).
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS node

FROM python:3.12.12-alpine3.23

LABEL maintainer="Nicolas VUILLAMY <nicolas.vuillamy@cloudity.com>"

# Copy the fixed Node.js 24 runtime (node + npm + corepack) from the official node image
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    ln -sf /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

RUN apk add --update --no-cache \
            coreutils \
            git \
            bash \
            # Required for the copied Node.js binary (musl C++ runtime)
            libstdc++ \
            # Required for docker
            docker \
            openrc \
            openjdk17 \
            # Required for puppeteer
            chromium \
            nss \
            freetype \
            harfbuzz \
            ca-certificates \
        ttf-freefont && \
    # Pull latest security patches for base packages (openssl, openjdk, etc.)
    apk upgrade --no-cache && \
    # Clean up package cache
    rm -rf /var/cache/apk/*

# Start docker daemon in case mermaid-cli image is used
RUN rc-update add docker boot && (rc-service docker start || true)

# Do not use puppeteer embedded chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROMIUM_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_EXECUTABLE_PATH="${CHROMIUM_PATH}"

# Add node packages to path #
# hadolint ignore=DL3044
ENV PATH="/node_modules/.bin:${PATH}"

# Set Java environment for code scanner (PMD)
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

ARG SFDX_CLI_VERSION=latest
ARG SFDX_HARDIS_VERSION=latest
# Default to a placeholder so deploy workflows (remote install) do not fail on missing file
ARG SFDX_HARDIS_TGZ=defaults/empty.tgz

# Include pre-packaged plugin from the build context when provided
COPY ${SFDX_HARDIS_TGZ} /tmp/sfdx-hardis.tgz

# Install npm packages +install sfdx plugins & display versions
RUN npm install --no-cache yarn -g && \
    npm install --no-cache @salesforce/cli@${SFDX_CLI_VERSION} -g && \
        sf plugins install @salesforce/plugin-packaging && \
        sf plugins install @salesforce/plugin-deploy-retrieve && \
        # Prefer local plugin package (built from current sources); fallback to registry version
        if echo 'y' | sf plugins install file:/tmp/sfdx-hardis.tgz; then \
            echo 'Installed local sfdx-hardis package'; \
        else \
            echo 'Local package not found; installing sfdx-hardis@'"${SFDX_HARDIS_VERSION}"; \
            echo 'y' | sf plugins install sfdx-hardis@${SFDX_HARDIS_VERSION}; \
        fi && \
    echo 'y' | sf plugins install sfdx-git-delta && \
    echo 'y' | sf plugins install sfdmu && \
    sf version --verbose --json && \
    # Clean up npm cache and temporary files
    rm -rf /root/.npm/_cacache && \
    rm -rf /tmp/* && \
    npm cache clean --force

# Optionally install coding agent CLIs for auto-fix feature
# Note: some agents may crash on Alpine/musl at runtime. If so, use the Ubuntu-based image instead.
# Use --build-arg INSTALL_AGENTS=true to include agent CLIs (sfdx-hardis-with-agents images)
ARG INSTALL_AGENTS=false
RUN if [ "$INSTALL_AGENTS" = "true" ]; then \
    (npm install --no-cache @anthropic-ai/claude-code@latest -g && claude --version || echo 'WARNING: claude-code install or version check failed') && \
    (npm install --no-cache @openai/codex@latest -g && codex --version || echo 'WARNING: codex install or version check failed') && \
    (npm install --no-cache @google/gemini-cli@latest -g && gemini --version || echo 'WARNING: gemini-cli install or version check failed') && \
    (npm install --no-cache @github/copilot@latest -g && copilot --version || echo 'WARNING: copilot install or version check failed') && \
    npm cache clean --force; \
fi

ENV MERMAID_MODES="docker"

# Workaround for https://github.com/forcedotcom/salesforcedx-apex/issues/213
COPY ref/workarounds/dateUtil.js /usr/local/lib/node_modules/@salesforce/cli/node_modules/@salesforce/apex-node/lib/src/utils/dateUtil.js
COPY ref/workarounds/junitReporter.js /usr/local/lib/node_modules/@salesforce/cli/node_modules/@salesforce/apex-node/lib/src/reporters/junitReporter.js
