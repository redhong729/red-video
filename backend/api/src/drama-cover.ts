import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, NotFoundException, Param, Post, Put, Req, Res, StreamableFile } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { mediaConfig, mediaDir, safeCoverPattern, uuidPattern } from './media-common.js';
import type { Prisma } from './generated/prisma/client.js';
import { editableDramaStatus } from './drama-status.js';

const runFile = promisify(execFile);
const maxBytes = 10 * 1024 * 1024;
const coverKeyPattern = /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
const dir = (id: string) => join(mediaConfig.storageDir, 'drama-covers', id);
const keyPath = (id: string, key: string) => join(dir(id), key);
const stagingDir = (adminId: string) => join(mediaConfig.storageDir, 'drama-cover-staging', adminId);
const checkId = (id: string) => { if (!uuidPattern.test(id)) throw new NotFoundException(); };
const mimetypes: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
type Response = { setHeader(name: string, value: string | number): void };
type AdminRequest = IncomingMessage & { admin?: { id: string } };

function adminId(req: AdminRequest): string {
  const id = req.admin?.id;
  if (!id || !uuidPattern.test(id)) throw new NotFoundException();
  return id;
}

async function receiveImage(req: IncomingMessage, contentType: string | undefined, folder: string) {
  const extension = Object.entries(mimetypes).find(([, mime]) => mime === contentType)?.[0];
  if (!extension) throw new BadRequestException('Use a JPEG, PNG or WebP image');
  if (Number(req.headers['content-length']) > maxBytes) throw new BadRequestException('Image exceeds 10 MiB');
  await mkdir(folder, { recursive: true, mode: 0o700 });

  const key = `${randomUUID()}.${extension}`;
  const path = join(folder, key);
  const temporary = join(folder, `.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  let size = 0;
  let prefix = Buffer.alloc(0);
  let saved = false;
  try {
    for await (const raw of req) {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += bytes.length;
      if (size > maxBytes) throw new BadRequestException('Image exceeds 10 MiB');
      if (prefix.length < 12) prefix = Buffer.concat([prefix, bytes.subarray(0, 12 - prefix.length)]);
      let offset = 0;
      while (offset < bytes.length) {
        const written = await handle.write(bytes, offset, bytes.length - offset);
        if (!written.bytesWritten) throw new Error('Short write');
        offset += written.bytesWritten;
      }
    }
    await handle.close();
    const valid = extension === 'jpg'
      ? prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : extension === 'png'
        ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!size || !valid) throw new BadRequestException('Invalid image');
    try {
      const { stdout } = await runFile('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', temporary], { timeout: 30000, maxBuffer: 1024 * 1024 });
      const stream = JSON.parse(stdout).streams?.[0] as { codec_name?: string; width?: number; height?: number } | undefined;
      if (!stream || stream.codec_name !== ({ jpg: 'mjpeg', png: 'png', webp: 'webp' } as Record<string, string>)[extension] || !stream.width || !stream.height || stream.width > 8192 || stream.height > 8192) throw new Error('Invalid image');
      await runFile('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', temporary, '-frames:v', '1', '-f', 'null', '-'], { timeout: 30000, maxBuffer: 1024 * 1024 });
    } catch { throw new BadRequestException('Invalid or unsupported image'); }
    await rename(temporary, path);
    saved = true;
    return { key, path };
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (!saved) await unlink(path).catch(() => undefined);
  }
}

async function pruneStagedImages(id: string) {
  const folder = stagingDir(id);
  let names: string[];
  try { names = await readdir(folder); } catch { return; }
  const cutoff = Date.now() - mediaConfig.uploadDays * 86400000;
  await Promise.all(names.flatMap((name) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(name)) return [];
    const path = join(folder, name);
    return [stat(path).then((info) => info.mtimeMs < cutoff ? unlink(path) : undefined).catch(() => undefined)];
  }));
}

async function findStagedImage(id: string, uploadId: string) {
  for (const extension of Object.keys(mimetypes)) {
    const path = join(stagingDir(id), `${uploadId}.${extension}`);
    try {
      const info = await stat(path);
      if (info.isFile()) return { extension, path };
    } catch { /* try the next supported extension */ }
  }
  return null;
}

@Controller('api/dramas/:id/cover')
export class DramaCoverController {
  constructor(private readonly prisma: PrismaService) {}

  private async commit(id: string, key: string, validate?: (tx: Prisma.TransactionClient) => Promise<void>) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${id}::uuid FOR UPDATE`;
      const drama = await tx.drama.findUnique({ where: { id }, include: { draft: true } });
      if (!drama?.draft) throw new NotFoundException();
      if (!editableDramaStatus(drama.status)) throw new ConflictException('Cover is not editable');
      if (validate) await validate(tx);
      await tx.dramaDraft.update({ where: { dramaId: id }, data: { coverKey: key } });
      await tx.drama.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    return { coverKey: key };
  }

  @Get()
  async get(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    checkId(id);
    const draft = await this.prisma.dramaDraft.findUnique({ where: { dramaId: id } });
    const key = draft?.coverKey;
    if (!key || !coverKeyPattern.test(key)) throw new NotFoundException();
    const path = keyPath(id, key);
    try { await stat(path); } catch { throw new NotFoundException(); }
    res.setHeader('Content-Type', mimetypes[key.split('.').pop()!]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(path));
  }

  @Put()
  async upload(@Param('id') id: string, @Headers('content-type') contentType: string | undefined, @Req() req: IncomingMessage) {
    checkId(id);
    const drama = await this.prisma.drama.findUnique({ where: { id }, include: { draft: true } });
    if (!drama?.draft) throw new NotFoundException();
    if (!editableDramaStatus(drama.status)) throw new ConflictException('Cover is not editable');
    const { key, path } = await receiveImage(req, contentType, dir(id));
    let committed = false;
    try {
      const result = await this.commit(id, key); committed = true; return result;
    } finally {
      if (!committed) await unlink(path).catch(() => undefined);
    }
  }

  @Post('from-staging')
  async fromStaging(@Param('id') id: string, @Body() body: unknown, @Req() req: AdminRequest) {
    checkId(id);
    if (!body || typeof body !== 'object' || !('uploadId' in body) || typeof body.uploadId !== 'string' || !uuidPattern.test(body.uploadId)) throw new BadRequestException('Invalid staged cover');
    const ownerId = adminId(req);
    await pruneStagedImages(ownerId);
    const staged = await findStagedImage(ownerId, body.uploadId);
    if (!staged) throw new NotFoundException('Staged cover not found');
    await mkdir(dir(id), { recursive: true, mode: 0o700 });
    const key = `${randomUUID()}.${staged.extension}`;
    const path = keyPath(id, key);
    let committed = false;
    try {
      try { await copyFile(staged.path, path, 1); } catch { throw new NotFoundException('Staged cover not found'); }
      const result = await this.commit(id, key);
      committed = true;
      await unlink(staged.path).catch(() => undefined);
      return result;
    } finally {
      if (!committed) await unlink(path).catch(() => undefined);
    }
  }

  @Post('from-frame')
  async fromFrame(@Param('id') id: string, @Body() body: unknown) {
    checkId(id);
    if (!body || typeof body !== 'object' || !('mediaId' in body) || !('name' in body) || typeof body.mediaId !== 'string' || !uuidPattern.test(body.mediaId) || typeof body.name !== 'string' || !safeCoverPattern.test(body.name)) throw new BadRequestException('Invalid frame');
    const mediaId = body.mediaId, name = body.name;
    const validate = async (tx: Prisma.TransactionClient) => {
      const item = await tx.mediaUpload.findUnique({ where: { id: mediaId }, include: { episode: true } });
      if (!item || item.episode.dramaId !== id || item.episode.draftMediaId !== mediaId || item.coverStatus !== 'SUCCEEDED') throw new ConflictException('Frame is not available for this drama');
    };
    await mkdir(dir(id), { recursive: true, mode: 0o700 });
    const key = `${randomUUID()}.jpg`, path = keyPath(id, key); let committed = false;
    try {
      try { await copyFile(join(mediaDir(mediaId), name), path, 1); } catch { throw new NotFoundException('Frame not found'); }
      const result = await this.commit(id, key, validate); committed = true; return result;
    } finally { if (!committed) await unlink(path).catch(() => undefined); }
  }
}

@Controller('api/drama-cover-staging')
export class DramaCoverStagingController {
  @Post()
  async upload(@Headers('content-type') contentType: string | undefined, @Req() req: AdminRequest) {
    const ownerId = adminId(req);
    await pruneStagedImages(ownerId);
    const { key } = await receiveImage(req, contentType, stagingDir(ownerId));
    return {
      uploadId: key.slice(0, key.lastIndexOf('.')),
      expiresInDays: mediaConfig.uploadDays,
    };
  }

  @Delete(':uploadId')
  async remove(@Param('uploadId') uploadId: string, @Req() req: AdminRequest) {
    if (!uuidPattern.test(uploadId)) throw new NotFoundException();
    const ownerId = adminId(req);
    const staged = await findStagedImage(ownerId, uploadId);
    if (!staged) throw new NotFoundException();
    await unlink(staged.path);
    return { deleted: true };
  }
}
