import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const GIT_APP_PROVIDERS = ['github', 'gitlab'] as const;
export type GitAppProvider = (typeof GIT_APP_PROVIDERS)[number];

/**
 * Admin-supplied Git App / webhook config. Secrets are only persisted when a
 * non-empty value is provided (so re-saving without them keeps stored secrets).
 */
export class SetGitAppConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  githubAppId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16_000)
  githubPrivateKey?: string;

  @IsOptional()
  @IsString()
  parentServiceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  repoAllowlist?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  defaultTtlHours?: number;

  @IsOptional()
  @IsBoolean()
  commentOnPr?: boolean;
}

export class GitAppProviderParam {
  @IsIn(GIT_APP_PROVIDERS)
  provider: GitAppProvider;
}
