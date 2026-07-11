import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['BACKEND', 'FRONTEND'])
  type: 'BACKEND' | 'FRONTEND';

  @IsString()
  nodeId: string;

  @IsString()
  templateId: string;

  @IsString()
  repoUrl: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  gitCredId?: string;

  @IsOptional()
  @IsBoolean()
  useRepoDockerfile?: boolean;

  @IsOptional()
  @IsString()
  buildCommand?: string;

  @IsOptional()
  @IsString()
  runCommand?: string;

  @IsOptional()
  @IsInt()
  port?: number;

  @IsOptional()
  @IsInt()
  cpuLimit?: number;

  @IsOptional()
  @IsInt()
  memLimit?: number;

  @IsOptional()
  @IsObject()
  env?: Record<string, string>;
}
