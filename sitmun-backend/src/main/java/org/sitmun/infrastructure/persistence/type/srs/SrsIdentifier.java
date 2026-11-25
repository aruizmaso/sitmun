package org.sitmun.infrastructure.persistence.type.srs;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Normalizes OGC EPSG identifiers without hiding invalid or unrecognized values. */
public final class SrsIdentifier {

  private static final Pattern OGC_EPSG =
      Pattern.compile(
          "^(?:EPSG:|urn:ogc:def:crs:EPSG:[^:]*:|urn:x-ogc:def:crs:EPSG:|https?://www\\.opengis\\.net/def/crs/EPSG/[^/]+/)(\\d+)$",
          Pattern.CASE_INSENSITIVE);

  private SrsIdentifier() {}

  public static String normalize(String value) {
    if (value == null) {
      return null;
    }
    Matcher matcher = OGC_EPSG.matcher(value.trim());
    return matcher.matches() ? "EPSG:" + matcher.group(1) : value;
  }
}
