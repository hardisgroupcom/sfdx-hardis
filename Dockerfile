FROM alpine:latest

LABEL maintainer="Nicolas VUILLAMY <nicolas.vuillamy@hardis-group.com>"

RUN apk add --update \
            git \
            nodejs \
            npm

# Add node packages to path #
ENV PATH="/node_modules/.bin:${PATH}"

# Install npm packages + sfdx plugins
RUN npm install --no-cache \
            sfdx-cli && \
    echo 'y' | sfdx plugins:install sfdx-hardis && \
    echo 'y' | sfdx plugins:install sfdx-essentials && \
    echo 'y' | sfdx plugins:install sfpowerkit
