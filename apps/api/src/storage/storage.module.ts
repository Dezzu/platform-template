import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';

/**
 * Global because storage is infrastructure, like the database: files, GDPR exports and
 * backups all need it, and threading an import through every feature module that
 * happens to touch an object buys nothing.
 */
@Global()
@Module({
  providers: [S3Service],
  exports: [S3Service],
})
export class StorageModule {}
