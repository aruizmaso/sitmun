import type {AppCfg} from '../api/model/app-cfg';
import {editingTasks} from '../services/wfs-editing-identity';
import {AttributeData, AttributeFormField, attributeValuesEqual} from './feature-attribute-draft';
import type {WfsAttributeField} from './wfs-attribute-schema';

export interface WfsAttributePolicy {
  version: 1;
  featureType: string;
  editableAttributes: string[];
}
export interface VerifiedWfsAttributeSchema {
  featureType: string;
  attributes: {name: string; namespace: string; type: string; geometry: boolean; generated: boolean}[];
}
export interface WfsAttributeAccess {
  schema?: VerifiedWfsAttributeSchema;
  editable: ReadonlySet<string>;
}

export const wfsAttributeIdentity = (field: {namespace: string; name: string}): string => `{${field.namespace}}${field.name}`;

export function effectiveWfsAttributeAccess(profile: AppCfg, layer: any): WfsAttributeAccess {
  const tasks = editingTasks(profile, layer);
  const schemas = tasks.map((task) => task.wfsAttributeSchema).filter((schema): schema is VerifiedWfsAttributeSchema => !!schema);
  const schema = schemas[0];
  const editable = new Set<string>();
  if (!schema || schemas.some((item) => JSON.stringify(item) !== JSON.stringify(schema))) return {editable};
  for (const task of tasks) {
    const policy = task.wfsAttributePolicy;
    if (policy?.version === 1 && policy.featureType === schema.featureType && Array.isArray(policy.editableAttributes)) {
      policy.editableAttributes.forEach((name) => editable.add(name));
    }
  }
  const allowed = new Set(schema.attributes.filter((field) => !field.geometry && !field.generated).map(wfsAttributeIdentity));
  return {schema, editable: new Set([...editable].filter((name) => allowed.has(name)))};
}

/** Native draft membership wins over generated IDs, including restored provisional inserts. */
export function isNewWfsFeature(control: any, feature: any): boolean {
  if (feature.sitmunInsertConfirmed === true) return false;
  const added = control.getLayerEditData?.()?.addedFeaturesLayer?.features ?? [];
  return added.some((item: any) => item === feature || item.id != null && [feature.id, feature.provId].includes(item.id)) ||
    !!feature.provId;
}

export function projectWfsAttributeAccess(fields: AttributeFormField[], access: WfsAttributeAccess,
  isNew: boolean, readOnlyReason: string): AttributeFormField[] {
  return fields.filter((field) => !field.schema || !access.schema?.attributes.some((attribute) =>
    wfsAttributeIdentity(attribute) === wfsAttributeIdentity(field.schema!) && attribute.generated)).map((field) => {
    const identity = field.schema ? wfsAttributeIdentity(field.schema) : '';
    const verified = access.schema?.attributes.some((attribute) => !attribute.geometry && !attribute.generated && wfsAttributeIdentity(attribute) === identity);
    const editable = !!verified && (isNew || access.editable.has(identity));
    return editable ? field : {...field, editable: false, initialInput: undefined, reasons: [...field.reasons, readOnlyReason]};
  });
}

