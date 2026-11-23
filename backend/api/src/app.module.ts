import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service.js';
import { AuthController, AuthGuard, LoginLimiter } from './auth.js';
import { DramaController } from './dramas.js';
import { EpisodeController } from './episodes.js';
import { MediaController } from './media.js';
import { TaxonomyController } from './taxonomy.js';
import { DramaCoverController, DramaCoverStagingController } from './drama-cover.js';
import { VisibilityController } from './visibility.js';
import { PublicationController } from './publication.js';
import { PublicHomeController } from './public-home.js';
import { HomeOperationsController } from './home-operations.js';

@Module({
  controllers: [AuthController, DramaController, DramaCoverController, DramaCoverStagingController, EpisodeController, MediaController, TaxonomyController, VisibilityController, PublicationController, PublicHomeController, HomeOperationsController],
  providers: [PrismaService, LoginLimiter, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
