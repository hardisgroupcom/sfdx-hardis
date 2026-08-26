Everyone is welcome to contribute to sfdx-hardis (even juniors: we will help you).

### Salesforce CLI Plugin: sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install TypeScript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install the Salesforce CLI by running `npm install @salesforce/cli --global`
- Fork <https://github.com/hardisgroupcom/sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sf plugins link` to link the local sfdx-hardis to the Salesforce CLI
  - Run `tsc --watch` to transpile TypeScript into JavaScript every time you update a TS file
  - Optional, recommended on Windows: export `NODE_OPTIONS="--import file:///<path-to-your-clone>/scripts/disable-auto-transpile.mjs"` in your shell profile or VS Code terminal environment. A linked plugin is normally re-transpiled from TypeScript at every command (about 3 extra seconds per run): since `tsc --watch` already keeps `lib/` fresh, this preload makes commands start from the compiled sources instead, as fast as an installed plugin. Remove the variable to run live TypeScript again.
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand --someparameter somevalue` (you can also debug commands with the VS Code SFDX Hardis extension debug setting)

Note: To test a feature from CI, you can add the following code in your workflow before running sfdx-hardis commands:

```sh
REPO_URL="https://github.com/hardisgroupcom/sfdx-hardis.git" # or your forked repo URL
GIT_BRANCH="fixes/my-git-branch" # or the branch you want to test

TEMP_DIR=$(mktemp -d)
git clone "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git checkout "$GIT_BRANCH"
yarn
npm install typescript --global
tsc
sf plugins link
cd -
```

### VS Code Extension: vscode-sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install TypeScript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Visual Studio Code Insiders ([download here](https://code.visualstudio.com/insiders/))
- Fork <https://github.com/hardisgroupcom/vscode-sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
- To test your code in the VS Code extension:
  - Open the `vscode-sfdx-hardis` folder in VS Code Insiders
  - Press `F5` to open a new VS Code window with the extension loaded (or menu Run > Start Debugging)
  - In the new window, open a Salesforce DX project
  - Run commands from the command palette (Ctrl+Shift+P) or use the buttons in the panel or webviews
