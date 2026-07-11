import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TemplateVariableDto } from './template-variable.dto';

/** All fields optional — supports partial edits of an existing template. */
export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsIn(['BACKEND', 'FRONTEND'])
  type?: 'BACKEND' | 'FRONTEND';

  @IsOptional()
  @IsString()
  @MinLength(1)
  baseImage?: string;

  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  installImage?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  installScript?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  defaultBuildCommand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  defaultRunCommand?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  defaultPort?: number;

  @IsOptional()
  @IsString()
  healthcheckPath?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateVariableDto)
  variables?: TemplateVariableDto[];
}
