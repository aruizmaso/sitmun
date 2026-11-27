package org.sitmun.authorization.editing;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.sitmun.domain.DomainConstants;
import org.sitmun.domain.cartography.Cartography;
import org.sitmun.domain.task.Task;

/** Separate from legacy mobile fields. Persisted identities are Clark QNames, never labels. */
public record WfsAttributePolicy(int version, String featureType, Set<String> editableAttributes,
    Set<String> hiddenAttributes, Set<String> generatedAttributes) {
  public static final String KEY = "wfsAttributePolicy";

  public WfsAttributePolicy(int version, String featureType, Set<String> editableAttributes) {
    this(version, featureType, editableAttributes, Set.of(), Set.of());
  }

  public static WfsAttributePolicy read(Map<String, Object> properties) {
    if (properties == null || !(properties.get(KEY) instanceof Map<?, ?> raw)
        || !(raw.get("version") instanceof Number version)
        || !(version.doubleValue() == 1 || version.doubleValue() == 2)
        || !(raw.get("featureType") instanceof String featureType)
        || !identity(featureType)) return null;
    Set<String> editable = readFields(raw.get("editableAttributes"));
    Set<String> hidden = version.intValue() == 1 ? Set.of() : readFields(raw.get("hiddenAttributes"));
    Set<String> generated = version.intValue() == 1 ? Set.of() : readFields(raw.get("generatedAttributes"));
    if (editable == null || hidden == null || generated == null) return null;
    return new WfsAttributePolicy(version.intValue(), featureType, editable, hidden, generated);
  }

  private static Set<String> readFields(Object value) {
    if (!(value instanceof List<?> fields) || fields.size() > 4096
        || fields.stream().anyMatch(field -> !(field instanceof String name) || !identity(name))) return null;
    Set<String> result = new LinkedHashSet<>();
    fields.forEach(field -> result.add((String) field));
    return Set.copyOf(result);
  }

  private static boolean identity(String name) {
    return name.length() <= 2048 && name.matches("\\{[^{}]*}[^{}:]+")
        && name.substring(name.indexOf('}') + 1).matches("[\\p{L}_][\\p{L}\\p{N}_.-]*");
  }

  public static WfsAttributePolicy effective(Cartography layer, Collection<Task> tasks, WfsAttributeSchema schema) {
    Set<String> editable = new LinkedHashSet<>();
    Set<String> generated = new LinkedHashSet<>();
    Set<String> hidden = new LinkedHashSet<>(schema.attributes().stream()
        .filter(a -> !a.geometry()).map(WfsAttributeSchema.Attribute::expandedName).toList());
    var applicable = tasks.stream().filter(DomainConstants.Tasks::isCartographyEditionTask)
        .filter(task -> org.sitmun.domain.cartography.CartographyBlockPolicy.isNotDirectlyBlocked(task.getCartography())
            && org.sitmun.domain.service.ServiceBlockPolicy.isAccessibleInClientProfile(task.getCartography().getService()))
        .filter(task -> Objects.equals(task.getCartography().getId(), layer.getId()))
        .filter(task -> task.getCartography().getService() != null && layer.getService() != null
            && Objects.equals(task.getCartography().getService().getId(), layer.getService().getId()))
        .toList();
    for (Task task : applicable) {
      var policy = read(task.getProperties());
      if (policy == null || !schema.featureType().equals(policy.featureType())) {
        hidden.clear();
        // A present but uninterpretable policy may contain generation rules we
        // cannot safely recover. Do not allow another task to bypass them.
        if (task.getProperties() != null && task.getProperties().containsKey(KEY)) {
          generated.addAll(schema.attributes().stream().filter(a -> !a.geometry())
              .map(WfsAttributeSchema.Attribute::expandedName).toList());
        }
        continue;
      }
      editable.addAll(policy.editableAttributes());
      generated.addAll(policy.generatedAttributes());
      hidden.retainAll(policy.hiddenAttributes());
    }
    generated.addAll(schema.attributes().stream().filter(a -> !a.geometry() && a.generated())
        .map(WfsAttributeSchema.Attribute::expandedName).toList());
    generated.retainAll(schema.attributes().stream().filter(a -> !a.geometry())
        .map(WfsAttributeSchema.Attribute::expandedName).toList());
    editable.retainAll(schema.attributes().stream().filter(a -> !a.geometry() && !a.generated())
        .map(WfsAttributeSchema.Attribute::expandedName).toList());
    editable.removeAll(generated);
    editable.removeAll(hidden);
    return new WfsAttributePolicy(2, schema.featureType(), Set.copyOf(editable),
        Set.copyOf(hidden), Set.copyOf(generated));
  }
}
