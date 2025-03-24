# hardis:misc:custom-label-translations

## Description

Extract selected custom labels, or of a given Lightning Web Component (LWC), from all language translation files. This command generates translation files (`*.translation-meta.xml`) for each language already retrieved in the current project, containing only the specified custom labels.

This makes it easier to:
- Translate specific custom labels
- Deploy specific custom label translations to another org
- Manage translations for LWC components

## Parameters

| Name              | Type    | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| label<br/>-l      | string  | Developer name(s) of the custom label(s), comma-separated    |         |    *     |         |
| lwc<br/>-c        | string  | Developer name of the Lightning Web Component                |         |    *     |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               | false   |          |         |
| websocket         | string  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |

\* Either `label` or `lwc` must be provided, not both

## Examples

```shell
# Extract specific custom labels
sf hardis:misc:custom-label-translations --label CustomLabelName
sf hardis:misc:custom-label-translations --label Label1,Label2

# Extract custom labels used in a Lightning Web Component
sf hardis:misc:custom-label-translations --lwc MyComponent
```

## How It Works

### Example 1: Extract specific Custom Labels

If you have the following translation files in your project:

**pt_BR.translation-meta.xml** 🇧🇷
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Translations xmlns="http://soap.sforce.com/2006/04/metadata">
    <customLabels>
        <label>Teste</label>
        <name>Test</name>
    </customLabels>
    <customLabels>
        <label>Olá</label>
        <name>Hello</name>
    </customLabels>
</Translations>
```

**es.translation-meta.xml** 🇪🇸
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Translations xmlns="http://soap.sforce.com/2006/04/metadata">
    <customLabels>
        <label>Teste</label>
        <name>Test</name>
    </customLabels>
    <customLabels>
        <label>Hola</label>
        <name>Hello</name>
    </customLabels>
</Translations>
```

Running the command:
```shell
sf hardis:misc:custom-label-translations --label Hello
```

Will generate the following files in `extracted-translations/extract-{timestamp}/`:

**pt_BR.translation-meta.xml** 🇧🇷
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Translations xmlns="http://soap.sforce.com/2006/04/metadata">
    <customLabels>
        <label>Olá</label>
        <name>Hello</name>
    </customLabels>
</Translations>
```

**es.translation-meta.xml** 🇪🇸
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Translations xmlns="http://soap.sforce.com/2006/04/metadata">
    <customLabels>
        <label>Hola</label>
        <name>Hello</name>
    </customLabels>
</Translations>
```

### Example 2: Extract from LWC

For a Lightning Web Component that imports custom labels:

```js
import error from '@salesforce/label/c.error';
import success from '@salesforce/label/c.success';
export default class MyComponent extends LightningElement {
     // Component code
}
```

Running the command:
```shell
sf hardis:misc:custom-label-translations --lwc MyComponent
```

Will generate the following files in `extracted-translations/MyComponent-{timestamp}/`:

**pt_BR.translation-meta.xml** 🇧🇷
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Translations xmlns="http://soap.sforce.com/2006/04/metadata">
    <customLabels>
        <label>Erro</label>
        <name>error</name>
    </customLabels>
    <customLabels>
        <label>Sucesso</label>
        <name>success</name>
    </customLabels>
</Translations>
```

**es.translation-meta.xml** 🇪🇸
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Translations xmlns="http://soap.sforce.com/2006/04/metadata">
    <customLabels>
        <label>Error</label>
        <name>error</name>
    </customLabels>
    <customLabels>
        <label>Éxito</label>
        <name>success</name>
    </customLabels>
</Translations>
```

## Notes

- The command searches for translation files in the `**/translations/` directory
- Output files are created in the `extracted-translations` directory with a timestamp
- When extracting labels from an LWC, the output directory name includes the LWC name