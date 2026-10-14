// Executed by hardis:scratch:create through the scratchOrgInitApexScripts configuration.
// Inserts a marker record so the NUT can assert that scratch org Apex initialization really ran.
Account initMarker = new Account(Name = 'HardisNutScratchInitMarker');
insert initMarker;
System.debug(LoggingLevel.INFO, 'HARDIS_NUT_SCRATCH_INIT_APEX_RAN');
