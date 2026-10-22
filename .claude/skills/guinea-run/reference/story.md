# The story of Guinea Run

The game must be understandable by any Salesforce person who never opened the
course. No course data anywhere a player can read it: no Helios, no
Installation__c, no "Lab 2.7" or "in the lab". The lessons are DevOps truths;
only the examples are generic. Every world uses the names below, so the story
holds together from world 0 to world 9.

## The company and its orgs

- Company: **Cloudity** (the course's sponsor, fine on screen). Its customers
  are sample Accounts: **Acme Corp**, Globex, Initech.
- Orgs, always with the word org or sandbox: "your dev sandbox", "the
  integration org", "the uat org", "the preprod org", "the production org". FR:
  "votre sandbox de dev", "l'org d'integration", "l'org uat", "l'org preprod",
  "l'org de production". In a log or command line, a plain alias is fine when
  the word org is next to it: `--target-org integration`.
- Branches, always with the word branch: "the integration branch", "the uat
  branch", "the preprod branch", "the main branch". FR: "la branch
  integration".
- "Repository", never "fork".

## The cast

- **Victor Squeeker**, the developer who left: his sticky notes, one hidden per
  world, are generic good habits ("Victor's notes: n of 10").
- **Mariia Pyvovarchuk**, a teammate: merges first, asks for reviews, owns
  US-018, US-052, US-059, US-062. Her chat bubbles show her cartoon portrait.
- **Romain Panda**, a teammate: owns US-056 and US-058, and the .forceignore
  mistake. His chat bubbles show his cartoon portrait.
- World 9: twenty-one admins who change production by hand ("But it's faster!"), and
  the **Sales Manager**, the final boss with a "System Administrator" badge: "I
  am the boss, the sales manager! I must be admin, I do what I want, even
  updating Flows directly in production on weekends!" Beaten, he says "OK...
  I'll open a Pull Request." Their faces are cartoon portraits of real people,
  with their consent.

- The other bosses are admins too (one of the twenty-one faces, a different one
  at each play), each with the shortcut the world teaches against: world 0
  "Why install anything?", world 1 the monster Flow, world 2 "git add .",
  world 3 "I'll do it by hand after", world 5 Accept Current Change
  everywhere and git push --force, world 7 the testers of the uat org (the
  second one goes on sick leave). Worlds 4 and 6 have a dev instead (the
  same faces, "Dev" on his chest, core/dev.js): world 4 pads his test class
  with i++ to fake the 80% ("OK, OK... I'll write real tests, with real
  assertions."), world 6 "works on my sandbox" and deploys from it with sf
  project deploy start ("OK... next time I commit it, and the pipeline
  deploys it."). The world 8 boss is the **Data Cloud**, a
  giant rabbit that never heard of the new field and throws its errors.

What they say stays generic: no course data, no lab numbers.

## US-014, the change the guinea pig carries

- Title: **US-014 Show the customer tier on accounts**. Commit message:
  `US-014 Customer Tier on Account`. Branch: `features/US-014-customer-tier`.
- Its four metadata (world 1 creates them, world 2 stages them, world 3 checks
  them, world 5 conflicts on two):

  | Type          | Name                                                                                             |
  |---------------|--------------------------------------------------------------------------------------------------|
  | CustomField   | `Account.Customer_Tier__c` (label Customer Tier, Picklist: Bronze, Silver, Gold)                 |
  | Layout        | `Account-Account Layout`                                                                         |
  | PermissionSet | `Sales_Rep` (read access)                                                                        |
  | PermissionSet | `Sales_Manager` (read and edit; the admin has it, so it is the one that makes the field visible) |

- The ending record: **Acme Corp** shows **Customer Tier: Gold**.
- In world 5's last merge, the player's side adds `Account.Tier_Score__c`.
- The record page is the Lightning page `Account_Record_Page`.

## The other stories

| Story                                          | Owner        | What                                                                                 | Where it matters                                                                             |
|------------------------------------------------|--------------|--------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| US-016 Compute the customer tier from contacts | the player   | `AccountTierService` (Apex)                                                          | world 4: Contacts queried in a loop, the boss at 101 accounts                                |
| US-018 Show the region on accounts             | Mariia       | `Account.Region__c`                                                                  | world 5: grants it on `Sales_Manager` and adds it to `Account_Record_Page` at the same place |
| US-052 Delivery date on opportunities          | Mariia       | `Opportunity.Delivery_Date__c`                                                       | world 4 review: her layout lost `Opportunity.Next_Step__c`                                   |
| US-056 Case escalation email                   | Romain Panda | Case escalation                                                                      | his .forceignore wildcard `Tier_*` also hides `Account.Tier_Updated__c`                      |
| US-058 Contact birthday reminders              | Romain Panda | Contact reminders                                                                    | world 7: not approved                                                                        |
| US-059 Birthday reminder email template        | Mariia       | built on top of US-058                                                               | world 7: the cherry-pick that conflicts because preprod never got US-058                     |
| US-062 Key accounts group                      | Mariia       | three deployment actions; `Account.Key_Account__c`, `Account.Key_Account_Manager__c` | world 6; world 5's dev merges against it;   world 7: its tester validates it in the uat org  |

## The deployment actions (core/story.js, worlds 3, 6, 7, 8)

| id             | type           | label                                            | when    |
|----------------|----------------|--------------------------------------------------|---------|
| deliverability | manual         | Set Email Deliverability to All Email            | pre     |
| backfill       | apex           | Backfill Customer Tier on existing accounts      | post, 1 |
| refdata        | data           | Load the customer tier reference data            | post, 2 |
| schedule       | schedule-batch | Schedule the nightly customer tier recalculation | post, 3 |

## Background noise (world 2, Recent Changes)

Profile `Admin`, CustomObject `Account`, ListView `Account.All_Accounts`,
`Account.Rating_Score__c`, `Account.Legacy_Id__c`,
`Contact.Preferred_Channel__c`, `Opportunity.Discount__c`,
`Case.Escalation_Level__c`, Layout `Contact-Contact Layout`, Profile
`Sales User`: always on Account, Contact, Opportunity or Case.

## Lab links and quotes

- Each map card keeps its "Learn it for real" links (`labs` in
  `core/story.js`): that is the door into the course.
- `QUOTES` only for product words the game shows and the lab also says, word
  for word in English and in French: command and button names (Accept
  Incoming, Complete Merge, Mark as done), panel names (Metadata Retriever,
  Recent Changes, Orgs Manager), Before / After Metadata Deployment, real
  generic error texts (INVALID_CROSS_REFERENCE_KEY, Too many SOQL queries...).
