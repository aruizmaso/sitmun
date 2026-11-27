export interface WfsAttributePolicy {
  version: 1 | 2;
  featureType: string;
  editableAttributes: string[];
  hiddenAttributes?: string[];
  generatedAttributes?: string[];
  obsoleteAttributes?: string[];
  obsoleteHiddenAttributes?: string[];
  obsoleteGeneratedAttributes?: string[];
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
  visible: boolean;
  generated: boolean;
  serviceGenerated: boolean;
}

export function isWfsIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048
    && /^\{[^{}]*\}[\p{L}_][\p{L}\p{N}_.-]*$/u.test(value);
}

export function isCompatibleWfsPolicy(raw: unknown, schema: WfsAttributeSchema): raw is WfsAttributePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const policy = raw as Partial<WfsAttributePolicy>;
  const list = (value: unknown) => Array.isArray(value) && value.length <= 4096 && value.every(isWfsIdentity);
  return (policy.version === 1 || policy.version === 2 && list(policy.hiddenAttributes) && list(policy.generatedAttributes)) && policy.featureType === schema.featureType
    && isWfsIdentity(policy.featureType) && Array.isArray(policy.editableAttributes)
    && policy.editableAttributes.length <= 4096 && policy.editableAttributes.every(isWfsIdentity)
    && [policy.obsoleteAttributes, ...(policy.version === 2 ? [policy.obsoleteHiddenAttributes, policy.obsoleteGeneratedAttributes] : [])]
      .every((value) => value === undefined || list(value));
}

export function wfsPermissionRows(raw: unknown, schema: WfsAttributeSchema): WfsPermissionRow[] {
  const policy = isCompatibleWfsPolicy(raw, schema) ? raw : undefined;
  const selected = new Set(policy?.editableAttributes ?? []);
  const hidden = new Set(policy?.version === 2 ? policy.hiddenAttributes : []);
  const generated = new Set(policy?.version === 2 ? policy.generatedAttributes : []);
  return schema.attributes.filter((field) => !field.geometry).map((field) => {
    const identity = `{${field.namespace}}${field.name}`;
    const visible = !hidden.has(identity);
    const isGenerated = field.generated || generated.has(identity);
    return {identity, name: field.name, namespace: field.namespace, visible, generated: isGenerated,
      serviceGenerated: field.generated, editable: visible && !isGenerated && selected.has(identity)};
  });
}

export function wfsPolicyFromRows(featureType: string, rows: readonly WfsPermissionRow[], previous?: WfsAttributePolicy): WfsAttributePolicy {
  const editableAttributes = rows.filter((row) => row.editable).map((row) => row.identity);
  const obsoleteAttributes = previous?.obsoleteAttributes?.filter((identity) => !editableAttributes.includes(identity));
  const hiddenAttributes = rows.filter((row) => !row.visible).map((row) => row.identity);
  const generatedAttributes = rows.filter((row) => row.generated && (!row.serviceGenerated ||
    previous?.version === 2 && previous.generatedAttributes?.includes(row.identity))).map((row) => row.identity);
  const policy = {...previous, version: 2 as const, featureType, editableAttributes,
    hiddenAttributes, generatedAttributes};
  if (obsoleteAttributes?.length) policy.obsoleteAttributes = obsoleteAttributes;
  else delete policy.obsoleteAttributes;
  for (const [key, active] of [['obsoleteHiddenAttributes', hiddenAttributes],
    ['obsoleteGeneratedAttributes', generatedAttributes]] as const) {
    const remaining = previous?.version === 2 ? previous[key]?.filter((identity) => !active.includes(identity)) : undefined;
    if (remaining?.length) policy[key] = remaining;
    else delete policy[key];
  }
  return policy;
}
