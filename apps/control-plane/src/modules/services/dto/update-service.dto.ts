import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

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
  @IsIn(['template', 'dockerfile', 'nixpacks'])
  buildMode?: 'template' | 'dockerfile' | 'nixpacks';

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?!\/)(?!.*\.\.)(?![A-Za-z]:)[^\\]*$/, {
    message:
      'composeFile must be a relative path without ".." or absolute prefixes',
  })
  composeFile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512_000)
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
