// Custom function fixture, node runtime.
//
// Prints its inputs so the test can prove they arrived, prints the secret on purpose so the
// test can prove it comes back masked, then returns its outputs as JSON on the last line.
const channel = process.env.SFDX_HARDIS_IN_CHANNEL || '';
const retries = process.env.SFDX_HARDIS_IN_RETRIES || '';
const token = process.env.SFDX_HARDIS_IN_TOKEN || '';

console.log('HARDIS_NUT_NODE_FUNCTION_RAN');
console.log(`node channel=${channel}`);
console.log(`node retries=${retries}`);
console.log(`node token=${token}`);
console.log(`node targetBranch=${process.env.SFDX_HARDIS_TARGET_BRANCH || ''}`);

console.log(JSON.stringify({ nodeMessageId: 'node-msg-1', nodeStatus: 'sent' }));
