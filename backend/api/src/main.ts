import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const app = await NestFactory.create(AppModule);
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableShutdownHooks();
  await app.listen(port, '127.0.0.1');
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start API:', error);
  process.exitCode = 1;
});
