/**
 * Sample Apex class deployed by the sfdx-hardis NUTs.
 * Kept trivial on purpose: the point is to exercise the deployment commands, not Apex itself.
 */
public with sharing class HardisNutSample {
  public static String greet(String name) {
    if (String.isBlank(name)) {
      return 'Hello, world';
    }
    return 'Hello, ' + name;
  }

  public static Integer addNumbers(Integer first, Integer second) {
    if (first == null || second == null) {
      return 0;
    }
    return first + second;
  }
}