export function nativeWfsAttribute(access: WfsAttributeAccess, key: string, namespaces: Record<string, string> = {}): VerifiedWfsAttributeSchema['attributes'][number] | undefined {
  const parts = key.split(':');
  const matches = access.schema?.attributes.filter((field) => field.name === parts.at(-1) &&
    (parts.length === 1 || parts.length === 2 && namespaces[parts[0]] === field.namespace)) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

/** Structural/XSD equality, never reference equality for JSON/complex attributes. */
export function wfsAttributeDelta(before: AttributeData, after: AttributeData, access: WfsAttributeAccess,
  namespaces: Record<string, string> = {}): AttributeData {
  const delta: AttributeData = {};
  for (const key of Object.keys(after)) {
    // Copies may drop undefined properties. Only an explicit final value is a write;
    // clearing a field requires null, never a missing key or undefined.
    if (key === 'gml:boundedBy' || after[key] === undefined) continue;
    const attribute = nativeWfsAttribute(access, key, namespaces);
    if (attribute?.geometry) continue;
    const field: WfsAttributeField = {name: key, namespace: attribute?.namespace ?? '',
      type: attribute?.type.startsWith('{http://www.w3.org/2001/XMLSchema}') ? attribute.type.split('}')[1] : 'complex',
      minOccurs: '0', maxOccurs: '1', nillable: true, defaultValue: null, fixedValue: null, facets: [], reasons: []};
    // Unknown scalar values still compare exactly; unknown objects compare structurally.
    if (!attribute && (after[key] == null || typeof after[key] !== 'object')) field.type = typeof after[key] === 'boolean' ? 'boolean' : 'string';
    if (before[key] !== null && typeof before[key] === 'object' || after[key] !== null && typeof after[key] === 'object') field.type = 'complex';
    if (attributeValuesEqual(field, before[key], after[key])) continue;
    delta[key] = after[key];
  }
  return delta;
}

/** Enforce on the actual XML after the existing native serializer, not just on the form. */
export function enforceWfsAttributeTransaction(transaction: Element, access: WfsAttributeAccess,
  namespaces: Record<string, string>): void {
  const denied = new Set<string>();
  for (const operation of Array.from(transaction.children)) {
    if (operation.localName === 'Insert') {
      if (!access.schema) throw new Error('unverified');
      for (const feature of Array.from(operation.children)) {
        if (`{${feature.namespaceURI ?? ''}}${feature.localName}` !== access.schema.featureType) throw new Error('unverified');
        for (const property of Array.from(feature.children)) {
          const exact = access.schema.attributes.filter((field) => wfsAttributeIdentity(field) === `{${property.namespaceURI ?? ''}}${property.localName}`);
          const local = access.schema.attributes.filter((field) => field.name === property.localName);
          // OpenLayers writes initially unqualified properties in the feature namespace.
          const field = exact.length === 1 ? exact[0] : local.length === 1 && local[0].namespace === '' &&
            property.namespaceURI === feature.namespaceURI ? local[0] : undefined;
          if (!field) throw new Error('unverified');
          if (field.generated) property.remove();
          else if (field.namespace !== (property.namespaceURI ?? '')) {
            const replacement = transaction.ownerDocument.createElementNS(field.namespace || null, field.name);
            for (const attribute of Array.from(property.attributes)) {
              if (attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/') replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
            }
            replacement.append(...Array.from(property.childNodes));
            property.replaceWith(replacement);
          }
        }
      }
    } else if (operation.localName === 'Update') {
      const type = operation.getAttribute('typeName')?.split(':') ?? [];
      const namespace = type.length === 2 ? operation.lookupNamespaceURI(type[0]) ?? namespaces[type[0]]
        : type.length === 1 ? operation.lookupNamespaceURI(null) : null;
      if (!namespace || `{${namespace}}${type.at(-1)}` !== access.schema?.featureType) throw new Error('unverified');
      for (const property of Array.from(operation.children).filter((node) => node.localName === 'Property')) {
        const reference = Array.from(property.children).find((node) => ['Name', 'ValueReference'].includes(node.localName));
        const key = reference?.textContent?.trim() ?? '';
        const ns = key.includes(':') ? reference?.lookupNamespaceURI(key.split(':')[0]) : undefined;
        const field = nativeWfsAttribute(access, key, {...namespaces, ...(ns ? {[key.split(':')[0]]: ns} : {})});
        if (!field) throw new Error('unverified');
        if (key.includes(':') && !reference?.lookupNamespaceURI(key.split(':')[0])) {
          reference?.setAttributeNS('http://www.w3.org/2000/xmlns/', `xmlns:${key.split(':')[0]}`, field.namespace);
        }
        if (field.generated || !field.geometry && !access.editable.has(wfsAttributeIdentity(field))) denied.add(wfsAttributeIdentity(field));
      }
    }
  }
  if (denied.size) throw Object.assign(new Error('attributeForbidden'), {attributes: [...denied]});
}
