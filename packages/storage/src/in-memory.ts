import {
  ObjectAlreadyExistsError,
  type MediaStorage,
  type PutObjectInput,
} from "./index";

/** In-memory store for tests. Enforces write-once semantics like the real store. */
export class InMemoryMediaStorage implements MediaStorage {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();

  async put({ key, bytes, contentType }: PutObjectInput): Promise<{ key: string }> {
    if (this.objects.has(key)) throw new ObjectAlreadyExistsError(key);
    // Copy so external mutation of the caller's buffer can't alter stored bytes.
    this.objects.set(key, { bytes: bytes.slice(), contentType });
    return { key };
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes.slice() ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async getUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }
}
