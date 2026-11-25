export interface WfsAttributePolicy {
  version: 1;
  featureType: string;
  editableAttributes: string[];
  obsoleteAttributes?: string[];
}

export interface WfsAttributeSchema {
  featureType: string;
  attributes: {name: string; namespace: string; type: string; geometry: boolean; generated: boolean}[];
}

export interface WfsPermissionRow {
  identity: string;
  name: string;
  namespace: string;
  editable: boolean;
}

export function isWfsIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048
    && /^\{[^{}]*\}[\p{L}_][\p{L}\p{N}_.-]*$/u.test(value);
}

export function isCompatibleWfsPolicy(raw: unknown, schema: WfsAttributeSchema): raw is WfsAttributePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const policy = raw as Partial<WfsAttributePolicy>;
  return policy.version === 1 && policy.featureType === schema.featureType
    && isWfsIdentity(policy.featureType) && Array.isArray(policy.editableAttributes)
    && policy.editableAttributes.length <= 4096 && policy.editableAttributes.every(isWfsIdentity)
    && (policy.obsoleteAttributes === undefined || Array.isArray(policy.obsoleteAttributes)
      && policy.obsoleteAttributes.length <= 4096 && policy.obsoleteAttributes.every(isWfsIdentity));
}

export function wfsPermissionRows(raw: unknown, schema: WfsAttributeSchema): WfsPermissionRow[] {
  const selected = new Set(isCompatibleWfsPolicy(raw, schema) ? raw.editableAttributes : []);
  return schema.attributes.filter((field) => !field.geometry && !field.generated).map((field) => {
    const identity = `{${field.namespace}}${field.name}`;
    return {identity, name: field.name, namespace: field.namespace, editable: selected.has(identity)};
  });
}

export function wfsPolicyFromRows(featureType: string, rows: readonly WfsPermissionRow[], previous?: WfsAttributePolicy): WfsAttributePolicy {
  const editableAttributes = rows.filter((row) => row.editable).map((row) => row.identity);
  const obsoleteAttributes = previous?.obsoleteAttributes?.filter((identity) => !editableAttributes.includes(identity));
  const policy = {...previous, version: 1 as const, featureType, editableAttributes};
  if (obsoleteAttributes?.length) policy.obsoleteAttributes = obsoleteAttributes;
  else delete policy.obsoleteAttributes;
  return policy;
}
