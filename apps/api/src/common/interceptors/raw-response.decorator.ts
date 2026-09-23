import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_METADATA = Symbol('app:raw-response');

/**
 * Sends this handler's output as it is, outside the `BaseResponse` envelope.
 *
 * For the one shape the envelope cannot describe: a **stream**. An SSE handler returns
 * an Observable that emits for as long as the browser stays connected, and the
 * interceptor would wrap every single emission — turning each event into
 * `{"success":true,"data":{…}}` and, worse, swallowing the `type` that tells
 * `EventSource` which listener the message belongs to.
 *
 * Deliberately not inferred from Nest's own `@Sse` metadata: that constant lives in
 * `@nestjs/common/constants`, which is not part of the public surface and has moved
 * between majors. One explicit decorator is cheaper than a deep import that breaks on
 * an upgrade, and it says at the call site why this route is different.
 */
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_METADATA, true);
