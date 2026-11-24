# Custom Extension Registry Architecture

## Overview
Echo Music Web enables users to register custom audio provider extensions (add-ons) to resolve external audio sources before or in place of default YouTube streams.

## Registry & Manifest Contracts

### Add-on Endpoint (`AddonEndpoint`)
Enforces runtime validation via `addonEndpointSchema`:
- `id`: Unique identifier (`addon_<timestamp>_<random>`).
- `name`: User-defined or manifest-resolved display name.
- `url`: Valid HTTP/HTTPS endpoint without trailing slashes.
- `enabled`: Boolean toggle for active source resolution.
- `priority`: Numeric rank (1 = highest priority).

### Typed Manifest (`AddonManifest`)
Add-on servers provide `/manifest.json` validated via `addonManifestSchema`:
```json
{
  "id": "lossless-provider",
  "name": "Lossless Audio Vault",
  "version": "1.2.0",
  "description": "High-fidelity FLAC streaming provider"
}
```

### Health Status Check
Probes `/manifest.json` on the target extension with latency measurement and error capture:
- `online`: Manifest retrieved and verified with response latency.
- `error`: Endpoint returned non-200 HTTP code or malformed payload.
- `offline`: Network unreachable, DNS failure, or aborted request.

## Priority Ordering & Deduplication
- Multiple endpoints are evaluated strictly in ascending priority order (1, 2, 3...).
- Reordering (`reorderAddons`) updates priority indices atomically.
- Duplicate URL registrations are rejected before side-effects.

## Registry Metrics
Monitored via `getExtensionRegistryMetrics()`:
- `registrations`: Total successful additions.
- `removals`: Add-on deletions.
- `toggles`: Enable/disable operations.
- `healthChecks`: Endpoint health pings initiated.
- `healthCheckFailures`: Health pings resulting in error or offline.
