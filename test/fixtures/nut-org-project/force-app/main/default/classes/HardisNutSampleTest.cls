/**
 * Test class for HardisNutSample.
 * Gives the NUT deployments real Apex coverage, so RunLocalTests and the org-wide
 * coverage checks of hardis:project:deploy:smart have something to work with.
 */
@isTest
private class HardisNutSampleTest {
  @isTest
  static void greetReturnsDefaultWhenBlank() {
    System.assertEquals('Hello, world', HardisNutSample.greet(''), 'Blank name should fall back to world');
    System.assertEquals('Hello, world', HardisNutSample.greet(null), 'Null name should fall back to world');
  }

  @isTest
  static void greetReturnsName() {
    System.assertEquals('Hello, Astro', HardisNutSample.greet('Astro'), 'Name should be used in the greeting');
  }

  @isTest
  static void addNumbersSumsValues() {
    System.assertEquals(5, HardisNutSample.addNumbers(2, 3), 'Should sum both values');
    System.assertEquals(0, HardisNutSample.addNumbers(null, 3), 'Null input should return 0');
  }
}
