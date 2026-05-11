import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

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

export async function putObject(key: string, body: string, options: PutOptions): Promise<void> {
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
    ...(version !== undefined
      ? { json: `${root}/v${version}/tokens.json`, css: `${root}/v${version}/tokens.css` }
      : {}),
  }
}
