"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JUnitReporter = void 0;
const utils_1 = require("../utils");
// cli currently has spaces in multiples of four for junit format
const tab = '    ';
const timeProperties = [
    'testExecutionTimeInMs',
    'testTotalTimeInMs',
    'commandTimeInMs'
];
// properties not in cli junit spec
const skippedProperties = ['skipRate', 'totalLines', 'linesCovered'];
class JUnitReporter {
    format(testResult) {
        const { summary, tests } = testResult;
        let output = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        output += `<testsuites>\n`;
        output += `${tab}<testsuite name="force.apex" `;
        output += `timestamp="${summary.testStartTime}" `;
        output += `hostname="${summary.hostname}" `;
        output += `tests="${summary.testsRan}" `;
        output += `failures="${summary.failing}"  `;
        output += `errors="0"  `;
        output += `time="${(0, utils_1.msToSecond)(summary.testExecutionTimeInMs)}">\n`;
        output += this.buildProperties(testResult);
        output += this.buildTestCases(tests);
        output += `${tab}</testsuite>\n`;
        output += `</testsuites>\n`;
        return output;
    }
    buildProperties(testResult) {
        let junitProperties = `${tab}${tab}<properties>\n`;
        Object.entries(testResult.summary).forEach(([key, value]) => {
            if (this.isEmpty(value) || skippedProperties.includes(key)) {
                return;
            }
            if (timeProperties.includes(key)) {
                value = `${(0, utils_1.msToSecond)(value)} s`;
                key = key.replace('InMs', '');
            }
            if (key === 'outcome' && value === 'Passed') {
                value = 'Successful';
            }
            junitProperties += `${tab}${tab}${tab}<property name="${key}" value="${value}"/>\n`;
        });
        junitProperties += `${tab}${tab}</properties>\n`;
        return junitProperties;
    }
    buildTestCases(tests) {
        let junitTests = '';
        for (const testCase of tests) {
            const methodName = this.xmlEscape(testCase.methodName);
            junitTests += `${tab}${tab}<testcase name="${methodName}" classname="${testCase.apexClass.fullName}" time="${(0, utils_1.msToSecond)(testCase.runTime)}">\n`;
            if (testCase.outcome === "Fail" /* Fail */ ||
                testCase.outcome === "CompileFail" /* CompileFail */) {
                let message = this.isEmpty(testCase.message) ? '' : testCase.message;
                message = this.xmlEscape(message);
                junitTests += `${tab}${tab}${tab}<failure message="${message}">`;
                if (testCase.stackTrace) {
                    junitTests += `<![CDATA[${testCase.stackTrace}]]>`;
                }
                junitTests += `</failure>\n`;
            }
            junitTests += `${tab}${tab}</testcase>\n`;
        }
        return junitTests;
    }
    xmlEscape(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    isEmpty(value) {
        if (value === null ||
            value === undefined ||
            (typeof value === 'string' && value.length === 0)) {
            return true;
        }
        return false;
    }
}
exports.JUnitReporter = JUnitReporter;
//# sourceMappingURL=junitReporter.js.map