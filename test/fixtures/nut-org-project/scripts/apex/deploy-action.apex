// Executed by an 'apex' deployment action (commandsPostDeploy) during the NUTs.
// Inserts a marker record so the NUT can assert the apex action really ran against the org.
Account actionMarker = new Account(Name = 'HardisNutApexActionMarker');
insert actionMarker;
System.debug(LoggingLevel.INFO, 'HARDIS_NUT_APEX_ACTION_RAN');
