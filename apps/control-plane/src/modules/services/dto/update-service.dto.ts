import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** All fields optional — only the provided ones are updated. */
export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  repoUrl?: string;

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
  image?: string;

  @IsOptional()
  @IsString()
  composeFile?: string;

  @IsOptional()
  @IsString()
  composeYaml?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  port?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  cpuLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(16)
  memLimit?: number;

  @IsOptional()
  @IsBoolean()
  zeroDowntime?: boolean;

  @IsOptional()
  @IsString()
  healthcheckPath?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  healthTimeoutS?: number;
}
