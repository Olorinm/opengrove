import type {
  ArtifactAsset,
  ArtifactCreateRequest,
  ArtifactFilter,
  ArtifactPreview,
  ArtifactRecord,
  JsonObject,
} from "../types.js";

export class ArtifactStore {
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private sequence = 0;

  create(input: ArtifactCreateRequest): ArtifactRecord {
    const now = new Date().toISOString();
    const id = input.id ?? `artifact_${++this.sequence}`;
    const record: ArtifactRecord = {
      id,
      type: input.type,
      title: input.title,
      status: input.status,
      version: input.version ?? 1,
      tags: input.tags ?? [],
      data: input.data ?? {},
      assets: normalizeArtifactAssets(input.assets),
      preview: normalizeArtifactPreview(input.preview),
      createdAt: now,
      updatedAt: now,
      sourceRefs: input.sourceRefs,
      parentId: input.parentId,
      variantOf: input.variantOf,
      derivedFrom: input.derivedFrom,
      lineage: input.lineage,
      provenance: input.provenance,
    };
    this.artifacts.set(id, record);
    return record;
  }

  restore(records: ArtifactRecord[]): void {
    this.artifacts.clear();
    this.sequence = 0;

    for (const record of records) {
      this.artifacts.set(record.id, record);
      const match = record.id.match(/^artifact_(\d+)$/);
      if (match) {
        this.sequence = Math.max(this.sequence, Number(match[1]));
      }
    }
  }

  get(id: string): ArtifactRecord | undefined {
    return this.artifacts.get(id);
  }

  list(filter: ArtifactFilter = {}): ArtifactRecord[] {
    const ids = filter.ids ? new Set(filter.ids) : undefined;
    const records = Array.from(this.artifacts.values()).filter((record) => {
      if (ids && !ids.has(record.id)) return false;
      if (filter.type && record.type !== filter.type) return false;
      if (filter.parentId && record.parentId !== filter.parentId) return false;
      if (filter.tags?.some((tag) => !record.tags.includes(tag))) return false;
      return true;
    });

    return typeof filter.limit === "number" ? records.slice(0, filter.limit) : records;
  }

  update(
    id: string,
    patch: Partial<Omit<ArtifactRecord, "id" | "createdAt" | "updatedAt">>,
  ): ArtifactRecord {
    const current = this.artifacts.get(id);
    if (!current) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const updated: ArtifactRecord = {
      ...current,
      ...patch,
      assets: patch.assets === undefined ? current.assets : normalizeArtifactAssets(patch.assets),
      preview: patch.preview === undefined ? current.preview : normalizeArtifactPreview(patch.preview),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.artifacts.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.artifacts.delete(id);
  }
}

function normalizeArtifactAssets(value: unknown): ArtifactAsset[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const assets = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      kind: normalizeAssetKind(item.kind),
      uri: typeof item.uri === "string" ? item.uri : undefined,
      path: typeof item.path === "string" ? item.path : undefined,
      title: typeof item.title === "string" ? item.title : undefined,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
      metadata: isJsonObject(item.metadata) ? item.metadata : undefined,
    }))
    .filter((asset) => Boolean(asset.uri || asset.path || asset.title));

  return assets.length > 0 ? assets : undefined;
}

function normalizeArtifactPreview(value: unknown): ArtifactPreview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const previewValue = value as Record<string, unknown>;
  const preview = {
    title: typeof previewValue.title === "string" ? previewValue.title : undefined,
    text: typeof previewValue.text === "string" ? previewValue.text : undefined,
    imageUri: typeof previewValue.imageUri === "string" ? previewValue.imageUri : undefined,
    mimeType: typeof previewValue.mimeType === "string" ? previewValue.mimeType : undefined,
    status: typeof previewValue.status === "string" ? previewValue.status : undefined,
  };

  return Object.values(preview).some(Boolean) ? preview : undefined;
}

function normalizeAssetKind(value: unknown): ArtifactAsset["kind"] {
  return value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "file" ||
    value === "url" ||
    value === "text"
    ? value
    : "file";
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
