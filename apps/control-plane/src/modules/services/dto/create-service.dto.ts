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

  // Only http(s) git URLs. Reject leading "-" (would be parsed as a git flag/
  // option-injection) and non-web schemes like file:/ext: (local/arbitrary
  // transport). `require_tld: false` keeps self-hosted/internal hosts working.
  @IsString()
  @Matches(/^(?!-)/, { message: 'repoUrl must not start with "-"' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'repoUrl must be a valid http(s) URL' },
  )
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
