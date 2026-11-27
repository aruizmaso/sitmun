import { AttributeData, AttributeFormField } from './feature-attribute-draft';
import { WfsAttributeSchema } from './wfs-attribute-schema';

export interface VerifiedGeoJsonFeature {
  properties: Record<string, unknown>;
}

/** Accept only a single GeoJSON feature returned for the requested persistent WFS id. */
export function verifiedGeoJsonFeature(value: unknown, expectedId: string, expectedType?: string): VerifiedGeoJsonFeature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalidFeatureCollection');
  const collection = value as Record<string, unknown>;
  if (collection['type'] !== 'FeatureCollection' || !Array.isArray(collection['features']) ||
      collection['features'].length !== 1) throw new Error('invalidFeatureCollection');
  const responseType = collection['name'];
  if (typeof responseType === 'string' && expectedType) {
    const expectedLocalName = expectedType.split(':').at(-1);
    if (responseType !== expectedType && responseType !== expectedLocalName) throw new Error('invalidFeatureType');
  }
  const feature = collection['features'][0];
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) throw new Error('invalidFeature');
  const item = feature as Record<string, unknown>;
  if (item['type'] !== 'Feature' || String(item['id'] ?? '') !== expectedId ||
      !item['properties'] || typeof item['properties'] !== 'object' || Array.isArray(item['properties'])) {
    throw new Error('invalidFeatureIdentity');
  }
  return { properties: item['properties'] as Record<string, unknown> };
}

/**
 * Project GeoJSON's local property names only when the XSD QName is unique.
 * Ambiguous local names remain unknown; they are never assigned by guesswork.
 */
export function mergeVerifiedGeoJsonProperties(
  data: AttributeData,
  schema: WfsAttributeSchema,
  fields: readonly AttributeFormField[],
  properties: Record<string, unknown>,
  protectedFields: ReadonlySet<string> = new Set()
): { data: AttributeData; unknownFields: Set<string> } {
  const merged: AttributeData = { ...data };
  const unknownFields = new Set<string>();
  const definitions = schema.fields.filter((field) =>
    !['http://www.opengis.net/gml', 'http://www.opengis.net/gml/3.2'].includes(field.namespace));
  for (const field of definitions) {
    const identity = `{${field.namespace}}${field.name}`;
    if (protectedFields.has(identity)) continue;
    const mapped = fields.filter((item) =>
      item.schema?.name === field.name && item.schema.namespace === field.namespace);
    if (mapped.length === 1 && mapped[0].verified &&
        (mapped[0].present || Object.hasOwn(data, mapped[0].name) && data[mapped[0].name] !== undefined)) continue;
    const sameLocalName = definitions.filter((candidate) => candidate.name === field.name);
    const prefixes = Object.keys(schema.namespaces ?? {}).filter((prefix) =>
      schema.namespaces?.[prefix] === field.namespace);
    const qualifiedKeys = prefixes.map((prefix) => `${prefix}:${field.name}`).filter((key) =>
      Object.hasOwn(properties, key));
    const localPresent = Object.hasOwn(properties, field.name);
    if (qualifiedKeys.length > 1 || qualifiedKeys.length === 1 && localPresent) {
      unknownFields.add(identity);
      continue;
    }
    if (sameLocalName.length !== 1 && qualifiedKeys.length !== 1) {
      unknownFields.add(identity);
      continue;
    }
    const propertyKey = qualifiedKeys.length === 1 ? qualifiedKeys[0] :
      sameLocalName.length === 1 && localPresent ? field.name : undefined;
    if (!propertyKey) continue;
    if (mapped.length !== 1 || !mapped[0].verified) {
      unknownFields.add(identity);
      continue;
    }
    Object.defineProperty(merged, mapped[0].name, {
      configurable: true, enumerable: true, writable: true, value: properties[propertyKey]
    });
  }
  return { data: merged, unknownFields };
}
