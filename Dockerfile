# Docker image to run sfdx-hardis

FROM alpine:latest

LABEL maintainer="Nicolas VUILLAMY <nicolas.vuillamy@hardis-group.com>"

RUN apk add --update --no-cache \
            git \
            nodejs \
            npm

# Add node packages to path #
# hadolint ignore=DL3044
ENV PATH="/node_modules/.bin:${PATH}"

ARG SFDX_HARDIS_VERSION=latest

# Install npm packages +install sfdx plugins & display versions
RUN npm install --no-cache \
            sfdx-cli@7.85.1 && \
    echo 'y' | sfdx plugins:install sfdx-hardis@${SFDX_HARDIS_VERSION} && \
    echo 'y' | sfdx plugins:install sfdx-essentials && \
    echo 'y' | sfdx plugins:install sfpowerkit && \
    echo 'y' | sfdx plugins:install texei-sfdx-plugin && \
    sfdx plugins

