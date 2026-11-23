import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localePattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
function kind(value: string): 'categories' | 'tags' {
  if (value !== 'categories' && value !== 'tags') throw new NotFoundException();
  return value;
}
function idParam(id: string) { if (!uuid.test(id)) throw new NotFoundException(); }
function translations(body: unknown) {
  if (!body || typeof body !== 'object' || !('translations' in body) || !Array.isArray(body.translations) || body.translations.length < 1 || body.translations.length > 50) throw new BadRequestException('At least one translation is required');
  const rows = body.translations.map((input: unknown) => {
    if (!input || typeof input !== 'object' || !('locale' in input) || !('name' in input) || typeof input.locale !== 'string' || !localePattern.test(input.locale) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw new BadRequestException('Invalid translation');
    return { locale: input.locale, name: input.name.trim() };
  });
  if (new Set(rows.map((row) => row.locale.toLowerCase())).size !== rows.length) throw new BadRequestException('Duplicate locale');
  return rows;
}
function conflict(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('Name already exists in this language');
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2003') throw new ConflictException('Item is used by dramas');
  throw error;
}

@Controller('api/taxonomy')
export class TaxonomyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':kind')
  async list(@Param('kind') type: string) {
    if (kind(type) === 'categories') {
      const rows = await this.prisma.category.findMany({ include: { translations: true, _count: { select: { drafts: true } } }, orderBy: { id: 'asc' } });
      return rows.map(({ _count, ...row }) => ({ ...row, usageCount: _count.drafts }));
    }
    const rows = await this.prisma.tag.findMany({ include: { translations: true, _count: { select: { dramas: true } } }, orderBy: { id: 'asc' } });
    return rows.map(({ _count, ...row }) => ({ ...row, usageCount: _count.dramas }));
  }

  @Post(':kind')
  async create(@Param('kind') type: string, @Body() body: unknown) {
    const table = kind(type), rows = translations(body);
    try {
      return table === 'categories'
        ? await this.prisma.category.create({ data: { translations: { create: rows } }, include: { translations: true } })
        : await this.prisma.tag.create({ data: { translations: { create: rows } }, include: { translations: true } });
    } catch (error) { return conflict(error); }
  }

  @Put(':kind/:id')
  async update(@Param('kind') type: string, @Param('id') id: string, @Body() body: unknown) {
    const table = kind(type); idParam(id); const rows = translations(body);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = table === 'categories' ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE` : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tags WHERE id = ${id}::uuid FOR UPDATE`;
        if (!locked.length) throw new NotFoundException();
        if (table === 'tags') {
          const tag = await tx.tag.findUnique({ where: { id }, select: { systemKey: true } });
          if (tag?.systemKey) throw new ConflictException('System tags cannot be changed');
        }
        if (table === 'categories') {
          await tx.categoryTranslation.deleteMany({ where: { categoryId: id } });
          await tx.categoryTranslation.createMany({ data: rows.map((row) => ({ ...row, categoryId: id })) });
          return tx.category.findUniqueOrThrow({ where: { id }, include: { translations: true } });
        }
        await tx.tagTranslation.deleteMany({ where: { tagId: id } });
        await tx.tagTranslation.createMany({ data: rows.map((row) => ({ ...row, tagId: id })) });
        return tx.tag.findUniqueOrThrow({ where: { id }, include: { translations: true } });
      });
    } catch (error) { return conflict(error); }
  }

  @Put(':kind/:id/status')
  async status(@Param('kind') type: string, @Param('id') id: string, @Body() body: unknown) {
    const table = kind(type); idParam(id);
    if (!body || typeof body !== 'object' || !('active' in body) || typeof body.active !== 'boolean') throw new BadRequestException('Invalid status');
    if (table === 'tags') {
      const tag = await this.prisma.tag.findUnique({ where: { id }, select: { systemKey: true } });
      if (!tag) throw new NotFoundException();
      if (tag.systemKey) throw new ConflictException('System tags cannot be changed');
    }
    const result = table === 'categories' ? await this.prisma.category.updateMany({ where: { id }, data: { active: body.active } }) : await this.prisma.tag.updateMany({ where: { id }, data: { active: body.active } });
    if (!result.count) throw new NotFoundException();
    return { active: body.active };
  }

  @Delete(':kind/:id')
  async delete(@Param('kind') type: string, @Param('id') id: string) {
    const table = kind(type); idParam(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = table === 'categories' ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM categories WHERE id = ${id}::uuid FOR UPDATE` : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tags WHERE id = ${id}::uuid FOR UPDATE`;
        if (!locked.length) throw new NotFoundException();
        if (table === 'tags') {
          const tag = await tx.tag.findUnique({ where: { id }, select: { systemKey: true } });
          if (tag?.systemKey) throw new ConflictException('System tags cannot be changed');
        }
        const count = table === 'categories' ? await tx.dramaDraft.count({ where: { categoryId: id } }) : await tx.dramaTag.count({ where: { tagId: id } });
        if (count) throw new ConflictException('Item is used by dramas');
        if (table === 'categories') await tx.category.delete({ where: { id } }); else await tx.tag.delete({ where: { id } });
        return { deleted: true };
      });
    } catch (error) { return conflict(error); }
  }
}
