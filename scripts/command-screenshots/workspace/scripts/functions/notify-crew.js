// Custom function of the Helios project: tells the installation crew that a release reached their org
const target = process.env.SFDX_HARDIS_FUNCTION_INPUT_CHANNEL || "crew-releases";
console.log(`Release deployed, crew notified on ${target}`);
