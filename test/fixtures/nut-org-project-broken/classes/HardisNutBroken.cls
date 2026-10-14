/**
 * Deliberately invalid Apex, used by the NUT that checks how sfdx-hardis reports
 * a failing deployment: the referenced method does not exist, so the org rejects
 * the class at compile time and returns a componentFailure.
 */
public with sharing class HardisNutBroken {
  public static String willNotCompile() {
    return HardisNutSample.thisMethodDoesNotExist('boom');
  }
}
