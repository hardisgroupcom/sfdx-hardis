"use strict";
/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.msToSecond = exports.formatStartTime = exports.getCurrentTime = exports.MILLISECONDS_PER_MINUTE = void 0;
exports.MILLISECONDS_PER_MINUTE = 60000;
function getCurrentTime() {
    return new Date().getTime();
}
exports.getCurrentTime = getCurrentTime;
/**
 * Returns ISO formatted date and time given the milliseconds in numbers or UTC formatted string
 * @param startTime start time in millisecond numbers or UTC format string
 * @returns date and time formatted to ISO format
 */
function formatStartTime(startTime) {
    return new Date(startTime).toISOString();
}
exports.formatStartTime = formatStartTime;
function msToSecond(timestamp) {
    return (timestamp / 1000).toFixed(2);
}
exports.msToSecond = msToSecond;
//# sourceMappingURL=dateUtil.js.map