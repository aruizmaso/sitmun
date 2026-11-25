package org.sitmun.infrastructure.persistence.type.srs;

import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.sitmun.test.BaseTest;
import org.sitmun.test.URIConstants;
import org.springframework.security.test.context.support.WithMockUser;

@DisplayName("SpatialReferenceSystem validation test")
class SpatialReferenceSystemTest extends BaseTest {

  @Test
  @DisplayName("POST stores a single EPSG code")
  @WithMockUser(roles = "ADMIN")
  void postStoresASingleEpsgCode() throws Exception {
    mvc.perform(
            post(URIConstants.SERVICES_URI)
                .contentType(APPLICATION_JSON)
                .content(serviceFixture("EPSG:1")))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.supportedSRS[0]").value("EPSG:1"));
  }

  @Test
  @WithMockUser(roles = "ADMIN")
  void postNormalizesOgcEpsgIdentifiers() throws Exception {
    mvc.perform(
            post(URIConstants.SERVICES_URI)
                .contentType(APPLICATION_JSON)
                .content(serviceFixture("urn:ogc:def:crs:EPSG::25831",
                    "http://www.opengis.net/def/crs/EPSG/0/4326",
                    "urn:x-ogc:def:crs:EPSG:3857", " EPSG:4258 ")))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.supportedSRS[0]").value("EPSG:25831"))
        .andExpect(jsonPath("$.supportedSRS[1]").value("EPSG:4326"))
        .andExpect(jsonPath("$.supportedSRS[2]").value("EPSG:3857"))
        .andExpect(jsonPath("$.supportedSRS[3]").value("EPSG:4258"));
  }

  @Test
  @WithMockUser(roles = "ADMIN")
  void patchNormalizesAndPersistsEpsgAndRejectsInvalidValues() throws Exception {
    String location =
        mvc.perform(post(URIConstants.SERVICES_URI).contentType(APPLICATION_JSON)
                .content(serviceFixture("EPSG:1")))
            .andExpect(status().isCreated())
            .andReturn().getResponse().getHeader("Location");

    mvc.perform(patch(location).contentType(APPLICATION_JSON)
            .content("{\"supportedSRS\":[\"urn:ogc:def:crs:EPSG:9.9:25831\"]}"))
        .andExpect(status().is2xxSuccessful());
    mvc.perform(get(location))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.supportedSRS[0]").value("EPSG:25831"));
    mvc.perform(patch(location).contentType(APPLICATION_JSON)
            .content("{\"supportedSRS\":[\"urn:ogc:def:crs:EPSG::invalid\"]}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  @DisplayName("POST rejects a non-EPSG code")
  @WithMockUser(roles = "ADMIN")
  void postRejectsNonEpsgCode() throws Exception {
    mvc.perform(
            post(URIConstants.SERVICES_URI)
                .contentType(APPLICATION_JSON)
                .content(serviceFixture("other")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors[0].field").value("supportedSRS"))
        .andExpect(jsonPath("$.errors[0].rejectedValue[0]").value("other"));
  }

  @Test
  @DisplayName("POST stores two EPSG codes")
  @WithMockUser(roles = "ADMIN")
  void postStoresTwoEpsgCodes() throws Exception {
    mvc.perform(
            post(URIConstants.SERVICES_URI)
                .contentType(APPLICATION_JSON)
                .content(serviceFixture("EPSG:1", "EPSG:2")))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.supportedSRS[0]").value("EPSG:1"))
        .andExpect(jsonPath("$.supportedSRS[1]").value("EPSG:2"));
  }

  @Test
  @DisplayName("POST rejects a mix of EPSG and a non-EPSG code")
  @WithMockUser(roles = "ADMIN")
  void postRejectsMixedEpsgAndOtherCode() throws Exception {
    mvc.perform(
            post(URIConstants.SERVICES_URI)
                .contentType(APPLICATION_JSON)
                .content(serviceFixture("EPSG:1", "other")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors[0].field").value("supportedSRS"))
        .andExpect(jsonPath("$.errors[0].rejectedValue[0]").value("EPSG:1"))
        .andExpect(jsonPath("$.errors[0].rejectedValue[1]").value("other"));
  }

  String serviceFixture(String... projection) throws JSONException {
    return new JSONObject()
        .put("supportedSRS", new JSONArray(projection))
        .put("type", "WMS")
        .put("blocked", "false")
        .put("name", "any name")
        .put("serviceURL", "http://example.com/")
        .toString();
  }
}
