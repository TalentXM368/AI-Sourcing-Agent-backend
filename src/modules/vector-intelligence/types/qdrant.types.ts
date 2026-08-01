export interface QdrantPayload {
  entityId: string;
  entityType: 'candidate' | 'job';
  embeddingVersion: string;
  profileVersion: string;
  provider: string;
  model: string;
  dimensions: number;
  indexedAt: string;
  name?: string;
  headline?: string;
  skills?: string[];
  location?: string;
  experienceYears?: number;
  educationLevel?: string;
  industry?: string;
  employmentType?: string;
  seniority?: string;
}

export interface QdrantFilter {
  must?: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

export interface QdrantCondition {
  key: string;
  match?: { value: string | number | boolean } | { keyword: string[] };
  range?: { gte?: number; lte?: number; gt?: number; lt?: number };
}

export interface CollectionConfig {
  name: string;
  vectors: {
    size: number;
    distance: 'Cosine' | 'Euclid' | 'Dot';
  };
  shard_number?: number;
  replication_factor?: number;
  on_disk_payload?: boolean;
  optimizers_config?: {
    indexing_threshold?: number;
  };
}

export interface PayloadIndexField {
  field_name: string;
  field_schema: 'keyword' | 'integer' | 'float' | 'bool' | 'text';
}

export interface CollectionInfo {
  status: string;
  optimizer_status: string;
  vectors_count: number;
  indexed_vectors_count: number;
  points_count: number;
  segments_count: number;
  config: Record<string, unknown>;
  payload_schema: Record<string, unknown>;
}
