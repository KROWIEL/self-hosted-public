import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['BACKEND', 'FRONTEND'])
  type: 'BACKEND' | 'FRONTEND';

  @IsString()
  nodeId: string;

  @IsOptional()
  @IsIn(['git', 'image', 'compose'])
  deployKind?: 'git' | 'image' | 'compose';

  /** Required for git deploys; omit for image/compose. */
  @ValidateIf((o: CreateServiceDto) => (o.deployKind ?? 'git') === 'git')
  @IsString()
  templateId?: string;

  /** Required for git/compose (unless composeYaml is set). Null/omit for image. */
  @ValidateIf(
    (o: CreateServiceDto) =>
      (o.deployKind ?? 'git') === 'git' ||
      ((o.deployKind ?? 'git') === 'compose' && !o.composeYaml),
  )
  @IsString()
  @Matches(/^(?!-)/, { message: 'repoUrl must not start with "-"' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'repoUrl must be a valid http(s) URL' },
  )
  repoUrl?: string;

  /** Docker image ref when deployKind=image. */
  @ValidateIf((o: CreateServiceDto) => o.deployKind === 'image')
  @IsString()
  @MinLength(1)
  image?: string;

  @IsOptional()
  @IsString()
  composeFile?: string;

  @IsOptional()
  @IsString()
  composeYaml?: string;

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
