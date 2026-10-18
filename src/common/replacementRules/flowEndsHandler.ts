// From Winter '27 (API 68), Flow Builder saves End elements in the flow XML (<ends>), and the
// connectors of the other elements point to them. An org on an older API version refuses <ends>.
// Removing <ends> alone would leave connectors pointing to nothing: the connectors that target an
// End element are removed too, which gives the implicit end older versions use. The flow behaves
// the same way (forcedotcom/code-analyzer#2098).

import { removeXmlNode, selectXmlPath } from './xmlPath.js';

/** Remove the End elements of a flow document and their connectors. Returns the number of End elements removed. */
export function removeFlowEnds(doc: any): number {
  const ends = selectXmlPath('Flow/ends', doc);
  if (ends.length === 0) {
    return 0;
  }
  const endNames = new Set<string>();
  for (const end of ends) {
    const name = childText(end, 'name');
    if (name) {
      endNames.add(name);
    }
  }
  for (const end of ends) {
    removeXmlNode(end);
  }
  if (endNames.size > 0) {
    // connector, defaultConnector, faultConnector, nextValueConnector, noMoreValuesConnector,
    // timeoutConnector... at any depth (decision rules, wait events, loops, start)
    const connectors: any[] = [];
    collectConnectors(doc.documentElement, connectors);
    for (const connector of connectors) {
      const target = childText(connector, 'targetReference');
      if (target && endNames.has(target)) {
        removeXmlNode(connector);
      }
    }
  }
  return ends.length;
}

function collectConnectors(node: any, result: any[]): void {
  let child = node?.firstChild;
  while (child) {
    if (child.nodeType === 1) {
      const name: string = child.localName || child.nodeName || '';
      if (name === 'connector' || name.endsWith('Connector')) {
        result.push(child);
      } else {
        collectConnectors(child, result);
      }
    }
    child = child.nextSibling;
  }
}

function childText(node: any, childName: string): string {
  let child = node?.firstChild;
  while (child) {
    if (child.nodeType === 1 && (child.localName || child.nodeName) === childName) {
      return (child.textContent || '').trim();
    }
    child = child.nextSibling;
  }
  return '';
}
