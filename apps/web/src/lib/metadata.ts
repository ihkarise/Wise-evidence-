/**
 * Server-side metadata provider factory (docs/26 §5, §11-12).
 *
 * Uses the host-pinned, bounded CrossrefMetadataProvider with the platform
 * fetch. Set `METADATA_PROVIDER=mock` is not read here to keep it simple; the
 * mock is used directly in tests. This runs server-side only.
 */
import {
  CrossrefMetadataProvider,
  type MetadataProvider,
  type FetchLike,
} from "@wise-evidence/metadata";

let provider: MetadataProvider | null = null;

export function getMetadataProvider(): MetadataProvider {
  provider ??= new CrossrefMetadataProvider({
    fetch: globalThis.fetch as unknown as FetchLike,
    contactEmail: "wiseevidence@example.org",
  });
  return provider;
}
