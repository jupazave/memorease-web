const DESCRIPTOR_INTERFACE = 4;
const DESCRIPTOR_ENDPOINT = 5;

/**
 * Bytes per microframe of an endpoint, from a raw configuration descriptor. Chromium reports the
 * undecoded wMaxPacketSize as `packetSize`, so the high-bandwidth multiplier must be read here.
 */
export function isoBytesPerMicroframe(config: Uint8Array, alternate: number, endpointAddress: number): number {
  let current = -1;
  for (let i = 0; i + 1 < config.length && config[i] > 0; i += config[i]) {
    const type = config[i + 1];
    if (type === DESCRIPTOR_INTERFACE) {
      current = config[i + 3];
    } else if (type === DESCRIPTOR_ENDPOINT && current === alternate && config[i + 2] === endpointAddress) {
      const w = config[i + 4] | (config[i + 5] << 8);
      return (w & 0x7ff) * (1 + ((w >> 11) & 3));
    }
  }
  throw new Error(`endpoint 0x${endpointAddress.toString(16)} not found in alternate ${alternate}`);
}
