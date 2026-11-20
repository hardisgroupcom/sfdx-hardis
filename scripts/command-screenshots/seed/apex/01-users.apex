// Fictional colleagues of the Helios Energy cast, so that user and license commands have people
// to show. Run by scripts/command-screenshots/lib/orgs.mjs on the scratch orgs it creates.
// Safe to run twice: a user whose first and last name already exist is not created again.
String suffix = String.valueOf(DateTime.now().getTime());
Map<String, Profile> profiles = new Map<String, Profile>();
for (Profile p : [SELECT Id, Name FROM Profile WHERE Name IN ('Standard User', 'Standard Platform User', 'Chatter Free User', 'Read Only')]) {
    profiles.put(p.Name, p);
}
List<List<String>> people = new List<List<String>>{
    new List<String>{ 'Mariia', 'Kowalska', 'Standard Platform User' },
    new List<String>{ 'Romain', 'Lefebvre', 'Standard Platform User' },
    new List<String>{ 'Lucia', 'Fernandez', 'Chatter Free User' },
    new List<String>{ 'Tomasz', 'Nowak', 'Chatter Free User' },
    new List<String>{ 'Amelie', 'Dubois', 'Chatter Free User' }
};
Set<String> existing = new Set<String>();
for (User u : [SELECT FirstName, LastName FROM User]) {
    existing.add(u.FirstName + ' ' + u.LastName);
}
List<User> users = new List<User>();
for (List<String> person : people) {
    Profile profile = profiles.get(person[2]);
    if (profile == null || existing.contains(person[0] + ' ' + person[1])) {
        continue;
    }
    String login = (person[0] + '.' + person[1]).toLowerCase();
    users.add(new User(
        FirstName = person[0],
        LastName = person[1],
        Alias = (person[0].left(1) + person[1]).left(8).toLowerCase(),
        Email = login + '@helios-solar.demo',
        Username = login + '.' + suffix + '@helios-solar.demo',
        ProfileId = profile.Id,
        TimeZoneSidKey = 'Europe/Paris',
        LocaleSidKey = 'en_US',
        EmailEncodingKey = 'UTF-8',
        LanguageLocaleKey = 'en_US',
        Title = person[2] == 'Chatter Free User' ? 'Field technician' : 'Project manager'
    ));
}
Database.SaveResult[] results = Database.insert(users, false);
for (Database.SaveResult result : results) {
    if (!result.isSuccess()) {
        System.debug(LoggingLevel.WARN, 'User not created: ' + result.getErrors());
    }
}
