import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FileDownloadSchema,
  FileListQuerySchema,
  FileSchema,
  FileUploadTicketRequestSchema,
  FileUploadTicketSchema,
  PERMISSIONS,
  zPaginated,
  type FileDownload,
  type FileListQuery,
  type FileMetadata,
  type FileUploadTicket,
  type FileUploadTicketRequest,
  type Paginated,
} from '@app/contracts';
import { z } from 'zod';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { CurrentOrg, type OrgContext } from '../../auth/org-context';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { FilesService } from './files.service';

/**
 * Note what is missing: an endpoint that accepts a file body. There is none, and there
 * should never be one. Bytes go browser → storage over a presigned URL and come back
 * storage → browser the same way; this controller only issues tickets and records what
 * happened.
 */
@ApiTags('files')
@ApiStandardErrors()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FILES_READ)
  @ApiOperation({ summary: 'List the files of the active organization' })
  @ApiEnvelope(zPaginated(FileSchema))
  list(
    @CurrentOrg() org: OrgContext,
    @Query({ schema: FileListQuerySchema }) query: FileListQuery,
  ): Promise<Paginated<FileMetadata>> {
    return this.files.list(org, query);
  }

  @Post('upload-url')
  @RequirePermissions(PERMISSIONS.FILES_WRITE)
  @ApiOperation({ summary: 'Reserve a file and get a presigned PUT for it' })
  @ApiEnvelope(FileUploadTicketSchema, { status: HttpStatus.CREATED })
  createUploadTicket(
    @CurrentOrg() org: OrgContext,
    @Body({ schema: FileUploadTicketRequestSchema }) body: FileUploadTicketRequest,
  ): Promise<FileUploadTicket> {
    return this.files.createUploadTicket(org, body);
  }

  @Post(':id/commit')
  @RequirePermissions(PERMISSIONS.FILES_WRITE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the upload landed; verifies the object with a HEAD' })
  @ApiEnvelope(FileSchema)
  commit(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: z.uuid() }) id: string,
  ): Promise<FileMetadata> {
    return this.files.commit(org, id);
  }

  @Get(':id/download-url')
  @RequirePermissions(PERMISSIONS.FILES_READ)
  @ApiOperation({ summary: 'Get a short-lived presigned GET' })
  @ApiEnvelope(FileDownloadSchema)
  download(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: z.uuid() }) id: string,
  ): Promise<FileDownload> {
    return this.files.download(org, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FILES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file and its object' })
  remove(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: z.uuid() }) id: string,
  ): Promise<void> {
    return this.files.remove(org, id);
  }
}
