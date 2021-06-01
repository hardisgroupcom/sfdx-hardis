import { prompts } from "./prompts";

export async function listProfiles(conn: any) {
  if (conn in [null, undefined]) {
    return [];
  }
  const profileRes = await conn.queryAll("SELECT Id,Name FROM Profile ORDER BY Name");
  return profileRes.records;
}

// Prompt profile(s) for selection
/*
Example calls from command class:
const profiles = await promptProfiles(this.org.getConnection(),{multiselect: true, initialSelection: ["System Administrator","Administrateur Système"]});
const profile = await promptProfiles(this.org.getConnection(),{multiselect: false, initialSelection: ["System Administrator","Administrateur Système"]});
*/
export async function promptProfiles(conn: any, options: any = { multiselect: false, initialSelection: [], message: "Please select profile(s)" }) {
  const profiles = await listProfiles(conn);
  // Profiles returned by active connection
  if (profiles.length > 0) {
    const profilesSelection = await prompts({
      type: options.multiselect ? "multiselect" : "select",
      message: options.message || "Please select profile(s)",
      name: "value",
      choices: profiles.map((profile: any) => {
        return { title: profile.Name, value: profile.Name };
      }),
    });
    return profilesSelection.value || null;
  } else {
    // Manual input of comma separated profiles
    const profilesSelection = await prompts({
      type: "text",
      message: options.message || "Please input profile name",
      name: "value",
      initial: options?.initalSelection[0] || null,
    });
    return options.multiselect ? profilesSelection.value.split(",") : profilesSelection.value;
  }
}
