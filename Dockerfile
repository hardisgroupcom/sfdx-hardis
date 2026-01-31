# Docker image to run sfdx-hardis

FROM python:3.12.10-alpine3.23

LABEL maintainer="Nicolas VUILLAMY <nicolas.vuillamy@cloudity.com>"

RUN apk add --update --no-cache \
            coreutils \
            git \
            bash \
            nodejs \
            npm \
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
    # Force patched fast-xml-parser to address CVE-2026-25128 across CLI and installed plugins
    if [ -d "/usr/local/lib/node_modules/@salesforce/cli" ]; then npm --prefix /usr/local/lib/node_modules/@salesforce/cli install --omit=dev --no-package-lock --no-save fast-xml-parser@5.3.4 tar@6.2.1 && npm --prefix /usr/local/lib/node_modules/@salesforce/cli audit fix --omit=dev --no-progress || true; fi && \
    if [ -d "/root/.local/share/sf/node_modules/sfdx-hardis" ]; then npm --prefix /root/.local/share/sf/node_modules/sfdx-hardis install --omit=dev --no-package-lock --no-save fast-xml-parser@5.3.4 tar@6.2.1; fi && \
    if [ -d "/root/.local/share/sf/node_modules/sfdx-git-delta" ]; then npm --prefix /root/.local/share/sf/node_modules/sfdx-git-delta install --omit=dev --no-package-lock --no-save fast-xml-parser@5.3.4 tar@6.2.1; fi && \
    if [ -d "/root/.local/share/sf/node_modules/@cparra/apexdocs" ]; then npm --prefix /root/.local/share/sf/node_modules/@cparra/apexdocs install --omit=dev --no-package-lock --no-save fast-xml-parser@5.3.4 tar@6.2.1; fi && \
    # Run npm audit fix on all installed sf plugins (omit dev deps, ignore failures)
    for plugin_dir in /root/.local/share/sf/node_modules/*; do \
        if [ -f "${plugin_dir}/package.json" ]; then npm --prefix "${plugin_dir}" audit fix --omit=dev --no-progress || true; fi; \
    done && \
    sf version --verbose --json && \
    # Clean up npm cache and temporary files
    rm -rf /root/.npm/_cacache && \
    rm -rf /tmp/* && \
    npm cache clean --force

ENV MERMAID_MODES="docker"

# Workaround for https://github.com/forcedotcom/salesforcedx-apex/issues/213
COPY ref/workarounds/dateUtil.js /usr/local/lib/node_modules/@salesforce/cli/node_modules/@salesforce/apex-node/lib/src/utils/dateUtil.js
COPY ref/workarounds/junitReporter.js /usr/local/lib/node_modules/@salesforce/cli/node_modules/@salesforce/apex-node/lib/src/reporters/junitReporter.js
