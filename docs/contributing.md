Everyone is welcome to contribute to sfdx-hardis (even juniors: we'll assist you !)

<<<<<<< HEAD
### Salesforce CLI Plugin: sfdx-hardis

=======
>>>>>>> 19c1a367 (feat: integrate Agentforce AI for Visualforce page documentation)
- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install typescript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Salesforce DX by running `npm install @salesforce/cli --global` command line
<<<<<<< HEAD
- Fork <https://github.com/hardisgroupcom/sfdx-hardis> and clone it (or just clone if you are an internal contributor)
=======
- Fork this repo and clone it (or just clone if you are an internal contributor)
>>>>>>> 19c1a367 (feat: integrate Agentforce AI for Visualforce page documentation)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sf plugins link` to link the local sfdx-hardis to SFDX CLI
  - Run `tsc --watch` to transpile typescript into js everytime you update a TS file
<<<<<<< HEAD
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand --someparameter somevalue` (you can also debug commands using VsCode Sfdx-Hardis setting)

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
=======
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand -someparameter somevalue`
>>>>>>> 19c1a367 (feat: integrate Agentforce AI for Visualforce page documentation)
