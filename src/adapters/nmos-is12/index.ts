export { Is12EgressAdapter, Is12AdapterFactory } from './Is12EgressAdapter.js';
export { Is12AdapterConfigSchema, IS12_CONFIG_JSON_SCHEMA, Is04ConfigSchema, Is04NodeApiConfigSchema, Is04RegistrationConfigSchema } from './config.js';
export type { Is12AdapterConfig, Is04Config, Is04NodeApiConfig, Is04RegistrationConfig } from './config.js';
export { buildCatalogue } from './ms05/catalogue.js';
export type { Catalogue } from './ms05/catalogue.js';
export { IdentityRegistry, IdentityRegistryError, OID_ROOT, OID_DEVICE_MANAGER, OID_CLASS_MANAGER } from './ms05/IdentityRegistry.js';
export { dispatch, NC_OBJECT_METHOD, NC_CLASS_MANAGER_METHOD } from './ms05/NcObjectMethods.js';
export type { DispatchContext, PropertyIdMap, DispatchResult } from './ms05/NcObjectMethods.js';
export { IS12MessageType, NcMethodStatus } from './ms05/types.js';
export type {
  NcClassDescriptor,
  NcDatatypeDescriptor,
  NcMethodResult,
  NcMethodResultPropertyValue,
  NcMethodResultError,
  NcMethodResultId,
  IS12Message,
  IS12CommandMessage,
  IS12CommandResponseMessage,
  IS12SubscriptionMessage,
  IS12SubscriptionResponseMessage,
  IS12NotificationMessage,
  IS12ErrorMessage,
} from './ms05/types.js';

