import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SetOffsiteConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

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
  @IsOptional()
  @IsString()
  @MaxLength(500)
  secretKey?: string;

  @IsOptional()
  @IsBoolean()
  forcePathStyle?: boolean;
}
