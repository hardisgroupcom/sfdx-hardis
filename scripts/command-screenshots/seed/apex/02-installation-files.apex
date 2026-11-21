// Files attached to the first completed installations: the site survey and the wiring plan that
// hardis:org:files:export downloads (files workspace scripts/files/InstallationDocuments)
List<Installation__c> installations = [SELECT Id, External_Id__c FROM Installation__c WHERE External_Id__c != null ORDER BY External_Id__c LIMIT 4];
Set<Id> installationIds = new Map<Id, Installation__c>(installations).keySet();
Set<Id> withFiles = new Set<Id>();
for (ContentDocumentLink link : [SELECT LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN :installationIds]) {
  withFiles.add(link.LinkedEntityId);
}
List<ContentVersion> versions = new List<ContentVersion>();
for (Installation__c installation : installations) {
  if (withFiles.contains(installation.Id)) {
    continue;
  }
  versions.add(new ContentVersion(
    Title = 'Site survey ' + installation.External_Id__c,
    PathOnClient = 'site-survey-' + installation.External_Id__c + '.txt',
    VersionData = Blob.valueOf('Roof inspected, structure validated for the panel load. Survey by Romain Lefebvre.'),
    FirstPublishLocationId = installation.Id
  ));
  versions.add(new ContentVersion(
    Title = 'Wiring plan ' + installation.External_Id__c,
    PathOnClient = 'wiring-plan-' + installation.External_Id__c + '.txt',
    VersionData = Blob.valueOf('Strings of 10 panels, inverter in the garage, AC breaker 32 A.'),
    FirstPublishLocationId = installation.Id
  ));
}
insert versions;
