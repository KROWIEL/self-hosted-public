import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Create a preview environment for a service from a given branch. The preview
 * clones the parent's node/template/repo/env, deploys the branch, and (if a
 * host is given) routes a public subdomain to it.
 */
export class CreatePreviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  // Git branch/ref name — allow the usual branch characters.
  @Matches(/^[\w.\-/]+$/, {
    message: 'branch may only contain letters, digits, and . _ - /',
  })
  branch!: string;

  /** Public hostname to route to this preview (optional; internal-only if omitted). */
  @IsOptional()
  @IsString()
  @MaxLength(253)
  @Matches(/^[a-z0-9.-]+$/i, { message: 'host must be a valid hostname' })
  host?: string;

  /** Auto-expire after this many hours (0 = never). Defaults applied server-side. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 30)
  ttlHours?: number;
}
