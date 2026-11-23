import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Request = { admin?: { id: string; username: string } };
function idsFrom(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !('ids' in body) || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100 || body.ids.some((id: unknown) => typeof id !== 'string' || !uuid.test(id)) || new Set(body.ids).size !== body.ids.length) throw new BadRequestException('Expected 1–100 unique identifiers');
  return body.ids as string[];
}
const validId = (id: string) => { if (!uuid.test(id)) throw new NotFoundException(); };

@Controller('api/visibility')
export class VisibilityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dramas/:id/history')
  async history(@Param('id') id: string) {
    validId(id);
    if (!(await this.prisma.drama.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException();
    return this.prisma.visibilityEvent.findMany({ where: { dramaId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  }

  @Post('dramas/offline')
  async offlineDramas(@Body() body: unknown, @Req() req: Request) {
    const ids = idsFrom(body), actor = req.admin!.username;
    const results: { id: string; result: string; reason?: string }[] = [];
    for (const id of ids) {
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${id}::uuid FOR UPDATE`;
          const drama = await tx.drama.findUnique({ where: { id } });
          if (!drama) return { id, result: 'SKIPPED', reason: 'NOT_FOUND' };
          if (drama.status !== 'PUBLISHED') return { id, result: 'SKIPPED', reason: 'NOT_PUBLISHED' };
          await tx.drama.update({ where: { id }, data: { status: 'OFFLINE' } });
          await tx.visibilityEvent.create({ data: { dramaId: id, actor, action: 'DRAMA_OFFLINE', fromStatus: 'PUBLISHED', toStatus: 'OFFLINE' } });
          return { id, result: 'SUCCEEDED' };
        });
        results.push(outcome);
      } catch { results.push({ id, result: 'FAILED', reason: 'OPERATION_FAILED' }); }
    }
    return { results };
  }

  @Post('dramas/:id/episodes/offline')
  async offlineEpisodes(@Param('id') dramaId: string, @Body() body: unknown, @Req() req: Request) {
    validId(dramaId); const ids = idsFrom(body), actor = req.admin!.username;
    const results: { id: string; result: string; reason?: string }[] = [];
    for (const id of ids) {
      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${dramaId}::uuid FOR UPDATE`;
          const drama = await tx.drama.findUnique({ where: { id: dramaId } });
          if (!drama) return { id, result: 'SKIPPED', reason: 'DRAMA_NOT_FOUND' };
          const episode = await tx.episode.findFirst({ where: { id, dramaId } });
          if (!episode) return { id, result: 'SKIPPED', reason: 'NOT_FOUND' };
          if (episode.status !== 'PUBLISHED') return { id, result: 'SKIPPED', reason: 'NOT_PUBLISHED' };
          await tx.episode.update({ where: { id }, data: { status: 'OFFLINE' } });
          await tx.visibilityEvent.create({ data: { dramaId, episodeId: id, actor, action: 'EPISODE_OFFLINE', fromStatus: 'PUBLISHED', toStatus: 'OFFLINE' } });
          return { id, result: 'SUCCEEDED' };
        });
        results.push(outcome);
      } catch { results.push({ id, result: 'FAILED', reason: 'OPERATION_FAILED' }); }
    }
    return { results };
  }
}
