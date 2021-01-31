import Amplitude = require('@amplitude/node');
import Debug from 'debug';
import os = require('os');
import path = require('path');
const debug = Debug('sfdx-essentials');

const AMPLITUDE_TOKEN = 'ec70987c2fddff910b2f53d14f556b59';
const STATS_VERSION = globalThis.SFDX_ESSENTIALS_TEST === true ? -1 : 2;

let amplitudeClient;
let pkgJson;
let anonymousUserId;

// Record anonymous statistics for better use. Returns a promise that can be awaited by the caller or not
export function recordAnonymousEvent(eventType: string, data: any): Promise<any> {
    debug('Analytics init: ' + eventType);
    if (amplitudeClient == null) {
        amplitudeClient = Amplitude.init(AMPLITUDE_TOKEN);
    }
    if (pkgJson == null) {
        pkgJson = getPackageJson();
    }
    if (anonymousUserId == null) {
        anonymousUserId = getUuidV4();
    }

    return new Promise(resolve => {
        const eventPayloadFiltered = buildEventPayload(eventType, data);
        amplitudeClient.logEvent({
            app_version: data.appVersion,
            os_name: data.osPlatform,
            os_version: data.osRelease,
            language: process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES,
            event_type: 'command',
            event_properties: eventPayloadFiltered,
            user_id: anonymousUserId,
            ip: '127.0.0.1'
        });
        debug('Analytics sent: ' + eventType + ' ' + JSON.stringify(eventPayloadFiltered));
        resolve(true);
    });
}

function buildEventPayload(eventType: string, data: any) {
    data.app = pkgJson.name;
    data.appVersion = pkgJson.version;
    data.osPlatform = os.platform();
    data.osRelease = os.release();
    data.ci = process.env.CI ? true : false;
    data.statsVersion = STATS_VERSION;
    data.command = eventType;
    return data;
}

// Retrieve npm-groovy-lint package.json
function getPackageJson() {
    const findPackageJson = require('find-package-json');
    const finder = findPackageJson(__dirname);
    const packageJsonFileNm = finder.next().filename;
    let pkg;
    if (packageJsonFileNm) {
        pkg = require(packageJsonFileNm);
    } else {
        pkg = { name: 'sfdx-essentials', version: '0.0.0' };
        console.warn(`package.json not found, use default value ${JSON.stringify(pkg)} instead`);
    }
    return pkg;
}

// Get unique anonymous user identifier
function getUuidV4() {
    const localStorageFileNm = path.resolve(os.homedir() + '/.node-stats/local-storage.json');
    const fse = require('fs-extra');
    let usrLocalStorage = { anonymousUserId: null };
    if (fse.existsSync(localStorageFileNm)) {
        usrLocalStorage = fse.readJsonSync(localStorageFileNm);
    }
    if (usrLocalStorage.anonymousUserId && usrLocalStorage.anonymousUserId != null) {
        return usrLocalStorage.anonymousUserId;
    }
    const { v4: uuidv4 } = require('uuid');
    const anonUsrId = uuidv4();
    usrLocalStorage.anonymousUserId = anonUsrId;
    fse.ensureDirSync(path.resolve(os.homedir() + '/.node-stats'), { mode: '0777' });
    fse.writeJsonSync(localStorageFileNm, usrLocalStorage);
    return usrLocalStorage.anonymousUserId;
}

module.exports = { recordAnonymousEvent };
