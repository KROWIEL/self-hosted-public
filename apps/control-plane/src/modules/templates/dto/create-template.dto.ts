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

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsIn(['BACKEND', 'FRONTEND'])
  type: 'BACKEND' | 'FRONTEND';

  @IsString()
  @MinLength(1)
  baseImage: string;

  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @IsString()
  @MinLength(1)
  installImage: string;

  @IsString()
  @MinLength(1)
  installScript: string;

  @IsString()
  @MinLength(1)
  defaultBuildCommand: string;

  @IsString()
  @MinLength(1)
  defaultRunCommand: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  defaultPort: number;

  @IsOptional()
  @IsString()
  healthcheckPath?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateVariableDto)
  variables?: TemplateVariableDto[];
}
