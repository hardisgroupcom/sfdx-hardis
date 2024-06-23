const { execSync } = require('child_process');

function getPackageVersions(packageName) {
  const result = execSync(`npm view ${packageName} versions --json`);
  return JSON.parse(result);
}

function deletePackageVersion(packageName, version) {
  try {
    const deleteResult = execSync(`npm unpublish --force ${packageName}@${version}`);
    console.log(deleteResult.toString());
    console.log(`Successfully deleted ${packageName}@${version}`);
  } catch (error) {
    console.error(`Failed to delete ${packageName}@${version}: ${error.message}`);
  }
}

function main() {
  const packageName = process.env.PACKAGE_NAME;
  if (!packageName) {
    console.error('PACKAGE_NAME environment variable is not set');
    process.exit(1);
  }

  const versions = getPackageVersions(packageName);
  const versionsToDelete = versions.filter(version => /alpha|beta|canary/.test(version));

  console.log("Versions to delete: "+JSON.stringify(versionsToDelete,null,2));
  versionsToDelete.forEach(version => deletePackageVersion(packageName, version));
}

main();