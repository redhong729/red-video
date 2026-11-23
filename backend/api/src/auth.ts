import { createHash, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, Injectable, Post, Req, Res, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from './prisma.service.js';
import { verifyPassword } from './password.js';

const publicKey = 'isPublic';
export const Public = () => SetMetadata(publicKey, true);
const cookieName = 'rv_session';
const sessionDuration = 12 * 60 * 60 * 1000;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

type Request = { headers: IncomingHttpHeaders; method: string; socket: { remoteAddress?: string }; admin?: { id: string; username: string }; sessionHash?: string };
type Response = { cookie(name: string, value: string, options: object): void; clearCookie(name: string, options: object): void };

function getOrigin(): string {
  const value = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
  const parsed = new URL(value);
  if (parsed.origin !== value || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('ADMIN_ORIGIN must be an HTTP(S) origin without a trailing slash or path');
  return value;
}

function readToken(header: string | undefined): string | undefined {
  const matches = (header ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0].slice(cookieName.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== getOrigin()) {
      throw new ForbiddenException('Invalid request origin');
    }
    if (this.reflector.getAllAndOverride<boolean>(publicKey, [context.getHandler(), context.getClass()])) return true;
    const token = readToken(req.headers.cookie);
    if (!token) throw new UnauthorizedException();
    const hash = tokenHash(token);
    const session = await this.prisma.adminSession.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || !session.user.enabled) throw new UnauthorizedException();
    req.admin = { id: session.user.id, username: session.user.username };
    req.sessionHash = hash;
    return true;
  }
}

@Injectable()
export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  check(ip: string): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.expires <= now) this.attempts.delete(key);
    let entry = this.attempts.get(ip);
    if (!entry) {
      if (this.attempts.size >= 10000) throw new HttpException('Too many requests', 429);
      entry = { count: 0, expires: now + 10 * 60 * 1000 };
      this.attempts.set(ip, entry);
    }
    if (entry.count >= 10) throw new HttpException('Too many requests', 429);
    entry.count += 1;
  }
  clear(ip: string): void { this.attempts.delete(ip); }
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService, private readonly limiter: LoginLimiter) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ username: string }> {
    const ip = req.socket.remoteAddress ?? 'unknown';
    this.limiter.check(ip);
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const username = typeof payload.username === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(payload.username) ? payload.username : '';
    const password = typeof payload.password === 'string' && Buffer.byteLength(payload.password, 'utf8') <= 256 ? payload.password : '';
    const user = username ? await this.prisma.adminUser.findUnique({ where: { username } }) : null;
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid || !user.enabled) throw new UnauthorizedException('Invalid username or password');
    this.limiter.clear(ip);
    const token = randomBytes(32).toString('hex');
    await this.prisma.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await this.prisma.adminSession.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + sessionDuration) } });
    res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure: getOrigin().startsWith('https://'), path: '/', maxAge: sessionDuration });
    return { username: user.username };
  }

  @Get('me')
  me(@Req() req: Request): { username: string } { return { username: req.admin!.username }; }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.prisma.adminSession.deleteMany({ where: { tokenHash: req.sessionHash! } });
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: getOrigin().startsWith('https://'), path: '/' });
  }
}
