Everyone is welcome to contribute to sfdx-hardis (even juniors: we'll assist you !)

### Salesforce CLI Plugin: sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install typescript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Salesforce DX by running `npm install @salesforce/cli --global` command line
- Fork <https://github.com/hardisgroupcom/sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sf plugins link` to link the local sfdx-hardis to SFDX CLI
  - Run `tsc --watch` to transpile typescript into js everytime you update a TS file
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand --someparameter somevalue` (you can also debug commands using VsCode Sfdx-Hardis setting)

Note: If you want to test CI with the sfdx-hardis version of your current branch, add the the following script in your pipeline before calling sfdx hardis.

```shell
TEMP_DIR=$(mktemp -d)
git clone https://github.com/hardisgroupcom/sfdx-hardis.git $TEMP_DIR
cd $TEMP_DIR
git checkout fixes/jira_data_center
yarn
npm install typescript -g
tsc
sf plugins link
cd -
```

### VsCode Extension: vscode-sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install typescript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Visual Studio Code Insiders ([download here](https://code.visualstudio.com/insiders/))
- Fork <https://github.com/hardisgroupcom/vscode-sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
- To test your code in the VsCode Extension:
  - Open the `vscode-sfdx-hardis` folder in VsCode Insiders
  - Press `F5` to open a new VsCode window with the extension loaded (or menu Run -> Start Debugging)
  - In the new window, open a Salesforce DX project
  - Run commands from the command palette (Ctrl+Shift+P) or use the buttons in the panel or webviews
