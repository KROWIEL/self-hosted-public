import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OFFSITE_PROVIDERS } from '../offsite.providers';

export class OffsiteProviderConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  container?: string;

  @IsOptional()
  @IsBoolean()
  useConnectionString?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remotePath?: string;

  @IsOptional()
  @IsIn(['password', 'privateKey'])
  authMethod?: 'password' | 'privateKey';
}

export class SetOffsiteConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn([...OFFSITE_PROVIDERS])
  provider?: (typeof OFFSITE_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bucket?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  accessKeyId?: string;

  // Omit to keep the stored secret; send a value to rotate it.
  // S3/GCS: secret access key. Azure: account key or connection string.
  // SFTP: password or private key PEM.
  @IsOptional()
  @IsString()
  @MaxLength(16_000)
  secretKey?: string;

  @IsOptional()
  @IsBoolean()
  forcePathStyle?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OffsiteProviderConfigDto)
  providerConfig?: OffsiteProviderConfigDto;
}
