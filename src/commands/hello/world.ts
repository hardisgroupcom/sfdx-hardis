import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'hello.world');

export type HelloWorldResult = {
  name: string;
  time: string;
};

export default class World extends SfCommand<HelloWorldResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = `
## Command Behavior

**Says hello to the world or a specified person.**

This is a simple command used for demonstration purposes. It outputs a greeting message to the console.

Key functionalities:

- **Customizable Greeting:** You can specify a name using the \`--name\` flag to personalize the greeting.
- **Timestamp:** The greeting includes the current date.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Flag Parsing:** It parses the \`--name\` flag to get the recipient of the greeting.
- **Date Retrieval:** It gets the current date using \`new Date().toDateString()\`.
- **Console Output:** It constructs the greeting message using the provided name and the current date, and then logs it to the console using \`this.log()\`.
</details>
`;
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags: any = {
    name: Flags.string({
      char: 'n',
      summary: messages.getMessage('flags.name.summary'),
      description: messages.getMessage('flags.name.description'),
      default: 'World',
    }),
  };

  public async run(): Promise<HelloWorldResult> {
    const { flags } = await this.parse(World);
    const time = new Date().toDateString();
    this.log(messages.getMessage('info.hello', [flags.name, time]));
    return {
      name: flags.name,
      time,
    };
  }
}
