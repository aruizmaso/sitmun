package org.sitmun.infrastructure.persistence.type.srs;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SrsIdentifierTest {

  @Test
  void normalizesRecognizedOgcIdentifiersOnly() {
    for (String value : new String[] {
        " EPSG:25831 ", "epsg:25831", "urn:ogc:def:crs:EPSG::25831",
        "urn:ogc:def:crs:EPSG:9.9:25831", "urn:x-ogc:def:crs:EPSG:25831",
        "http://www.opengis.net/def/crs/EPSG/0/25831",
        "https://www.opengis.net/def/crs/EPSG/0/25831"
    }) {
      assertThat(SrsIdentifier.normalize(value)).isEqualTo("EPSG:25831");
    }
    assertThat(SrsIdentifier.normalize("urn:ogc:def:crs:OTHER::25831"))
        .isEqualTo("urn:ogc:def:crs:OTHER::25831");
    assertThat(SrsIdentifier.normalize("EPSG:invalid")).isEqualTo("EPSG:invalid");
    assertThat(SrsIdentifier.normalize("urn:ogc:def:crs:EPSG::25831")).isEqualTo("EPSG:25831");
    assertThat(SrsIdentifier.normalize("https://www.opengis.net/def/crs/EPSG/0/4326"))
        .isEqualTo("EPSG:4326");
    assertThat(SrsIdentifier.normalize("EPSG:3857")).isEqualTo("EPSG:3857");
    assertThat(SrsIdentifier.normalize("other")).isEqualTo("other");
    assertThat(SrsIdentifier.normalize("")).isEmpty();
    assertThat(SrsIdentifier.normalize(null)).isNull();
  }
}
