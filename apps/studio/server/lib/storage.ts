import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'

let _client: S3Client | null = null

function client(): S3Client {
  if (_client) return _client
  const endpoint = process.env.S3_ENDPOINT
  const region = process.env.S3_REGION ?? 'us-east-1'
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY must be set')
  }
  _client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // required for MinIO and most non-AWS S3-compatibles
  })
  return _client
}

function bucket(): string {
  const b = process.env.S3_BUCKET
  if (!b) throw new Error('S3_BUCKET is not set')
  return b
}

export interface PutOptions {
  contentType: string
  cacheControl?: string
}

export async function putObject(
  key: string,
  body: string | Buffer,
  options: PutOptions,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
    }),
  )
}

/**
 * Server-side copy (draft-asset → versioned/current ved publish) — binære
 * assets skal aldrig rundtures gennem app-processen bare for at skifte key.
 * MetadataDirective REPLACE så cache-control kan strammes på destinationen
 * (draft = ingen cache, versioned = immutable).
 */
export async function copyObject(
  sourceKey: string,
  destKey: string,
  options: PutOptions,
): Promise<void> {
  await client().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      CopySource: `${bucket()}/${sourceKey}`,
      Key: destKey,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      MetadataDirective: 'REPLACE',
    }),
  )
}

export async function getObjectAsString(key: string): Promise<string | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    if (!res.Body) return null
    return await res.Body.transformToString()
  } catch (err) {
    if ((err as { name?: string })?.name === 'NoSuchKey') return null
    throw err
  }
}

export function paths(projectId: string, version?: number) {
  const root = `p/${projectId}`
  return {
    versionedJson: (v: number) => `${root}/v${v}/tokens.json`,
    versionedCss: (v: number) => `${root}/v${v}/tokens.css`,
    currentJson: `${root}/current.json`,
    currentCss: `${root}/current.css`,
    // Brand-assets: uploads lander i draft/-præfikset og promoveres af
    // publish til v{n}/ (immutabelt arkiv) + current/ (det /k serverer).
    // `name` er allerede schema-valideret relativt (logo.svg / fonts/x.woff2).
    draftAsset: (name: string) => `${root}/draft/${name}`,
    versionedAsset: (v: number, name: string) => `${root}/v${v}/${name}`,
    currentAsset: (name: string) => `${root}/current/${name}`,
    ...(version !== undefined
      ? { json: `${root}/v${version}/tokens.json`, css: `${root}/v${version}/tokens.css` }
      : {}),
  }
}
