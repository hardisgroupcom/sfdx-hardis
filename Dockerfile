# Docker image to run sfdx-hardis

FROM alpine:latest

LABEL maintainer="Nicolas VUILLAMY <nicolas.vuillamy@hardis-group.com>"

RUN apk add --update --no-cache \
            git \
            nodejs \
            npm

# Add node packages to path #
ENV PATH="/node_modules/.bin:${PATH}"

# Install npm packages +install sfdx plugins & display versions
RUN npm install --no-cache \
            sfdx-cli && \
    echo 'y' | sfdx plugins:install sfdx-hardis && \
    echo 'y' | sfdx plugins:install sfdx-essentials && \
    echo 'y' | sfdx plugins:install sfpowerkit && \
    sfdx plugins
