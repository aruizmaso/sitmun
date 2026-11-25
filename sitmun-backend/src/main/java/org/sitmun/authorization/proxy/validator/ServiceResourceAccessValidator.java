package org.sitmun.authorization.proxy.validator;

import static org.sitmun.domain.DomainConstants.Services.*;
import static org.sitmun.infrastructure.security.core.SecurityConstants.isPublicPrincipal;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.sitmun.authorization.client.service.AuthorizationService;
import org.sitmun.authorization.editing.WfsEditingPolicy;
import org.sitmun.authorization.proxy.dto.ConfigProxyRequestDto;
import org.sitmun.authorization.proxy.ogc.CartographyGrant;
import org.sitmun.authorization.proxy.ogc.OgcLayerAccess;
import org.sitmun.authorization.proxy.ogc.OgcRequestNames;
import org.sitmun.domain.application.ApplicationRepository;
import org.sitmun.domain.cartography.Cartography;
import org.sitmun.domain.cartography.CartographyRepository;
import org.sitmun.domain.cartography.parameter.CartographyServiceParameterRepository;
import org.sitmun.domain.role.RoleRepository;
import org.sitmun.domain.service.ServiceRepository;
import org.sitmun.domain.territory.TerritoryRepository;
import org.sitmun.domain.user.UserRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Validates user access to services through the proxy middleware.
 *
 * <p>This validator enforces comprehensive authorization for service requests:
 *
 * <h3>Service-Level Authorization</h3>
 *
 * <ul>
 *   <li>Service must exist and not be blocked
 *   <li>User must hold a role of this application in the territory
 *   <li>User must have access to at least one cartography using this service
 *   <li>Roles are {@code RoleRepository.findRolesByApplicationAndUserAndTerritory}. Accessible
 *       cartographies are then {@code cartographyRepository.findByRolesAndTerritory}
 * </ul>
 *
 * <h3>Layer-Level Authorization</h3>
 *
 * <ul>
 *   <li>A request with {@code cartographyId} may name only that cartography's layers
 *   <li>GetMap requires the full layer set. GetFeatureInfo and DescribeLayer may name a subset
 *   <li>On the service path, each name must belong to some accessible cartography. A transaction is
 *       denied. GetMap, GetFeatureInfo, GetFeature, and DescribeLayer are denied when a cartography
 *       involved has its own service parameters
 * </ul>
 *
 * <p>The authorization model follows this hierarchy:
 *
 * <pre>
 * Application.availableRoles
 *   → UserConfiguration (Territory + Role)
 *     → Role → CartographyPermission
 *       → Cartography (members)
 *         → Service + layers[]
 *         → CartographyAvailability (Territory)
 * </pre>
 *
 * @see org.sitmun.authorization.client.service.AuthorizationService
 * @see org.sitmun.domain.role.RoleRepository#findRolesByApplicationAndUserAndTerritory
 * @see org.sitmun.domain.cartography.CartographyRepository#findByRolesAndTerritory
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ServiceResourceAccessValidator implements ResourceAccessValidator {

  // Service-based proxy types (OGC services)
  // Note: API type for tasks is handled by TaskResourceAccessValidator
  private static final Set<String> SUPPORTED_TYPES = Set.of(TYPE_WMS, TYPE_WMTS, TYPE_WFS);

  private final ServiceRepository serviceRepository;
  private final UserRepository userRepository;
  private final ApplicationRepository applicationRepository;
  private final TerritoryRepository territoryRepository;
  private final CartographyRepository cartographyRepository;
  private final CartographyServiceParameterRepository cartographyServiceParameterRepository;
  private final RoleRepository roleRepository;
  private final AuthorizationService authorizationService;
  private final WfsEditingPolicy wfsEditingPolicy;

  @Override
  public boolean supports(String type) {
    return SUPPORTED_TYPES.stream().anyMatch(t -> t.equalsIgnoreCase(type));
  }

  @Override
  @Transactional(readOnly = true)
  public boolean validate(ConfigProxyRequestDto request, String userName) {
    return authorize(request, userName).allowed();
  }

  @Override
  @Transactional(readOnly = true)
  public Authorization authorize(ConfigProxyRequestDto request, String userName) {
    log.debug(
        "Validating Service access: user={}, appId={}, terId={}, type={}, serviceId={}",
        userName,
        request.getAppId(),
        request.getTerId(),
        request.getType(),
        request.getTypeId());

    var serviceOpt = serviceRepository.findById(request.getTypeId());
    if (serviceOpt.isEmpty()) {
      log.warn("Service not found: {}", request.getTypeId());
      return Authorization.denied();
    }

    var service = serviceOpt.get();
    if (Boolean.TRUE.equals(service.getBlocked())) {
      log.warn(
          "Access denied: Service is blocked - serviceId={}, user={}",
          request.getTypeId(),
          userName);
      return Authorization.denied();
    }

    var userOpt = userRepository.findByUsername(userName);
    if (userOpt.isEmpty()) {
      log.warn("User not found: {}", userName);
      return Authorization.denied();
    }

    var applicationExists = applicationRepository.existsById(request.getAppId());
    if (!applicationExists) {
      log.warn("Application not found: {}", request.getAppId());
      return Authorization.denied();
    }

    // Check if territory exists (terId can be 0 for public access)
    if (request.getTerId() > 0) {
      var territoryExists = territoryRepository.existsById(request.getTerId());
      if (!territoryExists) {
        log.warn("Territory not found: {}", request.getTerId());
        return Authorization.denied();
      }
    }

    var userRoles =
        roleRepository.findRolesByApplicationAndUserAndTerritory(
            userName, request.getAppId(), request.getTerId());

    if (userRoles.isEmpty()) {
      log.warn(
          "Access denied: User {} has no role of application {} in territory {} - serviceId={}",
          userName,
          request.getAppId(),
          request.getTerId(),
          request.getTypeId());
      return Authorization.denied();
    }

    var accessibleCartographies =
        cartographyRepository.findByRolesAndTerritory(userRoles, request.getTerId());

    var serviceCartographies =
        accessibleCartographies.stream()
            .filter(
                cartography ->
                    cartography.getService() != null
                        && cartography.getService().getId().equals(service.getId()))
            .toList();

    if (serviceCartographies.isEmpty()) {
      log.warn(
          "Access denied: User {} has no cartography permissions for service {} in territory {}",
          userName,
          request.getTypeId(),
          request.getTerId());
      return Authorization.denied();
    }

    List<CartographyGrant> grants = serviceCartographies.stream().map(this::grant).toList();
    OgcRequestNames.View names =
        OgcRequestNames.parse(request.getParameters(), request.getRequestBody());
    if (names.rejected()) return Authorization.denied();
    if (names.operation() == OgcRequestNames.Operation.TRANSACTION) {
      if (isPublicPrincipal(userName)
          || request.getCartographyId() == null
          || !TYPE_WFS.equalsIgnoreCase(request.getType())
          || !TYPE_WFS.equalsIgnoreCase(service.getType())
          || !"POST".equalsIgnoreCase(request.getMethod())
          || !hasOnlyWriteEnvelopeParameters(request)) {
        return Authorization.denied();
      }
      try {
        // Full account/application/territory gate and the existing effective-role task query.
        var tasks = authorizationService.findTasksByUserApplicationAndTerritory(
            userName, request.getAppId(), request.getTerId());
        return serviceCartographies.stream()
            .filter(layer -> Objects.equals(layer.getId(), request.getCartographyId()))
            .findFirst()
            .map(layer -> {
              var destination =
                  wfsEditingPolicy.destination(
                      layer,
                      tasks,
                      accessibleCartographies,
                      userName,
                      request.getAppId(),
                      request.getTerId());
              if (destination.isEmpty()) return Authorization.denied();
              var types = wfsEditingPolicy.target(layer, destination.get());
              if (types.isEmpty() || !OgcLayerAccess.allowTransaction(names, types.get())) {
                return Authorization.denied();
              }
              try {
                if (org.sitmun.authorization.editing.WfsTransaction.deletesOnly(
                    request.getRequestBody())) {
                  return new Authorization(true, destination);
                }
                var schema = wfsEditingPolicy.schema(layer, destination.get());
                if (schema.isEmpty()) return Authorization.denied();
                var policy =
                    org.sitmun.authorization.editing.WfsAttributePolicy.effective(
                        layer, tasks, schema.get());
                var denied =
                    org.sitmun.authorization.editing.WfsTransaction.forbiddenAttributes(
                        request.getRequestBody(), schema.get(), policy);
                if (!denied.isEmpty()) {
                  throw new org.sitmun.authorization.editing.WfsAttributeDeniedException(denied);
                }
                return new Authorization(true, destination);
              } catch (javax.xml.stream.XMLStreamException ex) {
                return Authorization.denied();
              }
            })
            .orElseGet(Authorization::denied);
      } catch (org.springframework.security.access.AccessDeniedException ex) {
        return Authorization.denied();
      }
    }
    boolean allowed =
        request.getCartographyId() == null
            ? OgcLayerAccess.allowService(names, grants)
            : allowCartography(request.getCartographyId(), grants, names);
    if (!allowed) {
      log.warn(
          "Access denied: user {} service {} cartography {} operation {}",
          userName,
          request.getTypeId(),
          request.getCartographyId(),
          names.operation());
      return Authorization.denied();
    }

    log.debug("Service access validation passed for user: {}", userName);
    return Authorization.granted();
  }

  private static boolean hasOnlyWriteEnvelopeParameters(ConfigProxyRequestDto request) {
    // Routing and vendor options come from verified server configuration, not the writer.
    return request.getParameters() == null || request.getParameters().entrySet().stream()
        .allMatch(entry ->
            "SERVICE".equalsIgnoreCase(entry.getKey()) && TYPE_WFS.equalsIgnoreCase(entry.getValue())
                || "REQUEST".equalsIgnoreCase(entry.getKey())
                    && "Transaction".equalsIgnoreCase(entry.getValue()));
  }

  private boolean allowCartography(
      Integer cartographyId, List<CartographyGrant> grants, OgcRequestNames.View names) {
    return grants.stream()
        .filter(grant -> Objects.equals(grant.id(), cartographyId))
        .findFirst()
        .map(grant -> OgcLayerAccess.allowCartography(names, grant))
        .orElse(false);
  }

  private CartographyGrant grant(Cartography cartography) {
    Set<String> layers = new LinkedHashSet<>();
    if (cartography.getLayers() != null) {
      cartography.getLayers().stream()
          .filter(Objects::nonNull)
          .map(String::trim)
          .filter(layer -> !layer.isEmpty())
          .forEach(layers::add);
    }
    Integer id = cartography.getId();
    boolean hasParameters =
        id != null && cartographyServiceParameterRepository.existsByCartography_Id(id);
    return new CartographyGrant(id, layers, hasParameters);
  }
}
